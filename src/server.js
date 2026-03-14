const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const apiRoutes = require('./api/routes');
const wa = require('./whatsapp/client');
const logger = require('./utils/logger');

const app = express();

app.use(cors());
app.use(express.json());

// ==================== WEB DASHBOARD ====================
// Halaman scan QR langsung dari browser — gak perlu copy-paste base64 lagi

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WA Gateway</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #1a1a2e;
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { font-size: 1.5rem; margin-bottom: 8px; color: #25D366; }
    p.sub { font-size: 0.85rem; color: #888; margin-bottom: 24px; }
    #qr-img { border-radius: 12px; margin: 16px 0; background: white; padding: 12px; }
    #status {
      font-size: 1rem;
      padding: 12px 24px;
      border-radius: 8px;
      margin-top: 16px;
      display: inline-block;
    }
    .connected { background: #25D366; color: #000; font-weight: bold; }
    .waiting { background: #333; color: #ccc; }
    .endpoints {
      margin-top: 24px;
      text-align: left;
      font-size: 0.8rem;
      color: #666;
      border-top: 1px solid #333;
      padding-top: 16px;
    }
    .endpoints code {
      color: #25D366;
      background: #111;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .endpoints li { margin: 6px 0; list-style: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📱 WA Gateway</h1>
    <p class="sub">Scan QR code di bawah dengan WhatsApp → Linked Devices</p>
    
    <div id="content">
      <div id="status" class="waiting">⏳ Loading...</div>
    </div>

    <ul class="endpoints">
      <li>📤 Kirim: <code>POST /send</code></li>
      <li>📩 Inbox: <code>GET /messages/628xxx</code></li>
      <li>🔌 Status: <code>GET /session/status</code></li>
      <li>🚪 Logout: <code>POST /session/logout</code></li>
    </ul>
  </div>

  <script>
    async function poll() {
      try {
        // Cek status dulu
        const statusRes = await fetch('/session/status');
        const statusData = await statusRes.json();
        
        if (statusData.connected) {
          document.getElementById('content').innerHTML = 
            '<div id="status" class="connected">✅ WhatsApp Terkoneksi!</div>';
          return; // Stop polling
        }

        // Kalau belum connected, minta QR
        const qrRes = await fetch('/session/start');
        const qrData = await qrRes.json();

        if (qrData.qr) {
          document.getElementById('content').innerHTML = 
            '<img id="qr-img" src="' + qrData.qr + '" width="256" height="256" />' +
            '<div id="status" class="waiting">📷 Scan QR code ini</div>';
        } else if (qrData.status === 'connected') {
          document.getElementById('content').innerHTML = 
            '<div id="status" class="connected">✅ WhatsApp Terkoneksi!</div>';
          return;
        } else {
          document.getElementById('content').innerHTML = 
            '<div id="status" class="waiting">⏳ Generating QR code...</div>';
        }
      } catch (e) {
        document.getElementById('content').innerHTML = 
          '<div id="status" class="waiting">❌ Server error</div>';
      }
      // Poll setiap 3 detik
      setTimeout(poll, 3000);
    }
    poll();
  </script>
</body>
</html>`);
});

// ==================== API ROUTES ====================
app.use('/', apiRoutes);

// Error handler
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START ====================
app.listen(config.port, async () => {
  logger.info('=================================');
  logger.info('Server running on port ' + config.port);
  logger.info('Open http://localhost:' + config.port + ' to scan QR');
  logger.info('=================================');

  if (fs.existsSync(config.sessionDir)) {
    logger.info('Session found, auto-connecting...');
    await wa.connectToWhatsApp();
  } else {
    logger.info('No session found. Open browser to scan QR code.');
  }
});
