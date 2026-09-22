# StrideMap - Running Route & GPX/KML Creator

Website interaktif berbasis peta modern untuk merancang jalur lari dan mengekspornya ke format **GPX** dan **KML** dengan dukungan penuh untuk **Waypoints & Legend** di **Google Maps**, **Garmin**, **Strava**, dan **Coros**.

## 🌟 Fitur Utama
1. **Peta Interaktif Serbaguna & Bebas Watermark**:
   - Pilihan layer: Jalan (OpenStreetMap France & Esri Street), Foto Udara Satelit (Esri), dan Elevasi Topografi (Esri World Topo).
   - Tombol *GPS My Location* untuk melompat ke lokasi Anda saat ini.
2. **Mode Interaksi 3-Pilihan (Move, Route, Landmark)**:
   - ✋ **Mode Geser (Move Peta)**: Bebas menggeser (*pan*) dan zoom tanpa risiko tak sengaja menambah titik rute.
   - 🏃 **Mode Buat Rute**: Klik di peta untuk menarik rute lari (otomatis ikuti jalan raya/pedestrian atau manual).
   - 📍 **Mode Landmark**: Menancapkan pin titik penting.
3. **Pencarian Lokasi Instan (Search Bar)**:
   - Cari kota, taman, gelanggang olahraga, atau jalan mana pun menggunakan OpenStreetMap Nominatim.
4. **Auto Landmark Start, Finish, dan Rekomendasi Snap Loop**:
   - **Otomatis Start & Finish**: Titik pertama yang diklik otomatis menjadi landmark `Start Line`, dan titik terakhir menjadi `Finish Line`.
   - **Rekomendasi Gabung Loop**: Saat kursor mendekati titik start (jarak dekat), muncul animasi pulsa ungu & badge petunjuk *"Klik untuk Gabung Loop"*.
   - **Start & Finish Bersatu**: Jika titik awal dan akhir bertemu di lokasi yang sama (rute melingkar/loop), landmark otomatis berubah menjadi satu pin gabungan bertuliskan **"Start & Finish"**.
5. **Kategori Landmark Lengkap dengan Label Teks Permanen**:
   - Kategori: **KM Marker (KM#)**, **Water Station**, **Cheering Area**, **Start & Finish**, **Start Line**, **Finish Line**, **Checkpoint**, **Toilet/Restroom**, **Foto Spot**, **Tanjakan/Hill**, dan **Landmark Khusus**.
   - **Label Teks di Atas Pin**: Nama landmark selalu muncul melayang di atas ikon pin tanpa perlu diklik terlebih dahulu.
   - **Dukungan GPX & KML**: Diekspor sebagai `<wpt>` valid (GPX 1.1) dan `<Placemark>` (KML) agar legend dan nama terbaca langsung di Google Maps / Garmin / Strava.
6. **Undo & Redo Lengkap (Ikon & Keyboard Shortcuts)**:
   - Tombol Undo & Redo di sidebar dan floating toolbar atas peta.
   - Shortcut keyboard: `Ctrl + Z` (Undo) dan `Ctrl + Y` / `Ctrl + Shift + Z` (Redo).
7. **Kalkulator Running Pace & Statistik**:
   - Total jarak dalam KM dan kalkulasi estimasi waktu tempuh berdasarkan pacing lari.

## 🚀 Cara Menjalankan Website
1. Buka file `index.html` langsung di browser favorit Anda (Google Chrome, Edge, Firefox, Safari).
2. Atau jalankan local web server jika diinginkan:
   ```bash
   python -m http.server 8000
   ```
   Lalu buka `http://localhost:8000` di browser Anda.

## 📍 Cara Membuka Hasil di Google Maps
1. Buat rute dan tandai landmark Anda di StrideMap.
2. Klik tombol **Unduh File GPX** (atau **Unduh KML**).
3. Buka **Google My Maps** di [mymaps.google.com](https://mymaps.google.com).
4. Klik **Create a New Map** (Buat Peta Baru).
5. Pada layer baru, klik tombol **Import** lalu unggah file `.gpx` atau `.kml` yang baru diunduh.
6. Seluruh rute dan **Daftar Landmark / Legend** (Water station, Start, Finish, dll.) akan langsung muncul lengkap dengan nama dan catatannya di Google Maps!
