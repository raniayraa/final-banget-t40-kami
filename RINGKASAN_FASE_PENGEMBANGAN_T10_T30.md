# Ringkasan Dokumentasi Proyek Tugas Akhir (Fase T10 - T30)

Dokumen ini menyajikan tinjauan menyeluruh terhadap perkembangan proyek Tugas Akhir yang berfokus pada teknologi *kernel bypass* untuk pemrosesan data performa tinggi, mencakup identifikasi masalah, spesifikasi desain, hingga penentuan solusi terbaik.

## 1. Fase T10: Identifikasi Permasalahan (Oktober 2025)
Fase ini berfokus pada analisis mendalam terhadap keterbatasan infrastruktur jaringan saat ini dalam mendukung aplikasi kecerdasan buatan (*Artificial Intelligence*/AI) *real-time*.

*   **Identifikasi Masalah Utama:**
    *   **Beban CPU Host yang Tinggi:** *Kernel networking stack* tradisional menimbulkan *overhead* besar karena pemrosesan paket harus melewati banyak lapisan kernel.
    *   **Latensi dan Jitter:** Ketidakpastian dalam waktu pemrosesan paket yang menghambat aplikasi sensitif waktu seperti analisis video *real-time* dan deteksi penipuan.
    *   **Skalabilitas:** Kesulitan dalam menjaga performa seiring dengan peningkatan kecepatan jaringan (25–100 Gbps).
*   **Tujuan Awal:** Mengevaluasi performa metode *kernel bypass* (DPDK, VPP) dibandingkan dengan *stack* konvensional Linux untuk meningkatkan efisiensi inferensi AI.
*   **Persyaratan Pelanggan:** Menekankan pada latensi ultra-rendah, efisiensi energi, kompatibilitas dengan *pipeline* AI modern, serta observabilitas sistem.

## 2. Fase T20: Proses Desain Awal (Oktober 2025)
Pada fase ini, fokus penelitian bergeser secara spesifik ke penggunaan teknologi **eBPF/XDP** sebagai alternatif *in-kernel fast path* yang lebih fleksibel dan terintegrasi.

*   **Objektif Desain:**
    *   **Implementasi Teknologi:** Membangun sistem *fast path* menggunakan eBPF/XDP untuk meminimalkan *overhead* CPU (target penggunaan CPU mendekati 0-5% saat *idle*).
    *   **Otomatisasi dan Monitoring:** Mengembangkan *dashboard* otomatis untuk manajemen eksperimen pada *testbed multi-node* dan visualisasi metrik performa secara *real-time*.
*   **Arsitektur Sistem:** Terdiri dari tiga subsistem utama:
    1.  **Subsistem Dashboard:** Otomatisasi instalasi dan visualisasi hasil.
    2.  **Subsistem Eksperimen:** Implementasi program eBPF/XDP untuk pemrosesan paket.
    3.  **Subsistem Orkestrasi:** Manajemen *deployment* pada lingkungan *multi-node*.
*   **Target Performa:** Mencapai *throughput* minimal 55% dari performa basis DPDK/VPP dengan tingkat otomatisasi eksperimen yang tinggi (pengurangan waktu eksekusi manual hingga 78%).

## 3. Fase T30: Proposal Pengembangan Desain Awal (Desember 2025)
Fase ini merupakan tahap seleksi teknologi dan analisis kelayakan ekonomi untuk menentukan jalur implementasi terbaik.

*   **Seleksi Alternatif Desain:**
    *   Setelah membandingkan 18 kombinasi teknologi, dipilih **Alternatif 18** sebagai solusi optimal:
        *   **Dashboard:** Kombinasi **React.js** (untuk kontrol interaktif) dan **Grafana** (untuk visualisasi data *time-series*).
        *   **Library eBPF:** **LibBPF (C/Native)** dipilih karena performa tinggi, dukungan CO-RE (*Compile Once – Run Everywhere*), dan ukuran binari yang kecil.
        *   **Alat Otomatisasi:** **Python (Fabric)** dipilih karena kemampuannya dalam menangani logika eksperimen yang dinamis dan manajemen *multi-node* yang sinkron.
*   **Analisis Finansial:**
    *   Estimasi total biaya proyek: **Rp 65.603.000**.
    *   Analisis *Break-Even Point* (BEP) diproyeksikan tercapai dalam waktu **14,91 bulan**, menjadikannya investasi yang layak (*feasible*).
*   **Kesimpulan Fase:** Desain telah tervalidasi secara teoritis dan melalui analisis komparatif, siap untuk dilanjutkan ke tahap implementasi (Fase T40).

## 4. Relevansi Menuju Fase T40 (Implementasi)
Berdasarkan tinjauan di atas, proyek telah memiliki landasan teknis yang kuat dengan pemilihan teknologi eBPF/XDP, LibBPF, React/Grafana, dan Python Fabric. Implementasi pada fase T40 harus memastikan integrasi antara kode *kernel-space* (XDP) dengan *user-space control plane* berjalan sesuai dengan batasan *overhead* yang telah ditetapkan pada fase desain.
