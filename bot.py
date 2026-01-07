import logging
import os
import asyncio
from telegram import Update, InputFile
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
)
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from string import ascii_uppercase

# ================= CONFIG =================
BOT_TOKEN = os.getenv("BOT_TOKEN")  # set di Render
SPREADSHEET_NAME = "DB VCARD BOT"
SHEET_NAME = "Sheet1"
# ==========================================

logging.basicConfig(level=logging.INFO)

# ====== GOOGLE SHEET ======
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

creds = ServiceAccountCredentials.from_json_keyfile_name(
    "credentials.json", scope
)
gc = gspread.authorize(creds)
sheet = gc.open(SPREADSHEET_NAME).worksheet(SHEET_NAME)


# ====== VCARD CREATOR ======
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


# ====== GET & DELETE NUMBERS (BATCH SAFE) ======
def get_and_delete_numbers(total):
    rows = sheet.col_values(1)
    if len(rows) < total:
        return []

    numbers = rows[:total]
    sheet.delete_rows(1, total)
    return numbers


# ====== COMMAND /vcard ======
async def vcard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) != 2:
        await update.message.reply_text("❌ Format: /vcard <jumlah_file> <isi_per_file>")
        return

    try:
        file_count = int(context.args[0])
        per_file = int(context.args[1])
    except ValueError:
        await update.message.reply_text("❌ Angka tidak valid")
        return

    total_needed = file_count * per_file
    await update.message.reply_text("⏳ Ok otw proses, bentar ya...")

    numbers = await asyncio.to_thread(get_and_delete_numbers, total_needed)

    if not numbers:
        await update.message.reply_text("❌ Database tidak mencukupi")
        return

    user_id = update.effective_user.id

    index = 0
    letters = ascii_uppercase

    for i in range(file_count):
        batch = numbers[index:index + per_file]
        index += per_file

        prefix = letters[i % len(letters)]
        filename = f"vcard_{i+1}.vcf"

        create_vcard(batch, filename, prefix)

        try:
            await context.bot.send_document(
                chat_id=user_id,
                document=InputFile(filename),
                caption=f"📇 VCARD {i+1}"
            )
        except Exception:
            await update.message.reply_text(
                "❗ Bot belum bisa kirim JAPRI.\n"
                "➡️ Silakan chat bot via japri lalu klik /start ya."
            )
            return

        os.remove(filename)

    await update.message.reply_text("✅ Vcard done cek japri ya")


# ====== MAIN ======
def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("vcard", vcard))
    app.run_polling()


if __name__ == "__main__":
    main()
