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

// Map LID ke nomor telepon (diisi dari contacts saat sync)
const lidToPhone = {};
// Map LID/Phone ke Nama (pushName)
const idToName = {};

/**
 * Simpan satu pesan ke inbox
 */
function storeMessage(msg) {
  try {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

    let senderNumber;
    let pushName = msg.pushName || 'Unknown';

    if (remoteJid.endsWith('@s.whatsapp.net')) {
      senderNumber = remoteJid.replace('@s.whatsapp.net', '');
    } else if (remoteJid.endsWith('@lid')) {
      const lid = remoteJid.replace('@lid', '');
      senderNumber = lidToPhone[lid] || lid;
    } else {
      return;
    }

    // Simpan mapping nama
    if (pushName !== 'Unknown') {
      idToName[senderNumber] = pushName;
    } else if (idToName[senderNumber]) {
      pushName = idToName[senderNumber];
    }

    const text = extractText(msg);
    if (!text) return;

    const entry = {
      id: msg.key.id,
      from: senderNumber,
      pushName: pushName,
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

      // ---- CONTACTS SYNC (buat mapping LID → nomor telepon) ----
      if (events['contacts.upsert']) {
        const contacts = events['contacts.upsert'];
        for (const contact of contacts) {
          // contact.id bisa berformat @s.whatsapp.net atau @lid
          // contact.lid punya LID-nya
          if (contact.lid) {
            const lid = contact.lid.replace('@lid', '');
            const phone = contact.id?.replace('@s.whatsapp.net', '');
            if (phone && !phone.includes('@')) {
              lidToPhone[lid] = phone;
            }
          }
          // Kadang id-nya @lid dan notify punya nomor
          if (contact.id?.endsWith('@lid') && contact.notify) {
            // Cuma simpan nama, gak bisa resolve nomor dari sini
          }
        }
        logger.info('Contacts synced. LID mappings: ' + Object.keys(lidToPhone).length);
      }

      // ---- CONTACTS UPDATE ----
      if (events['contacts.update']) {
        const contacts = events['contacts.update'];
        for (const contact of contacts) {
          if (contact.lid) {
            const lid = contact.lid.replace('@lid', '');
            const phone = contact.id?.replace('@s.whatsapp.net', '');
            if (phone && !phone.includes('@')) {
              lidToPhone[lid] = phone;
            }
          }
        }
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

      // ---- REAL-TIME MESSAGES ----
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        for (const msg of messages) {
          storeMessage(msg);
          if (type === 'notify') {
            const remoteJid = msg.key.remoteJid;
            const text = extractText(msg) || '[media]';
            
            let sender = remoteJid?.replace('@s.whatsapp.net', '');
            if (remoteJid?.endsWith('@lid')) {
              const lid = remoteJid.replace('@lid', '');
              
              // Baileys v7 kadang nyisipin nomor asli di participant atau message
              // Coba cari bocoran nomor HP di payload msg
              let leakedPhone = null;
              
              if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
                leakedPhone = msg.participant.replace('@s.whatsapp.net', '');
              } else if (msg.key?.participant && msg.key.participant.includes('@s.whatsapp.net')) {
                leakedPhone = msg.key.participant.replace('@s.whatsapp.net', '');
              }

              if (leakedPhone && !lidToPhone[lid]) {
                lidToPhone[lid] = leakedPhone;
                logger.info('Auto-resolved from payload: ' + lid + ' -> ' + leakedPhone);
              }
              
              sender = lidToPhone[lid] || lid;
              
              if (!lidToPhone[lid] && !msg.key.fromMe) {
                logger.info('Unknown LID received: ' + lid + '. Manual mapping required or send API message first.');
                // Kita gausah balas ZWSP lagi karena bikin error decrypt di HP pengirim.
                // Log payload untuk debugging supaya user bisa map manual
                // logger.debug('Payload LID: ' + JSON.stringify(msg));
              }
            }
            
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
  const result = await sock.sendMessage(jid, { text: message });

  // Tangkap LID mapping dari response — ini kunci buat resolve LID ke nomor telepon
  if (result?.key?.remoteJid?.endsWith('@lid')) {
    const lid = result.key.remoteJid.replace('@lid', '');
    lidToPhone[lid] = clean;
    logger.info('LID mapped: ' + lid + ' -> ' + clean);
  }
}

/**
 * Cari pesan dari nomor tertentu atau NAMA (pushName)
 */
function getMessages(query) {
  const cleanQuery = query.toLowerCase();
  let messages = [];

  // Cari di semua key
  for (const [key, msgs] of Object.entries(inboxMessages)) {
    let match = false;
    
    // 1. Cocok dengan Key (Phone number atau LID)
    if (key.includes(cleanQuery)) match = true;
    
    // 2. Cocok dengan mapping Phone dari lidToPhone
    if (!match && lidToPhone[key] && lidToPhone[key].includes(cleanQuery)) match = true;
    
    // 3. Cocok dengan pushName (Nama)
    if (!match && idToName[key] && idToName[key].toLowerCase().includes(cleanQuery)) match = true;

    if (match) {
      messages = messages.concat(msgs);
    }
  }

  // Deduplicate & sort
  const seen = new Set();
  messages = messages.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).sort((a, b) => a.timestamp - b.timestamp);

  return messages;
}

/**
 * List semua percakapan yang ada (key + nama + jumlah pesan + preview)
 */
function getConversations() {
  const convos = [];
  for (const [key, msgs] of Object.entries(inboxMessages)) {
    if (msgs.length === 0) continue;
    const last = msgs[msgs.length - 1];
    convos.push({
      id: key,
      pushName: idToName[key] || 'Unknown',
      resolvedPhone: lidToPhone[key] || null,
      messageCount: msgs.length,
      lastMessage: last.text.substring(0, 100),
      lastTimestamp: last.timestamp,
    });
  }
  return convos.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

function getAllMessages() {
  return inboxMessages;
}

/**
 * Resolve nomor telepon ke LID — kirim read receipt dummy buat tangkap mapping
 */
async function resolveNumber(number) {
  if (!isConnected || !sock) throw new Error('WhatsApp belum terkoneksi.');
  const clean = formatNumber(number);

  // Cek dulu apakah sudah ada mapping
  for (const [lid, phone] of Object.entries(lidToPhone)) {
    if (phone === clean) return { phone: clean, lid, status: 'already_mapped' };
  }

  // Kirim presence subscribe + typing indicator buat trigger LID resolution
  const jid = clean + '@s.whatsapp.net';
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 500));
    await sock.sendPresenceUpdate('paused', jid);
  } catch (e) {
    // Ignore presence errors
  }

  // Kirim pesan "kosong" yg langsung di-delete (react ke pesan sendiri) — nope, terlalu complex.
  // Cara paling reliable: kirim pesan asli tapi tiny
  // Untuk sekarang, coba sendMessage internal
  try {
    const result = await sock.sendMessage(jid, { text: '.' });
    if (result?.key?.remoteJid?.endsWith('@lid')) {
      const lid = result.key.remoteJid.replace('@lid', '');
      lidToPhone[lid] = clean;
      logger.info('LID resolved: ' + lid + ' -> ' + clean);
      return { phone: clean, lid, status: 'resolved' };
    }
  } catch (e) {
    logger.error('Resolve failed: ' + e.message);
  }

  return { phone: clean, lid: null, status: 'failed' };
}

/**
 * Manual mapping LID → nomor telepon
 */
function mapLid(lid, phone) {
  const cleanPhone = formatNumber(phone);
  const cleanLid = lid.replace('@lid', '');
  lidToPhone[cleanLid] = cleanPhone;
  logger.info('Manual LID map: ' + cleanLid + ' -> ' + cleanPhone);

  // Pindahkan pesan dari key LID ke key nomor telepon
  if (inboxMessages[cleanLid]) {
    if (!inboxMessages[cleanPhone]) {
      inboxMessages[cleanPhone] = [];
    }
    for (const msg of inboxMessages[cleanLid]) {
      msg.from = cleanPhone;
      const exists = inboxMessages[cleanPhone].some(m => m.id === msg.id);
      if (!exists) inboxMessages[cleanPhone].push(msg);
    }
    inboxMessages[cleanPhone].sort((a, b) => a.timestamp - b.timestamp);
    delete inboxMessages[cleanLid];
  }

  return { lid: cleanLid, phone: cleanPhone, status: 'mapped' };
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
  resolveNumber,
  mapLid,
  getMessages,
  getConversations,
  getAllMessages,
  logout,
};
