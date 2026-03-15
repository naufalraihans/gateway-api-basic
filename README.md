# WA Gateway API

WhatsApp Gateway API gratis — kirim & baca pesan WA via HTTP request.  
Pakai Baileys (WebSocket), ringan, bisa jalan di Railway free tier.

Login pakai **nomor telepon** (pairing code), bukan QR.

---

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Buka **http://localhost:3000** → masukkan nomor HP → dapat pairing code → masukkan di WhatsApp HP (Linked Devices > Link with phone number) → selesai!

---

## API Endpoints

### 1. Login (Pairing Code)

```
POST /session/start
Content-Type: application/json

{ "phone": "08123456789" }
```

Response:

```json
{
  "pairingCode": "A1B2C3D4",
  "message": "Masukkan kode ini di WhatsApp HP..."
}
```

Atau buka `http://localhost:3000` di browser untuk login via web.

### 2. Cek Status

```
GET /session/status
```

### 3. Kirim Pesan

```
POST /send
Content-Type: application/json

{ "number": "628123456789", "message": "Halo!" }
```

### 4. Baca Pesan (dari nomor tertentu)

```
GET /messages/628123456789?limit=5
```

### 5. Baca Semua Pesan

```
GET /messages
```

### 6. Logout

```
POST /session/logout
```

---

## Contoh curl

```bash
# Login
curl -X POST http://localhost:3000/session/start -H "Content-Type: application/json" -d "{\"phone\": \"08123456789\"}"

# Kirim pesan
curl -X POST http://localhost:3000/send -H "Content-Type: application/json" -d "{\"number\": \"628123456789\", \"message\": \"Hello!\"}"

# Baca pesan
curl http://localhost:3000/messages/628123456789?limit=3

# Cek status
curl http://localhost:3000/session/status
```

---

## Deploy ke Railway

1. Push ke GitHub
2. Buat project di [railway.app](https://railway.app), connect repo
3. Tambah **Volume** → mount path: `/app/storage/sessions`
4. Set variable: `SESSION_DIR=/app/storage/sessions`
5. Deploy — Railway otomatis inject `PORT`

---

## Catatan

- Login pakai **pairing code** (bukan QR)
- Pesan masuk disimpan di **memory** — restart = inbox kosong
- Format nomor: `08123456789` otomatis jadi `628123456789`
- Untuk personal use, tanpa auth
