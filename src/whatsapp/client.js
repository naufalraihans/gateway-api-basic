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

/**
 * Extract text content dari berbagai tipe pesan WA
 */
function extractText(msg) {
  if (!msg.message) return null;
  const m = msg.message;

  // Kadang pesan dibungkus dalam protocolMessage/ephemeralMessage
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m;

  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.documentMessage?.caption ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
    inner.templateButtonReplyMessage?.selectedDisplayText ||
    null
  );
}

/**
 * Simpan satu pesan ke inbox
 */
function storeMessage(msg) {
  try {
    const senderJid = msg.key.remoteJid;
    if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;

    const senderNumber = senderJid.replace('@s.whatsapp.net', '');
    const text = extractText(msg);
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

    // Skip duplikat
    if (inboxMessages[senderNumber].some(m => m.id === entry.id)) return;

    inboxMessages[senderNumber].push(entry);

    // Sort & limit
    inboxMessages[senderNumber].sort((a, b) => a.timestamp - b.timestamp);
    if (inboxMessages[senderNumber].length > MAX_MESSAGES_PER_NUMBER) {
      inboxMessages[senderNumber] = inboxMessages[senderNumber].slice(-MAX_MESSAGES_PER_NUMBER);
    }
  } catch (err) {
    // Silent fail
  }
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
      // PENTING: matikan event buffering supaya pesan masuk langsung diproses
      fireInitQueries: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // Langsung process events tanpa buffering
    sock.ev.process(async (events) => {

      // ---- CONNECTION UPDATE ----
      if (events['connection.update']) {
        const { connection, lastDisconnect } = events['connection.update'];

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
      }

      // ---- CREDS UPDATE ----
      if (events['creds.update']) {
        await saveCreds();
      }

      // ---- HISTORY SYNC ----
      if (events['messaging-history.set']) {
        const { messages: historyMessages } = events['messaging-history.set'];
        logger.info('History sync: ' + historyMessages.length + ' messages');
        for (const msg of historyMessages) {
          storeMessage(msg);
        }
        const total = Object.values(inboxMessages).reduce((s, a) => s + a.length, 0);
        logger.info('Total in inbox: ' + total);
      }

      // ---- REAL-TIME MESSAGES (ini yang penting buat responsif!) ----
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        for (const msg of messages) {
          storeMessage(msg);
          if (type === 'notify') {
            const sender = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
            const text = extractText(msg) || '[media]';
            const dir = msg.key.fromMe ? 'SENT' : 'RECV';
            logger.info('[' + dir + '] ' + sender + ': ' + text.substring(0, 80));
          }
        }
      }
    });

    // ---- REQUEST PAIRING CODE ----
    if (phoneNumber && !sock.authState.creds.registered) {
      const cleanPhone = formatNumber(phoneNumber);
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
