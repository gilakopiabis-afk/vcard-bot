const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { Telegraf } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

// ================= CONFIG (Render Env) =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";
const DB_COLUMN = parseInt(process.env.DB_COLUMN || "1", 10); // 1 = kolom A
const GOOGLE_CREDS_JSON = process.env.GOOGLE_CREDS_JSON;
const USERS_FILE = process.env.USERS_FILE || "users.json";
// =======================================================

if (!BOT_TOKEN) throw new Error("❌ BOT_TOKEN tidak ditemukan. Set di Render env vars.");
if (!SPREADSHEET_ID) throw new Error("❌ SPREADSHEET_ID tidak ditemukan. Set di Render env vars.");
if (!GOOGLE_CREDS_JSON) throw new Error("❌ GOOGLE_CREDS_JSON tidak ditemukan. Set di Render env vars.");

// ===== HTTP Server (Wajib untuk Render Web Service) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.status(200).send("✅ Bot is running (Web Service)!"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ===== Telegram Bot =====
const bot = new Telegraf(BOT_TOKEN);

// ===== Load users =====
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    users = {};
  }
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// ===== Google Sheets (JWT Auth) =====
const creds = JSON.parse(GOOGLE_CREDS_JSON);

const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive",
  ],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, jwt);

async function getSheet() {
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[SHEET_NAME];
  if (!sheet) throw new Error(`❌ Sheet "${SHEET_NAME}" tidak ditemukan di Spreadsheet`);
  return sheet;
}

// ===== Get & delete numbers =====
async function getAndDeleteNumbers(totalNeeded) {
  const sheet = await getSheet();

  const rows = await sheet.getRows();
  if (rows.length < totalNeeded) return [];

  const colIndex = DB_COLUMN - 1;
  const picked = [];
  const rowsToDelete = [];

  for (let i = 0; i < totalNeeded; i++) {
    const r = rows[i];

    const valueFromArray =
      Array.isArray(r._rawData) && r._rawData.length > colIndex
        ? r._rawData[colIndex]
        : null;

    const val = (valueFromArray || "").toString().trim();
    if (!val) return [];

    picked.push(val);
    rowsToDelete.push(r);
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    await rowsToDelete[i].delete();
  }

  return picked;
}

// ===== Create VALID vCard =====
function createVcard(numbers, filename, letter) {
  let content = "";
  numbers.forEach((num, idx) => {
    const name = `${letter} ${String(idx + 1).padStart(3, "0")}`;
    content +=
      "BEGIN:VCARD\n" +
      "VERSION:3.0\n" +
      `N:${name};;;;\n` +
      `FN:${name}\n` +
      `TEL;TYPE=CELL:${num}\n` +
      "END:VCARD\n";
  });

  fs.writeFileSync(filename, content, "utf-8");
}

// ===== /start =====
bot.start(async (ctx) => {
  const user = ctx.from;
  users[String(user.id)] = user.username || "";
  saveUsers();
  await ctx.reply("✅ Bot siap. Kamu bisa request dari grup.");
});

// ===== /vcard =====
bot.command("vcard", async (ctx) => {
  const user = ctx.from;
  const msg = ctx.message.text || "";
  const parts = msg.split(" ").filter(Boolean);

  if (parts.length !== 3) {
    await ctx.reply("❌ Format: /vcard <jumlah_file> <isi_per_file>");
    return;
  }

  const fileCount = parseInt(parts[1], 10);
  const perFile = parseInt(parts[2], 10);

  if (!Number.isInteger(fileCount) || !Number.isInteger(perFile)) {
    await ctx.reply("❌ jumlah_file dan isi_per_file harus angka.");
    return;
  }
  if (fileCount <= 0 || perFile <= 0) {
    await ctx.reply("❌ jumlah_file dan isi_per_file harus > 0.");
    return;
  }

  if (!users[String(user.id)]) {
    await ctx.reply("❌ Chat bot dulu via japri kirim /start");
    return;
  }

  const totalNeeded = fileCount * perFile;
  await ctx.reply("⏳ Otw proses, wait ye...");

  let numbers = [];
  try {
    numbers = await getAndDeleteNumbers(totalNeeded);
  } catch (err) {
    console.error("Google Sheet Error:", err);
    await ctx.reply("❌ Error akses Google Sheet:\n" + (err.message || err.toString()));
    return;
  }

  if (!numbers || numbers.length === 0) {
    await ctx.reply("❌ Database tidak mencukupi");
    return;
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let index = 0;

  for (let i = 0; i < fileCount; i++) {
    const batch = numbers.slice(index, index + perFile);
    index += perFile;

    const filename = path.join(os.tmpdir(), `vcard_${i + 1}.vcf`);
    createVcard(batch, filename, letters[i % 26]);

    try {
      await ctx.telegram.sendDocument(user.id, { source: filename });
    } catch (err) {
      console.error("sendDocument error:", err);
      await ctx.reply("❌ Gagal kirim file ke japri. Pastikan kamu sudah /start di bot.");
    }

    try {
      fs.unlinkSync(filename);
    } catch {}
  }

  await ctx.reply("✅ Vcard done cek japri ye");
});

// ===== RUN BOT =====
bot.launch().then(() => {
  console.log("🟢 VCARD BOT + WEB SERVICE BERJALAN (JWT AUTH READY)");
});

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
