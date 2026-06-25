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
const DB_COLUMN = parseInt(process.env.DB_COLUMN || "1", 10); // 1 = kolom A
const GOOGLE_CREDS_JSON = process.env.GOOGLE_CREDS_JSON;
// USERS_FILE sudah tidak terlalu dibutuhkan karena kita pakai metode pre-check PM
// tapi tetap disisakan jika kamu butuh untuk fitur lain.
const USERS_FILE = process.env.USERS_FILE || "users.json";
// =======================================================

if (!BOT_TOKEN) throw new Error("❌ BOT_TOKEN tidak ditemukan. Set di Render env vars.");
if (!SPREADSHEET_ID) throw new Error("❌ SPREADSHEET_ID tidak ditemukan. Set di Render env vars.");
if (!GOOGLE_CREDS_JSON) throw new Error("❌ GOOGLE_CREDS_JSON tidak ditemukan. Set di Render env vars.");
if (!SHEET_NAME) throw new Error("❌ SHEET_NAME kosong.");
if (!DB_COLUMN || DB_COLUMN < 1) throw new Error("❌ DB_COLUMN harus angka >= 1");

// ===== HTTP Server (Render Web Service needs open port) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.status(200).send("✅ Bot is running (Web Service)!"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ===== Telegram Bot =====
const bot = new Telegraf(BOT_TOKEN);

// ===== Google Credentials =====
let creds = {};
try {
  creds = JSON.parse(GOOGLE_CREDS_JSON);
} catch {
  throw new Error("❌ GOOGLE_CREDS_JSON bukan JSON valid. Paste credentials.json full.");
}

if (creds.private_key) {
  creds.private_key = creds.private_key.replace(/\\n/g, "\n").replace(/\r/g, "");
}

// ===== JWT Auth =====
const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

// ===== googleapis sheets client =====
const sheetsApi = google.sheets({ version: "v4", auth: jwt });

// ===== Helper: Konversi Angka ke Huruf Kolom (1 -> A, 2 -> B) =====
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

// ===== sleep helper =====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Get & delete numbers (Fast Method using googleapis) =====
async function getAndDeleteNumbers(totalNeeded) {
  const colLetter = getColLetter(DB_COLUMN);
  const range = `${SHEET_NAME}!${colLetter}1:${colLetter}${totalNeeded}`;

  // 1. Dapatkan metadata untuk mencari sheetId
  const sheetMeta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = sheetMeta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`❌ Sheet "${SHEET_NAME}" tidak ditemukan.`);
  const sheetId = sheet.properties.sheetId;

  // 2. READ: Ambil data secara instan (Jauh lebih cepat dari google-spreadsheet)
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
  });

  const rows = response.data.values || [];
  if (rows.length < totalNeeded) return []; // Database kurang

  const picked = [];
  for (let i = 0; i < totalNeeded; i++) {
    // Ambil value dari array, pastikan tidak kosong
    const val = rows[i] && rows[i][0] ? rows[i][0].toString().trim() : "";
    if (!val) return []; // Jika menemukan cell kosong di tengah jalan, stop.
    picked.push(val);
  }

  // 3. WRITE: Delete N baris pertama
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: 0,
              endIndex: totalNeeded,
            },
          },
        },
      ],
    },
  });

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
  await ctx.reply(
    "✅ Bot siap melayani.\n\n" +
    "Jalur komunikasi japri sudah terbuka.\n\n" +
    "Cara pakai:\n" +
    "`/vcard <jumlah_file> <isi_per_file>`\n" +
    "Contoh: `/vcard 2 300`",
    { parse_mode: "Markdown" }
  );
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

  // ===== CEK KONEKSI JAPRI SEBELUM AKSES GOOGLE SHEETS =====
  // Ini mencegah database terpotong jika user belum start bot
  let canPM = true;
  try {
    // Kirim pesan notifikasi ke japri user
    await ctx.telegram.sendMessage(user.id, `⏳ Otw proses \`${fileCount}\` file vCard ya...`, { parse_mode: "Markdown" });
  } catch (err) {
    canPM = false;
  }

  // Jika gagal kirim japri, beri info di grup & BERHENTIKAN PROSES
  if (!canPM) {
    return ctx.reply(
      `❌ Gagal memproses!\n\n@${user.username || user.first_name}, bot belum memiliki izin untuk japri kamu.\nSilakan klik tombol di bawah ini lalu tekan **START**.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Mulai Bot (Buka Japri)", url: `https://t.me/${ctx.botInfo.username}?start=start` }]
          ]
        }
      }
    );
  }

  // Jika request dari grup, beri info kalau proses sedang berjalan
  if (ctx.chat.type !== "private") {
    await ctx.reply(`✅ Permintaan diterima @${user.username || user.first_name}. Silakan cek japri ya!`);
  }

  // ===== AMBIL & POTONG DATA DI GOOGLE SHEETS =====
  const totalNeeded = fileCount * perFile;
  let numbers = [];
  
  try {
    numbers = await getAndDeleteNumbers(totalNeeded);
  } catch (err) {
    console.error("Google Sheet Error:", err);
    await ctx.telegram.sendMessage(user.id, "❌ Error akses Google Sheet! Cek log server.");
    return;
  }

  if (!numbers || numbers.length === 0) {
    await ctx.telegram.sendMessage(user.id, "❌ Database tidak mencukupi atau terdapat cell kosong di baris awal.");
    return;
  }

  // ===== BUAT & KIRIM VCARD =====
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
      console.error("Gagal kirim file VCard ke", user.id);
      // Jika di tengah pengiriman user memblokir bot, loop dihentikan agar tidak spam error
      break; 
    }

    // Hapus file temporary
    try {
      fs.unlinkSync(filename);
    } catch {}

    await sleep(300); // Hindari limit Telegram (Flood Wait)
  }

  await ctx.telegram.sendMessage(user.id, "✅ Semua file VCard berhasil dikirim!");
});

// ===== RUN BOT =====
bot.launch().then(() => {
  console.log("🟢 VCARD BOT + WEB SERVICE BERJALAN LANCAR (ANTI TIMEOUT READY)");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
