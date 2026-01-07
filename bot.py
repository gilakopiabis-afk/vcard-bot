import os
from flask import Flask, request
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

TOKEN = os.environ.get("BOT_TOKEN")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "secret")
PORT = int(os.environ.get("PORT", 10000))

app = Flask(__name__)
application = ApplicationBuilder().token(TOKEN).build()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("✅ Bot vCard aktif 24 jam di Render!")

application.add_handler(CommandHandler("start", start))

@app.post(f"/{WEBHOOK_SECRET}")
async def webhook():
    data = request.get_json(force=True)
    await application.process_update(Update.de_json(data, application.bot))
    return "ok"

@app.get("/")
def index():
    return "Bot is running"

if __name__ == "__main__":
    application.run_webhook(
        listen="0.0.0.0",
        port=PORT,
        url_path=WEBHOOK_SECRET,
        webhook_url=os.environ["RENDER_EXTERNAL_URL"] + "/" + WEBHOOK_SECRET,
    )
