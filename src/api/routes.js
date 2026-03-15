const express = require('express');
const router = express.Router();
const c = require('./controllers');

// Session — start sekarang pakai POST (kirim nomor telepon)
router.post('/session/start',  c.startSession);
router.get('/session/status',  c.getStatus);
router.post('/session/logout', c.logoutSession);

// Kirim pesan
router.post('/send', c.sendMessage);

// Baca pesan masuk
router.get('/conversations',    c.getConversations); // list semua chat
router.get('/messages',         c.getAllMessages);
router.get('/messages/:number', c.getMessages);

module.exports = router;
