const fs = require('fs');
const qrcode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const logger = require('../utils/logger');
const config = require('../config');

// ==================== STATE ====================
let sock = null;
let currentQr = null;
let isConnected = false;
let isReconnecting = false;

// Simpan pesan masuk di memory: { "628xxx": [ {id, from, text, timestamp}, ... ] }
const inboxMessages = {};

// Limit pesan per nomor supaya RAM gak jebol
const MAX_MESSAGES_PER_NUMBER = 50;

// ==================== HELPERS ====================

function ensureSessionDir() {
  if (!fs.existsSync(config.sessionDir)) {
    fs.mkdirSync(config.sessionDir, { recursive: true });
  }
}

/**
 * Format nomor WA: buang karakter non-digit, buang leading 0 kalau ada
 */
function formatNumber(number) {
  let clean = number.replace(/\D/g, '');
  // Kalau diawali 0, ganti jadi 62 (Indonesia)
  if (clean.startsWith('0')) {
    clean = '62' + clean.substring(1);
  }
  return clean;
}

// ==================== CORE ====================

async function connectToWhatsApp() {
  ensureSessionDir();

  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Connecting with WA v${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    sock = makeWASocket({
      version,
      logger: logger.child({ module: 'baileys' }),
      printQRInTerminal: true, // Juga print di terminal biar gampang
      auth: state,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // ---- CONNECTION UPDATE ----
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR Code ready — scan via /scan or terminal');
        try {
          currentQr = await qrcode.toDataURL(qr);
        } catch (err) {
          logger.error('QR generation failed', err);
        }
      }

      if (connection === 'close') {
        currentQr = null;
        isConnected = false;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.info(`Connection closed (code: ${statusCode}). ${shouldReconnect ? 'Reconnecting...' : 'Logged out.'}`);

        if (shouldReconnect && !isReconnecting) {
          isReconnecting = true;
          setTimeout(() => {
            isReconnecting = false;
            connectToWhatsApp();
          }, 3000);
        } else if (!shouldReconnect) {
          if (fs.existsSync(config.sessionDir)) {
            fs.rmSync(config.sessionDir, { recursive: true, force: true });
          }
        }
      } else if (connection === 'open') {
        currentQr = null;
        isConnected = true;
        isReconnecting = false;
        logger.info('✅ WhatsApp connected!');
      }
    });

    // ---- INCOMING MESSAGES ----
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Hanya proses pesan baru yang masuk (bukan history sync)
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip pesan dari diri sendiri
        if (msg.key.fromMe) continue;

        // Ambil nomor pengirim (tanpa @s.whatsapp.net)
        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us')) continue; // Skip group messages

        const senderNumber = senderJid.replace('@s.whatsapp.net', '');

        // Ambil text dari berbagai tipe pesan
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '[media/non-text message]';

        const entry = {
          id: msg.key.id,
          from: senderNumber,
          text: text,
          timestamp: msg.messageTimestamp,
        };

        // Simpan ke inbox
        if (!inboxMessages[senderNumber]) {
          inboxMessages[senderNumber] = [];
        }
        inboxMessages[senderNumber].push(entry);

        // Limit supaya gak kebanyakan
        if (inboxMessages[senderNumber].length > MAX_MESSAGES_PER_NUMBER) {
          inboxMessages[senderNumber].shift();
        }

        logger.info(`📩 Message from ${senderNumber}: ${text.substring(0, 50)}`);
      }
    });

    return sock;
  } catch (err) {
    logger.error('Connection failed', err);
  }
}

// ==================== PUBLIC API ====================

function getQrCode()          { return currentQr; }
function getConnectionStatus() { return isConnected; }

/**
 * Kirim pesan ke nomor tertentu
 */
async function sendMessage(number, message) {
  if (!isConnected || !sock) throw new Error('WhatsApp belum terkoneksi.');

  const clean = formatNumber(number);
  const jid = `${clean}@s.whatsapp.net`;

  await sock.sendMessage(jid, { text: message });
}

/**
 * Ambil pesan masuk dari nomor tertentu
 */
function getMessages(number) {
  const clean = formatNumber(number);
  return inboxMessages[clean] || [];
}

/**
 * Ambil semua pesan masuk (semua nomor)
 */
function getAllMessages() {
  return inboxMessages;
}

/**
 * Logout & hapus session
 */
async function logout() {
  if (sock) {
    await sock.logout();
    isConnected = false;
    currentQr = null;
  }
  if (fs.existsSync(config.sessionDir)) {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

module.exports = {
  connectToWhatsApp,
  getQrCode,
  getConnectionStatus,
  sendMessage,
  getMessages,
  getAllMessages,
  logout,
};
