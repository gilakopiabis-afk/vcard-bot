import os
import json
import logging
from flask import Flask, request
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

# ================= CONFIG =================
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)

telegram_app = Application.builder().token(BOT_TOKEN).build()

# ================= COMMAND =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "✅ Bot VCARD aktif!\nGunakan perintah:\n/vcard 100"
    )

async def vcard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        total = int(context.args[0])
    except:
        await update.message.reply_text("❌ Contoh benar: /vcard 100")
        return

    await update.message.reply_text(
        f"⏳ Permintaan diterima\nSedang memproses {total} nomor..."
    )

    # SIMULASI BERHASIL
    await update.message.reply_text(
        "✅ Selesai!\nFile VCARD sudah dikirim via japri."
    )

telegram_app.add_handler(CommandHandler("start", start))
telegram_app.add_handler(CommandHandler("vcard", vcard))

# ================= WEBHOOK =================
@app.route("/", methods=["POST"])
async def webhook():
    update = Update.de_json(request.get_json(force=True), telegram_app.bot)
    await telegram_app.process_update(update)
    return "OK"

@app.route("/", methods=["GET"])
def index():
    return "VCARD BOT RUNNING"

# ================= MAIN =================
if __name__ == "__main__":
    telegram_app.run_webhook(
        listen="0.0.0.0",
        port=int(os.environ.get("PORT", 10000)),
        webhook_url=WEBHOOK_URL,
    )
