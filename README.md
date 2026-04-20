# ContactGuard PoC

Demo **Next.js + TypeScript + Tailwind**: cek pesan mencurigakan (teks atau screenshot) pakai **OpenAI `gpt-4o-mini`** (teks + **vision** untuk gambar), lalu simulasi tiket ke agen jika confidence rendah.

## Setup

1. **Node.js** 20+ (disarankan sesuai warning engine dari dependency).
2. Install dependency:
  ```bash
   npm install
  ```
3. **Kredensial OpenAI (wajib)**
  - Salin `.env.example` → `.env.local` di root project (sejajar `package.json`).  
  - Isi `**OPENAI_API_KEY`** dengan secret key dari [platform.openai.com/api-keys](https://platform.openai.com/api-keys).  
  - Itu **bukan** password login ChatGPT di web — ini **API secret** khusus backend.  
  - Opsional: `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_MODEL` — lihat komentar di `.env.example`.
4. Jalankan dev server:
  ```bash
   npm run dev
  ```
5. Buka [http://localhost:3000](http://localhost:3000).

**Demo tiket:** jika **confidence akhir** (setelah mesin skor) di bawah **0.75**, form tiket simulasi muncul. ID format `**HBCA-YYYYMMDD-001`** (nomor urut per hari di `sessionStorage`).

1. Build produksi (opsional):
  ```bash
   npm run build
   npm start
  ```

## Struktur folder

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
    api/analyze/route.ts   # OpenAI + mesin skor explainable
    api/transcribe/route.ts # Audio → teks (gpt-4o-mini-transcribe)
  components/
    ContactScamChecker.tsx # UI: sample, OCR, breakdown, tiket
  lib/
    types.ts               # Tipe hasil + tiket + ambang eskalasi
    openai-analyze.ts      # Prompt + JSON model (bobot per sinyal)
    scoring-engine.ts      # Kualitas teks/OCR + confidence akhir + tabel
    ocr-client.ts          # Tesseract di browser (pratinjau / skor OCR)
    ticket.ts              # ID HBCA-YYYYMMDD-xxx (session)
.env.example               # Template variabel lingkungan (aman di-commit)
```

## Cara analisis bekerja

1. **Model (gpt-4o-mini)** — Mengembalikan JSON: `verdict`, `confidence` (mentah), `signals[]` dengan `**weight` 1–10** per indikator, `reasoning_steps`, `recommended_action`, `analyzed_text_preview`.
2. **Mesin skor (`scoring-engine.ts`)** — Menghitung **confidence akhir** dari kombinasi: confidence mentah model, **jumlah bobot** sinyal (dinormalisasi dengan konstanta dokumentasi), dan **kualitas teks** (panjang) atau **kualitas OCR** (panjang + confidence Tesseract bila ada). OCR sangat pendek / buruk memicu **penalti** (confidence dikalikan 0.88) dan narasi penjelasan.
3. **Gambar** — UI menampilkan **pratinjau** + menjalankan **Tesseract** untuk panel OCR; payload ke API menyertakan `clientOcrText`, `clientOcrQuality`, `clientOcrMeanConfidence` bersama **vision** agar dosen bisa melihat dua jalur teks.
4. **Suara** — `POST /api/transcribe` memakai **gpt-4o-mini-transcribe** dengan `**language=id`** + prompt bantu Indonesia (default), lalu `POST /api/analyze` dengan `source: "voice"`. Override: `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TRANSCRIBE_LANGUAGE`, `OPENAI_TRANSCRIBE_PROMPT`.
5. **Tabel breakdown** — Di UI: baris per sinyal dengan **bobot** dan **kumulatif**, plus ringkasan formula di README kode (`computeExplainableScoring`).
6. **Tiket simulasi** — Form dengan kategori, prioritas, ringkasan otomatis, catatan opsional; tidak ada database.

## Biaya & keamanan

- Pemakaian dikenakan **tarif OpenAI** per token / gambar; `gpt-4o-mini` relatif murah, tetap pantau dashboard billing.
- **Jangan** commit `.env.local` atau menyematkan API key di kode klien. PoC ini hanya membaca key di **server route**.

## Keterbatasan PoC

- Model bisa **halusinasi** atau melewatkan serangan baru; bukan pengganti engine fraud resmi.
- Tidak ada auth, rate limit, atau penyimpanan kasus.
- Ukuran gambar dibatasi (~4 MB) agar aman untuk demo.

## Perbaikan ke depan

- Logging audit, redaksi PII, dan kebijakan retensi data.
- Rate limiting + autentikasi.
- Fine-tune / guardrail tambahan, ensemble dengan rules atau model khusus fraud.
- Antrian human-in-the-loop terintegrasi.

## Disclaimer

Ini **proof-of-concept** dengan branding netral, tidak berafiliasi dengan bank mana pun. Jangan gunakan sebagai satu-satunya dasar pemblokiran akun atau transaksi.