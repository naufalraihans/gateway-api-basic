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

    // ---- HELPER: simpan pesan ke inbox ----
    function storeMessage(msg) {
      try {
        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;

        const senderNumber = senderJid.replace('@s.whatsapp.net', '');

        // Ambil text dari berbagai tipe pesan
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.buttonsResponseMessage?.selectedDisplayText ||
          msg.message?.listResponseMessage?.title ||
          msg.message?.templateButtonReplyMessage?.selectedDisplayText ||
          null;

        // Skip kalau gak ada content sama sekali
        if (!text) return;

        const entry = {
          id: msg.key.id,
          from: senderNumber,
          fromMe: msg.key.fromMe || false,
          text: text,
          timestamp: typeof msg.messageTimestamp === 'object' 
            ? msg.messageTimestamp.low 
            : Number(msg.messageTimestamp),
        };

        if (!inboxMessages[senderNumber]) {
          inboxMessages[senderNumber] = [];
        }

        // Cek duplikat berdasarkan message ID
        const exists = inboxMessages[senderNumber].some(m => m.id === entry.id);
        if (exists) return;

        inboxMessages[senderNumber].push(entry);

        // Sort by timestamp (oldest first)
        inboxMessages[senderNumber].sort((a, b) => a.timestamp - b.timestamp);

        // Limit supaya gak kebanyakan
        if (inboxMessages[senderNumber].length > MAX_MESSAGES_PER_NUMBER) {
          inboxMessages[senderNumber] = inboxMessages[senderNumber].slice(-MAX_MESSAGES_PER_NUMBER);
        }
      } catch (err) {
        // Silent fail — jangan crash gara-gara satu pesan
      }
    }

    // ---- HISTORY SYNC (pesan lama saat pertama connect) ----
    sock.ev.on('messaging-history.set', ({ messages: historyMessages, isLatest }) => {
      logger.info('History sync received: ' + historyMessages.length + ' messages');
      for (const msg of historyMessages) {
        storeMessage(msg);
      }
      const totalStored = Object.values(inboxMessages).reduce((sum, arr) => sum + arr.length, 0);
      logger.info('Total messages in inbox: ' + totalStored);
    });

    // ---- REAL-TIME INCOMING MESSAGES ----
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      logger.info('messages.upsert — type: ' + type + ', count: ' + messages.length);
      for (const msg of messages) {
        storeMessage(msg);
        
        // Log real-time messages
        if (type === 'notify' && !msg.key.fromMe) {
          const sender = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[media]';
          logger.info('New message from ' + sender + ': ' + text.substring(0, 50));
        }
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
