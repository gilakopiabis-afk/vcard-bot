import os
import asyncio
import string
from telegram import Update, InputFile
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
)
import gspread
from google.oauth2.service_account import Credentials

# ================= CONFIG =================
BOT_TOKEN = os.getenv("BOT_TOKEN")
SPREADSHEET_NAME = "DB VCARD BOT"
SHEET_NAME = "Sheet1"

# =========================================

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
creds = Credentials.from_service_account_file(
    "credentials.json", scopes=SCOPES
)
gc = gspread.authorize(creds)
sheet = gc.open(SPREADSHEET_NAME).worksheet(SHEET_NAME)

QUEUE = asyncio.Queue()


def get_and_delete_numbers(total):
    rows = sheet.col_values(1)
    if len(rows) < total:
        return []

    picked = rows[:total]
    sheet.delete_rows(1, total)
    return picked


def create_vcard(numbers, filename, prefix):
    with open(filename, "w", encoding="utf-8") as f:
        for i, number in enumerate(numbers, start=1):
            name = f"{prefix} {str(i).zfill(3)}"
            f.write(
                "BEGIN:VCARD\n"
                "VERSION:3.0\n"
                f"N:{name};;;;\n"
                f"FN:{name}\n"
                f"TEL;TYPE=CELL:{number}\n"
                "END:VCARD\n"
            )


async def vcard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type not in ["group", "supergroup"]:
        await update.message.reply_text("❌ Perintah hanya di grup")
        return

    try:
        file_count = int(context.args[0])
        per_file = int(context.args[1])
    except:
        await update.message.reply_text("❌ Format: /vcard lihat contoh")
        return

    await update.message.reply_text("⏳ Sip otw proses, wait ya")

    await QUEUE.put((update, file_count, per_file))


async def process_queue(app):
    while True:
        update, file_count, per_file = await QUEUE.get()
        user = update.effective_user

        total = file_count * per_file
        numbers = get_and_delete_numbers(total)

        if not numbers:
            await update.message.reply_text("❌ Database tidak mencukupi")
            QUEUE.task_done()
            continue

        letters = string.ascii_uppercase
        index = 0

        try:
            for i in range(file_count):
                batch = numbers[index:index + per_file]
                index += per_file

                filename = f"vcard_{i+1}.vcf"
                create_vcard(batch, filename, letters[i % 26])

                await app.bot.send_document(
                    chat_id=user.id,
                    document=InputFile(filename),
                    caption="✅ VCARD BERHASIL"
                )

                os.remove(filename)

            await update.message.reply_text("✅ Vcard done cek japri ya")

        except Exception as e:
            await update.message.reply_text("❌ Gagal kirim. Pastikan sudah /start bot di japri")

        QUEUE.task_done()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("✅ Bot siap menerima vCard")


async def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("vcard", vcard))

    asyncio.create_task(process_queue(app))

    print("VCARD BOT BERJALAN")
    await app.run_polling()


if __name__ == "__main__":
    asyncio.run(main())
