const express = require('express');
const cors = require('cors');
const fs = require('fs');
const config = require('./config');
const apiRoutes = require('./api/routes');
const wa = require('./whatsapp/client');
const logger = require('./utils/logger');

const app = express();

app.use(cors());
app.use(express.json());

// ==================== WEB DASHBOARD ====================

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
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #333;
      border-radius: 8px;
      background: #111;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 12px;
      outline: none;
    }
    input:focus { border-color: #25D366; }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      background: #25D366;
      color: #000;
      font-size: 1rem;
      font-weight: bold;
      cursor: pointer;
    }
    button:hover { background: #1da851; }
    button:disabled { background: #333; color: #666; cursor: not-allowed; }
    .code-box {
      background: #111;
      border: 2px solid #25D366;
      border-radius: 12px;
      padding: 24px;
      margin: 16px 0;
      font-size: 2rem;
      font-weight: bold;
      letter-spacing: 8px;
      color: #25D366;
      font-family: monospace;
    }
    #status {
      font-size: 0.95rem;
      padding: 10px 20px;
      border-radius: 8px;
      margin-top: 12px;
      display: inline-block;
    }
    .connected { background: #25D366; color: #000; font-weight: bold; }
    .waiting { background: #333; color: #ccc; }
    .endpoints {
      margin-top: 24px;
      text-align: left;
      font-size: 0.78rem;
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
    .hint { font-size: 0.75rem; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WA Gateway</h1>
    <p class="sub">Login WhatsApp via Pairing Code</p>
    
    <div id="content">
      <div id="login-form">
        <input type="text" id="phone" placeholder="Nomor HP (contoh: 08123456789)" />
        <button id="btn" onclick="pair()">Login</button>
        <p class="hint">Buka WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number</p>
      </div>
    </div>

    <ul class="endpoints">
      <li>Kirim: <code>POST /send</code></li>
      <li>Inbox: <code>GET /messages/628xxx</code></li>
      <li>Status: <code>GET /session/status</code></li>
      <li>Logout: <code>POST /session/logout</code></li>
    </ul>
  </div>

  <script>
    // Cek status saat load
    async function checkStatus() {
      try {
        const res = await fetch('/session/status');
        const data = await res.json();
        if (data.connected) {
          document.getElementById('content').innerHTML = 
            '<div id="status" class="connected">WhatsApp Terkoneksi!</div>';
          return true;
        }
      } catch(e) {}
      return false;
    }

    async function pair() {
      const phone = document.getElementById('phone').value.trim();
      if (!phone) return alert('Masukkan nomor HP!');
      
      const btn = document.getElementById('btn');
      btn.disabled = true;
      btn.textContent = 'Memproses...';

      try {
        const res = await fetch('/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();

        if (data.pairingCode) {
          document.getElementById('content').innerHTML = 
            '<p class="sub">Masukkan kode ini di WhatsApp HP kamu:</p>' +
            '<div class="code-box">' + data.pairingCode + '</div>' +
            '<div id="status" class="waiting">Menunggu konfirmasi dari HP...</div>';
          
          // Poll status sampai connected
          const poll = setInterval(async () => {
            if (await checkStatus()) clearInterval(poll);
          }, 3000);
        } else if (data.status === 'connected') {
          document.getElementById('content').innerHTML = 
            '<div id="status" class="connected">WhatsApp Terkoneksi!</div>';
        } else {
          btn.disabled = false;
          btn.textContent = 'Login';
          alert(data.message || data.error || 'Coba lagi');
        }
      } catch(e) {
        btn.disabled = false;
        btn.textContent = 'Login';
        alert('Server error');
      }
    }

    checkStatus();
  </script>
</body>
</html>`);
});

// ==================== API ROUTES ====================
app.use('/', apiRoutes);

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START ====================
app.listen(config.port, async () => {
  logger.info('=================================');
  logger.info('Server running on port ' + config.port);
  logger.info('Open http://localhost:' + config.port + ' to login');
  logger.info('=================================');

  if (fs.existsSync(config.sessionDir)) {
    logger.info('Session found, auto-connecting...');
    await wa.connectToWhatsApp();
  } else {
    logger.info('No session. Open browser to login with phone number.');
  }
});
