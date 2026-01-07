import json
import os
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes
)

TOKEN = os.environ.get("BOT_TOKEN")

USERS_FILE = "users.json"


def load_numbers():
    if not os.path.exists(USERS_FILE):
        return []
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def create_vcard(numbers, filename):
    with open(filename, "w", encoding="utf-8") as f:
        for i, num in enumerate(numbers, start=1):
            f.write(
                "BEGIN:VCARD\n"
                "VERSION:3.0\n"
                f"N:User{i};User{i};;;\n"
                f"FN:User{i}\n"
                f"TEL;TYPE=CELL:{num}\n"
                "END:VCARD\n"
            )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🤖 VCard Bot siap!\n\n"
        "Gunakan:\n"
        "/vcard <jumlah>\n\n"
        "Contoh:\n"
        "/vcard 100"
    )


async def vcard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        total = int(context.args[0])
    except:
        await update.message.reply_text("❌ Contoh yang benar:\n/vcard 100")
        return

    numbers = load_numbers()

    if not numbers:
        await update.message.reply_text("❌ users.json kosong")
        return

    if total > len(numbers):
        total = len(numbers)

    selected = numbers[:total]
    filename = f"vcard_{total}.vcf"

    create_vcard(selected, filename)

    await update.message.reply_text("⏳ Membuat vCard...")
    await update.message.reply_document(
        document=open(filename, "rb"),
        filename=filename
    )

    os.remove(filename)


async def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("vcard", vcard))

    print("✅ Bot berjalan...")
    await app.run_polling()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
