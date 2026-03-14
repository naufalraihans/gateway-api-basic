const express = require('express');
const router = express.Router();
const c = require('./controllers');

// Session
router.get('/session/start',  c.startSession);
router.get('/session/status', c.getStatus);
router.post('/session/logout', c.logoutSession);

// Kirim pesan
router.post('/send', c.sendMessage);

// Baca pesan masuk
router.get('/messages',         c.getAllMessages);   // semua inbox
router.get('/messages/:number', c.getMessages);      // dari nomor tertentu

module.exports = router;
