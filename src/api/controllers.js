const wa = require('../whatsapp/client');

// POST /session/start — Mulai session dengan nomor telepon
const startSession = async (req, res) => {
  try {
    if (wa.getConnectionStatus()) {
      return res.json({ status: 'connected', message: 'WhatsApp sudah terkoneksi' });
    }

    // Ambil nomor dari body atau query
    const phone = req.body.phone || req.query.phone;
    if (!phone) {
      return res.status(400).json({ 
        error: 'Nomor telepon dibutuhkan',
        example: 'POST /session/start dengan body: { "phone": "08123456789" }'
      });
    }

    // Mulai koneksi dan minta pairing code
    await wa.connectToWhatsApp(phone);

    // Tunggu pairing code di-generate
    await new Promise(r => setTimeout(r, 3500));

    const code = wa.getPairingCode();
    if (code) {
      return res.json({ 
        pairingCode: code,
        message: 'Masukkan kode ini di WhatsApp HP kamu: Settings > Linked Devices > Link a Device > Link with phone number'
      });
    }

    // Cek lagi apakah sudah connected (session lama masih valid)
    if (wa.getConnectionStatus()) {
      return res.json({ status: 'connected', message: 'WhatsApp sudah terkoneksi' });
    }

    return res.json({ message: 'Sedang memproses. Coba hit endpoint ini lagi.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal start session: ' + err.message });
  }
};

// GET /session/status
const getStatus = (req, res) => {
  res.json({ connected: wa.getConnectionStatus() });
};

// POST /send
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

// GET /messages/:number?limit=10
const getMessages = (req, res) => {
  const { number } = req.params;
  if (!number) {
    return res.status(400).json({ error: 'Nomor harus disertakan di URL.' });
  }
  const limit = parseInt(req.query.limit) || 10;
  const allMessages = wa.getMessages(number);
  const messages = allMessages.slice(-limit);
  res.json({ number, totalAvailable: allMessages.length, showing: messages.length, messages });
};

// GET /messages
const getAllMessages = (req, res) => {
  res.json(wa.getAllMessages());
};

// POST /session/logout
const logoutSession = async (req, res) => {
  try {
    await wa.logout();
    res.json({ status: 'logged_out', message: 'Session dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { startSession, getStatus, sendMessage, getMessages, getAllMessages, logoutSession };
