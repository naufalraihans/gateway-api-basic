const fs = require('fs');
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
let currentPairingCode = null;
let isConnected = false;
let isReconnecting = false;
let pairingRequested = false;

// Simpan pesan masuk di memory
const inboxMessages = {};
const MAX_MESSAGES_PER_NUMBER = 50;

// ==================== HELPERS ====================

function ensureSessionDir() {
  if (!fs.existsSync(config.sessionDir)) {
    fs.mkdirSync(config.sessionDir, { recursive: true });
  }
}

function formatNumber(number) {
  let clean = number.replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.substring(1);
  }
  return clean;
}

// ==================== CORE ====================

async function connectToWhatsApp(phoneNumber) {
  ensureSessionDir();

  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info('Connecting with WA v' + version.join('.'));

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    sock = makeWASocket({
      version,
      logger: logger.child({ module: 'baileys' }),
      printQRInTerminal: false,
      auth: state,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // ---- CONNECTION UPDATE ----
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        currentPairingCode = null;
        isConnected = false;
        pairingRequested = false;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.info('Connection closed (code: ' + statusCode + '). ' + (shouldReconnect ? 'Reconnecting...' : 'Logged out.'));

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
        currentPairingCode = null;
        isConnected = true;
        isReconnecting = false;
        pairingRequested = false;
        logger.info('WhatsApp connected!');
      }
    });

    // ---- REQUEST PAIRING CODE ----
    // Pairing code hanya bisa diminta setelah socket ready tapi sebelum authenticated
    if (phoneNumber && !sock.authState.creds.registered) {
      const cleanPhone = formatNumber(phoneNumber);
      
      // Tunggu socket siap
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        currentPairingCode = code;
        pairingRequested = true;
        logger.info('Pairing code for ' + cleanPhone + ': ' + code);
      } catch (err) {
        logger.error('Failed to request pairing code: ' + err.message);
      }
    }

    // ---- HELPER: simpan pesan ke inbox ----
    function storeMessage(msg) {
      try {
        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;

        const senderNumber = senderJid.replace('@s.whatsapp.net', '');

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.buttonsResponseMessage?.selectedDisplayText ||
          msg.message?.listResponseMessage?.title ||
          msg.message?.templateButtonReplyMessage?.selectedDisplayText ||
          null;

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

        const exists = inboxMessages[senderNumber].some(m => m.id === entry.id);
        if (exists) return;

        inboxMessages[senderNumber].push(entry);
        inboxMessages[senderNumber].sort((a, b) => a.timestamp - b.timestamp);

        if (inboxMessages[senderNumber].length > MAX_MESSAGES_PER_NUMBER) {
          inboxMessages[senderNumber] = inboxMessages[senderNumber].slice(-MAX_MESSAGES_PER_NUMBER);
        }
      } catch (err) {
        // Silent fail
      }
    }

    // ---- HISTORY SYNC ----
    sock.ev.on('messaging-history.set', ({ messages: historyMessages }) => {
      logger.info('History sync: ' + historyMessages.length + ' messages');
      for (const msg of historyMessages) {
        storeMessage(msg);
      }
      const totalStored = Object.values(inboxMessages).reduce((sum, arr) => sum + arr.length, 0);
      logger.info('Total in inbox: ' + totalStored);
    });

    // ---- REAL-TIME MESSAGES ----
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        storeMessage(msg);
        if (type === 'notify' && !msg.key.fromMe) {
          const sender = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[media]';
          logger.info('New msg from ' + sender + ': ' + text.substring(0, 50));
        }
      }
    });

    return sock;
  } catch (err) {
    logger.error('Connection failed', err);
  }
}

// ==================== PUBLIC API ====================

function getPairingCode()       { return currentPairingCode; }
function getConnectionStatus()  { return isConnected; }

async function sendMessage(number, message) {
  if (!isConnected || !sock) throw new Error('WhatsApp belum terkoneksi.');
  const clean = formatNumber(number);
  const jid = clean + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text: message });
}

function getMessages(number) {
  const clean = formatNumber(number);
  return inboxMessages[clean] || [];
}

function getAllMessages() {
  return inboxMessages;
}

async function logout() {
  if (sock) {
    await sock.logout();
    isConnected = false;
    currentPairingCode = null;
    pairingRequested = false;
  }
  if (fs.existsSync(config.sessionDir)) {
    fs.rmSync(config.sessionDir, { recursive: true, force: true });
  }
}

module.exports = {
  connectToWhatsApp,
  getPairingCode,
  getConnectionStatus,
  sendMessage,
  getMessages,
  getAllMessages,
  logout,
};
