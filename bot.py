import os
from flask import Flask, request
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

TOKEN = os.environ.get("BOT_TOKEN")

app = Flask(__name__)
application = Application.builder().token(TOKEN).build()

# ===== COMMAND =====
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🤖 Bot VCARD aktif 24 jam (Render FREE)")

async def vcard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📇 Request diterima")

application.add_handler(CommandHandler("start", start))
application.add_handler(CommandHandler("vcard", vcard))

# ===== WEBHOOK =====
@app.route("/webhook", methods=["POST"])
async def webhook():
    update = Update.de_json(request.get_json(force=True), application.bot)
    await application.process_update(update)
    return "ok"

@app.route("/")
def index():
    return "Bot running"

if __name__ == "__main__":
    application.initialize()
    application.start()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
