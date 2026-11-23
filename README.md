# Video Toolkit Studio

Toolkit pengolahan video dan audio berbasis Node.js + FFmpeg dengan antarmuka web minimalis bernuansa pastel lembut (pilihan palet Lavender, Sky, Rose, dan Peach + mode terang/gelap) serta dukungan akselerasi GPU.

## Fitur Utama

### 1. Workflow Video
- **All-in-One**: Alur otomatis mulai dari pemotongan banyak video mentah, penggabungan klip, penambahan backsound, hingga AI Hooks & Captions.
- **Multi-Cut**: Memotong video panjang menjadi beberapa klip pendek secara massal (mendukung Fast Mode / Stream Copy maupun standardisasi 1080x1920).
- **Merge**: Menggabungkan klip hasil potongan secara berurutan atau acak dengan opsi musik latar.

### 2. AI Studio
- **AI Highlight Clipper**: Ambil video panjang lokal atau link YouTube, transkrip dengan Whisper.cpp, lalu biarkan Gemini memilih momen paling menarik lengkap dengan skor viralitas, penyesuaian batas kata (*word-boundary snap*), konversi `Portrait Blur 9:16` / `Portrait Crop`, dan subtitle karaoke otomatis.
- **Video Forge (1 Foto Produk / 1 Topik → Video)**: Upload 1–5 foto produk (atau ketik 1 topik), Gemini otomatis menulis skrip per scene (termasuk analisis visual foto produk), membuat voiceover gratis via **Microsoft Edge TTS** (`id-ID-GadisNeural`, `id-ID-ArdiNeural`, dll.) lengkap dengan timestamp kata, mengunci proporsi foto produk dengan efek *Ken Burns* + B-roll gratis Openverse/Wikimedia, dan burn subtitle karaoke.
- **AI Hooks & Persona Global**: Generator hook pembuka dan caption menggunakan Gemini AI. System persona bersifat global dan dapat ditambah, diubah, dihapus, atau diisi *custom prompt* langsung dari **Pengaturan → Persona AI**.
- **Subtitle Otomatis (Whisper.cpp)**: Transkripsi audio otomatis secara offline dengan timestamp per kata, preview langsung di browser dengan penanda kata yang sedang/sudah diucapkan (**Karaoke** atau **Kata Aktif**), editor klik-untuk-lompat / double-klik untuk koreksi kata, serta burn-in permanen ke `.mp4` (untuk video maupun file audio).

### 3. Tools Umum
- **YouTube Downloader**: Unduh satu atau banyak link YouTube sekaligus.
- **Analisis Video AI**: Bedah struktur hook dan alur video dengan Gemini.
- **Auto Portrait**: Rotasi massal video landscape (-90°) menjadi portrait.
- **Kompres Ukuran (Video & Audio)**: Mengompres file video (`.mp4`, `.mkv`, `.mov`) dan audio (`.mp3`, `.m4a`, `.wav`, `.aac`, `.flac`, `.ogg`) dalam satu folder secara aman — file asli hanya ditimpa apabila ukuran hasil kompresi lebih kecil.

## Akselerasi Hardware (GPU Encoder)

Aplikasi mendeteksi encoder FFmpeg secara otomatis melalui `src/utils/encoder.js`:
- **Auto (Rekomendasi)**: Memilih encoder GPU tercepat yang tersedia di sistem (`h264_qsv` → `h264_nvenc` → `h264_amf`) dengan fallback otomatis ke CPU (`libx264`) apabila encoding GPU gagal.
- Pada perangkat dengan **Intel UHD Graphics 620** + **NVIDIA GeForce MX150**, encoding video memanfaatkan **Intel Quick Sync Video (`h264_qsv`)** karena chip MX150 (GP108) secara fisik tidak memiliki hardware encoder NVENC.
- Pengaturan encoder dapat diubah di **Pengaturan → Encoding (GPU/CPU)**.

## Sistem Addon Modular

Fitur spesifik layanan eksternal dipisahkan ke dalam folder `src/addons/`:
- `src/addons/repliz`: Auto upload terjadwal ke Repliz, upload storage webhook, manajemen akun Repliz, dan logging ke Google Spreadsheet.
- `src/addons/tts-narration`: Generator naskah monolog AI + voiceover TikTok TTS dan sinkronisasi pasangan `.srt`/`.wav` eksternal.

Untuk mengaktifkan atau menonaktifkan addon:
1. Buka **Pengaturan → Addons** di antarmuka web.
2. Klik **Aktifkan** / **Nonaktifkan** pada addon yang diinginkan.
3. Restart server agar rute API dan panel sidebar addon dimuat.

## Cara Menjalankan

### Web GUI (Direkomendasikan)
Jalankan `start_gui.bat` atau perintah berikut:
```bash
node src/server.js
```
Buka browser di `http://localhost:3000`.

### Mode CLI
```bash
node index.js
```

### Setup Subtitle Otomatis Pertama Kali
1. Buka tab **Subtitle Otomatis** di sidebar.
2. Pilih model Whisper (`small-q5_1` direkomendasikan untuk Bahasa Indonesia; `base-q5_1` untuk ukuran ringan).
3. Klik **Install / Unduh Model** — binary `whisper-cli.exe` dan model akan diunduh otomatis ke `tools/whisper/`.
