const express = require("express");
const { Telegraf } = require("telegraf");
const { JWT } = require("google-auth-library");
const { google } = require("googleapis");

// ===== 🛡️ SABUK PENGAMAN ANTI-CRASH =====
process.on('uncaughtException', (err) => {
  console.error('💥 [Tercegah] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [Tercegah] Unhandled Rejection:', reason);
});

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
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000000 });

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
    throw new Error(`Database kurang! Minta ${totalNeeded}, sisa ${rows.length}.`);
  }

  const picked = [];
  for (let i = 0; i < totalNeeded; i++) {
    const val = rows[i] && rows[i][0] ? rows[i][0].toString().trim() : "";
    if (!val) throw new Error(`Ada cell kosong di baris ke-${i + 1}.`);
    picked.push(val);
  }

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

// ===== Generate vCard Text =====
function generateVcardText(numbers, letter) {
  let content = "";
  numbers.forEach((num, idx) => {
    const name = `${letter} ${String(idx + 1).padStart(3, "0")}`;
    content += `BEGIN:VCARD\nVERSION:3.0\nN:${name};;;;\nFN:${name}\nTEL;TYPE=CELL:${num}\nEND:VCARD\n`;
  });
  return content;
}

// ===== /start =====
bot.start(async (ctx) => {
  try {
    await ctx.reply("✅ Bot vCard Aktif.\nGas request sudah bisa!\nKetik /vcard <jumlah_file> <isi> di grup.");
  } catch(e) { console.error("Start error", e); }
});

// ===== /vcard =====
bot.command("vcard", async (ctx) => {
  const user = ctx.from;
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);

  if (parts.length !== 3) {
    try { await ctx.reply("❌ Format: `/vcard <jumlah_file> <isi_per_file>`", { parse_mode: "Markdown" }); } catch(e){}
    return;
  }

  const fileCount = parseInt(parts[1], 10);
  const perFile = parseInt(parts[2], 10);

  if (!Number.isInteger(fileCount) || !Number.isInteger(perFile) || fileCount <= 0 || perFile <= 0) {
    try { await ctx.reply("❌ jumlah dan isi harus angka > 0."); } catch(e){}
    return;
  }

  // Cek Izin Japri
  try {
    await ctx.telegram.sendMessage(user.id, `⏳ Tunggu sebentar ya, sedang menyusun \`${fileCount}\` file vCard...`, { parse_mode: "Markdown" });
  } catch (err) {
    try {
      await ctx.reply(`❌ @${user.username || user.first_name}, bot belum punya izin japri.`, {
        reply_markup: { inline_keyboard: [[{ text: "Buka Japri", url: `https://t.me/${ctx.botInfo.username}?start=start` }]] }
      });
    } catch(e){}
    return;
  }

  if (ctx.chat.type !== "private") {
    try { await ctx.reply(`⏳ Otw proses ya @${user.username || user.first_name}. Silakan cek japri saya.`); } catch(e){}
  }

  const totalNeeded = fileCount * perFile;
  let numbers = [];

  try {
    numbers = await getAndDeleteNumbers(totalNeeded);
  } catch (err) {
    console.error("Sheet Error:", err.message);
    try { await ctx.telegram.sendMessage(user.id, `❌ *PROSES GAGAL*\n${err.message}`, { parse_mode: "Markdown" }); } catch(e){}
    return;
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let index = 0;
  let successCount = 0;

  for (let i = 0; i < fileCount; i++) {
    const batch = numbers.slice(index, index + perFile);
    index += perFile;

    const vcardText = generateVcardText(batch, letters[i % 26]);
    const fileName = `Vcard_${letters[i % 26]}_${i + 1}.vcf`;

    try { await ctx.telegram.sendMessage(user.id, `🚀 Mengirim file ke-${i + 1}...`); } catch(e){}

    let success = false;
    let attempt = 0;

    while (attempt < 3 && !success) {
      try {
        // 🔥 BYPASS TELEGRAF UPLOADER - Murni menggunakan Native Fetch API NodeJS
        const formData = new FormData();
        formData.append('chat_id', user.id.toString());
        
        // Konversi teks menjadi virtual file (Blob)
        const fileBlob = new Blob([vcardText], { type: 'text/vcard' });
        formData.append('document', fileBlob, fileName);

        // Eksekusi pengiriman langsung ke server Telegram (Batas waktu tegas 15 detik)
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(15000) // Memaksa putus jika lebih dari 15 detik
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText);
        }

        success = true;
        successCount++;
      } catch (err) {
        attempt++;
        console.error(`Gagal kirim file, coba ${attempt}:`, err.message);
        if (attempt >= 3) {
          try { await ctx.telegram.sendMessage(user.id, `⚠️ Gagal mengirim file ke-${i + 1}. Error: ${err.message}`); } catch(e){}
        } else {
          await sleep(2000); // Jeda sebelum auto-retry
        }
      }
    }

    await sleep(1500); // Jeda anti flood limit antar file
  }

  if (successCount === fileCount) {
    try { await ctx.telegram.sendMessage(user.id, "✅ *DONE SEMUA FILE BERHASIL DIKIRIM!*", { parse_mode: "Markdown" }); } catch(e){}
  } else {
    try { await ctx.telegram.sendMessage(user.id, `⚠️ Selesai, tapi hanya ${successCount} dari ${fileCount} file terkirim.`); } catch(e){}
  }
});

bot.launch().then(() => console.log("🟢 BOT VCARD BERJALAN: NATIVE FETCH BYPASS AKTIF"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
