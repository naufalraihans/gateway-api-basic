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

### 2. Cek List Chat (Conversations)

Lihat semua percakapan yang masuk beserta **ID, Nomor HP (kalau ada), dan Nama (pushName)**.

```
GET /conversations
```

### 3. Kirim Pesan

Kirim pesan pakai nomor telepon, LID, atau **Nama Kontak**.

```
POST /send
Content-Type: application/json

{ "number": "Jaffa", "message": "Halo dari n8n!" }

# ATAU pakai nomor:
# { "number": "08123456789", "message": "Halo!" }

# ATAU pakai LID:
# { "number": "75836942188713", "message": "Halo!" }
```

### 4. Baca Pesan (dari nomor atau nama)

Parameter bisa berupa: Nomor Telepon, Nama Kontak (pushName), atau LID. Otomatis dicari!

```
GET /messages/Jaffa?limit=5
# ATAU
GET /messages/08123456789
```

### 5. Baca Semua Pesan

```
GET /messages
```

### 6. Cek Status Server

```
GET /session/status
```

### 7. Logout

```
POST /session/logout
```

---

## Contoh curl

```bash
# Login
curl -X POST http://localhost:3000/session/start -H "Content-Type: application/json" -d "{\"phone\": \"08123456789\"}"

# Lihat list chat & nama kontak
curl http://localhost:3000/conversations

# Kirim pesan pakai nama
curl -X POST http://localhost:3000/send -H "Content-Type: application/json" -d "{\"number\": \"Jaffa\", \"message\": \"Pesan otomatis!\"}"

# Baca pesan dari nama tertentu
curl "http://localhost:3000/messages/Jaffa?limit=3"
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

- Login pakai **pairing code** (bukan QR).
- Fitur pencarian kontak sangat fleksibel: bisa pakai Nama, Nomor HP, atau LID WhatsApp.
- Jika nomor belum dikenali sebagai kontak (LID masih anonim), kirimlah satu pesan ke nomor tersebut via `/send`, maka ia akan ter-register permanen.
- Pesan masuk disimpan di **memory** — restart = inbox kosong. Format payload _lightweight_ khusus untuk di-consume webhook / n8n.
- Untuk personal use, tanpa auth.
