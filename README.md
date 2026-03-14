# 📱 WA Gateway API

WhatsApp Gateway API gratis — kirim & baca pesan WA via HTTP request.  
Pakai Baileys (WebSocket, bukan Puppeteer), ringan, bisa jalan di Railway free tier.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.example .env

# 3. Jalankan
npm start
```

Buka **http://localhost:3000** di browser → scan QR code yang muncul pakai WhatsApp (Linked Devices) → selesai! ✅

---

## 📡 API Endpoints

### 1. Scan QR (Login)

Buka browser ke `http://localhost:3000` — QR otomatis muncul, tinggal scan.

Atau via API:

```
GET /session/start
```

### 2. Cek Status

```
GET /session/status
```

Response: `{ "connected": true }`

### 3. Kirim Pesan

```
POST /send
Content-Type: application/json

{
  "number": "628123456789",
  "message": "Halo dari API!"
}
```

Response: `{ "status": "sent", "to": "628123456789" }`

> **Format nomor:** Pakai kode negara tanpa `+`. Contoh: `08123456789` → `628123456789`

### 4. Baca Pesan Masuk (dari nomor tertentu)

```
GET /messages/628123456789
```

Response:

```json
{
  "number": "628123456789",
  "count": 2,
  "messages": [
    {
      "id": "abc123",
      "from": "628123456789",
      "text": "Halo, ini pesan masuk",
      "timestamp": 1773526900
    }
  ]
}
```

### 5. Baca Semua Pesan Masuk

```
GET /messages
```

### 6. Logout

```
POST /session/logout
```

---

## 🔗 Contoh Pakai curl

```bash
# Kirim pesan
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"number": "628123456789", "message": "Hello!"}'

# Baca pesan dari nomor tertentu
curl http://localhost:3000/messages/628123456789

# Cek status koneksi
curl http://localhost:3000/session/status
```

---

## 🤖 Pakai di n8n

1. **HTTP Request Node** → Method: `POST` → URL: `http://YOUR_SERVER/send`
2. Body (JSON): `{ "number": "628xxx", "message": "Automated msg" }`
3. Untuk baca pesan: **HTTP Request Node** → Method: `GET` → URL: `http://YOUR_SERVER/messages/628xxx`

---

## 🚂 Deploy ke Railway

1. Push ke GitHub
2. Buat project baru di [railway.app](https://railway.app)
3. Connect repo GitHub
4. Tambah **Volume** → mount path: `/app/storage/sessions`
5. Set environment variable: `SESSION_DIR=/app/storage/sessions`
6. Railway otomatis inject `PORT` — tidak perlu di-set manual
7. Deploy!

> **Penting:** Tanpa Volume, session hilang tiap restart dan harus scan QR ulang.

---

## 📁 Struktur Project

```
wa-gateway/
├── src/
│   ├── server.js          # Entry point + web dashboard
│   ├── config.js          # Environment config
│   ├── whatsapp/
│   │   └── client.js      # Baileys connection & message handling
│   ├── api/
│   │   ├── routes.js      # API routes
│   │   └── controllers.js # Request handlers
│   └── utils/
│       └── logger.js      # Pino logger
├── storage/sessions/      # Session files (auto-created)
├── .env.example
├── package.json
└── README.md
```

---

## ⚠️ Catatan

- Pesan masuk disimpan di **memory (RAM)** — kalau server restart, inbox kosong lagi. Ini by design supaya ringan.
- Nomor otomatis di-format: `08123456789` → `628123456789`
- Untuk personal use — tidak ada auth/proteksi API.
