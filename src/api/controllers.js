const wa = require('../whatsapp/client');

// GET /session/start — Mulai session, return QR kalau belum login
const startSession = async (req, res) => {
  try {
    if (wa.getConnectionStatus()) {
      return res.json({ status: 'connected', message: 'WhatsApp sudah terkoneksi ✅' });
    }

    let qr = wa.getQrCode();
    if (qr) return res.json({ qr });

    // Belum ada QR & belum connected → mulai koneksi
    await wa.connectToWhatsApp();

    // Tunggu sebentar biar QR sempat di-generate
    await new Promise(r => setTimeout(r, 2500));

    qr = wa.getQrCode();
    if (qr) return res.json({ qr });

    return res.json({ message: 'Session dimulai. Hit endpoint ini lagi untuk dapat QR code.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal start session: ' + err.message });
  }
};

// GET /session/status — Cek apakah WA terkoneksi
const getStatus = (req, res) => {
  res.json({ connected: wa.getConnectionStatus() });
};

// POST /send — Kirim pesan
const sendMessage = async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: 'Butuh "number" dan "message" di body.' });
  }

  try {
    await wa.sendMessage(number, message);
    res.json({ status: 'sent', to: number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /messages/:number?limit=10 — Baca pesan masuk dari nomor tertentu
const getMessages = (req, res) => {
  const { number } = req.params;
  if (!number) {
    return res.status(400).json({ error: 'Nomor harus disertakan di URL.' });
  }

  const limit = parseInt(req.query.limit) || 10;
  const allMessages = wa.getMessages(number);
  const messages = allMessages.slice(-limit);

  res.json({ 
    number, 
    totalAvailable: allMessages.length,
    showing: messages.length, 
    messages 
  });
};

// GET /messages — Baca semua pesan masuk
const getAllMessages = (req, res) => {
  const all = wa.getAllMessages();
  res.json(all);
};

// POST /session/logout — Logout & hapus session
const logoutSession = async (req, res) => {
  try {
    await wa.logout();
    res.json({ status: 'logged_out', message: 'Session dihapus ✅' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { startSession, getStatus, sendMessage, getMessages, getAllMessages, logoutSession };
