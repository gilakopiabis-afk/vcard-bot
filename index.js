const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { Telegraf } = require("telegraf");
const { JWT } = require("google-auth-library");
const { google } = require("googleapis");

// ================= CONFIG (Render Env) =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";
const DB_COLUMN = parseInt(process.env.DB_COLUMN || "1", 10);
const GOOGLE_CREDS_JSON = process.env.GOOGLE_CREDS_JSON;
// =======================================================

if (!BOT_TOKEN) throw new Error("❌ BOT_TOKEN tidak ditemukan.");
if (!SPREADSHEET_ID) throw new Error("❌ SPREADSHEET_ID tidak ditemukan.");
if (!GOOGLE_CREDS_JSON) throw new Error("❌ GOOGLE_CREDS_JSON tidak ditemukan.");

// ===== HTTP Server =====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.status(200).send("✅ Bot Web Service is Running!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ===== Telegram Bot =====
const bot = new Telegraf(BOT_TOKEN);

// ===== Google Credentials =====
let creds = {};
try {
  creds = JSON.parse(GOOGLE_CREDS_JSON);
} catch {
  throw new Error("❌ GOOGLE_CREDS_JSON bukan JSON valid.");
}

if (creds.private_key) {
  creds.private_key = creds.private_key.replace(/\\n/g, "\n").replace(/\r/g, "");
}

const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});
const sheetsApi = google.sheets({ version: "v4", auth: jwt });

function getColLetter(colIndex) {
  let letter = "";
  let temp = colIndex;
  while (temp > 0) {
    let remainder = (temp - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    temp = Math.floor((temp - remainder) / 26);
  }
  return letter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Get & Delete Numbers =====
async function getAndDeleteNumbers(totalNeeded) {
  const colLetter = getColLetter(DB_COLUMN);
  const range = `${SHEET_NAME}!${colLetter}1:${colLetter}${totalNeeded}`;

  const sheetMeta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = sheetMeta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" tidak ditemukan.`);
  const sheetId = sheet.properties.sheetId;

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
  });

  const rows = response.data.values || [];
  if (rows.length < totalNeeded) {
    throw new Error(`Database kurang! Kamu minta ${totalNeeded} nomor, tapi bot hanya bisa baca ${rows.length} nomor di kolom ${colLetter}.`);
  }

  const picked = [];
  for (let i = 0; i < totalNeeded; i++) {
    const val = rows[i] && rows[i][0] ? rows[i][0].toString().trim() : "";
    if (!val) throw new Error(`Ada baris kosong (blank cell) di urutan ke-${i + 1}. Harap rapikan datamu.`);
    picked.push(val);
  }

  // Delete rows
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: sheetId, dimension: "ROWS", startIndex: 0, endIndex: totalNeeded },
        },
      }],
    },
  });

  return picked;
}

// ===== Create vCard =====
function createVcard(numbers, filename, letter) {
  let content = "";
  numbers.forEach((num, idx) => {
    const name = `${letter} ${String(idx + 1).padStart(3, "0")}`;
    content += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nTEL;TYPE=CELL:${num}\nEND:VCARD\n`;
  });
  fs.writeFileSync(filename, content, "utf-8");
}

// ===== /start =====
bot.start(async (ctx) => {
  await ctx.reply("✅ Bot siap melayani.\nJalur japri sudah terbuka!\nKetik /vcard <jumlah_file> <isi> di grup.");
});

// ===== /vcard =====
bot.command("vcard", async (ctx) => {
  const user = ctx.from;
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);

  if (parts.length !== 3) {
    return ctx.reply("❌ Format salah! Gunakan: `/vcard <jumlah_file> <isi_per_file>`", { parse_mode: "Markdown" });
  }

  const fileCount = parseInt(parts[1], 10);
  const perFile = parseInt(parts[2], 10);

  if (!Number.isInteger(fileCount) || !Number.isInteger(perFile) || fileCount <= 0 || perFile <= 0) {
    return ctx.reply("❌ jumlah_file dan isi_per_file harus berupa angka lebih dari 0.");
  }

  // Cek izin japri
  try {
    await ctx.telegram.sendMessage(user.id, `⏳ Tunggu sebentar ya, sedang menyusun \`${fileCount}\` file vCard...`, { parse_mode: "Markdown" });
  } catch (err) {
    return ctx.reply(`❌ @${user.username || user.first_name}, bot belum punya izin japri kamu. Klik tombol di bawah.`, {
      reply_markup: { inline_keyboard: [[{ text: "Buka Japri", url: `https://t.me/${ctx.botInfo.username}?start=start` }]] }
    });
  }

  if (ctx.chat.type !== "private") {
    await ctx.reply(`✅ Permintaan diterima @${user.username || user.first_name}. Silakan cek japri ya!`);
  }

  const totalNeeded = fileCount * perFile;
  let numbers = [];

  try {
    numbers = await getAndDeleteNumbers(totalNeeded);
  } catch (err) {
    // Kalau database kurang/error, lapor ke japri user
    console.error("Sheet Error:", err.message);
    await ctx.telegram.sendMessage(user.id, `❌ *PROSES GAGAL*\n\nAlasan: ${err.message}`, { parse_mode: "Markdown" });
    return;
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let index = 0;
  let successCount = 0;

  for (let i = 0; i < fileCount; i++) {
    const batch = numbers.slice(index, index + perFile);
    index += perFile;

    // Nama file dibuat SUPER UNIK agar tidak bentrok
    const tempFileName = `vcard_${user.id}_${Date.now()}_${i + 1}.vcf`;
    const tempPath = path.join(os.tmpdir(), tempFileName);
    
    try {
      createVcard(batch, tempPath, letters[i % 26]);

      // Menggunakan ReadStream agar file dikirim dengan sempurna oleh sistem
      await ctx.telegram.sendDocument(user.id, {
        source: fs.createReadStream(tempPath),
        filename: `Vcard_${i + 1}.vcf`
      });
      
      successCount++;
    } catch (err) {
      console.error("Gagal kirim dokumen:", err);
      await ctx.telegram.sendMessage(user.id, `⚠️ Gagal mengirim file ke-${i + 1}. Error dari Telegram.`);
    } finally {
      // Pastikan selalu menghapus file temporary setelah kirim
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }

    await sleep(1000); // Jeda 1 detik antar file agar tidak dianggap SPAM oleh Telegram
  }

  if (successCount === fileCount) {
    await ctx.telegram.sendMessage(user.id, "🎉 *SEMUA FILE SELESAI DIKIRIM!*", { parse_mode: "Markdown" });
  } else {
    await ctx.telegram.sendMessage(user.id, "⚠️ Proses selesai, tapi sepertinya ada beberapa file yang gagal terkirim.");
  }
});

// ===== RUN BOT =====
bot.launch().then(() => console.log("🟢 BOT VCARD BERJALAN DENGAN SEMPURNA!"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
