# GEMINI Context: XDP-Go Optimized Project

Proyek ini adalah implementasi sistem pemrosesan paket data performa tinggi menggunakan teknologi **eBPF/XDP** (Kernel Bypass) dengan manajemen berbasis **Go** dan antarmuka **React**.

## 🚀 Ikhtisar Proyek
*   **Nama Daemon:** `xdpd`
*   **Fungsi Utama:** Stateless Firewall (L3/L4) dan Fast Forwarding (MAC Rewrite & XDP_TX/REDIRECT).
*   **Arsitektur:** Terdiri dari program kernel (C) yang dimuat oleh daemon userspace (Go). Daemon menyediakan REST API untuk kontrol runtime dan melayani Frontend (React) untuk monitoring real-time.
*   **Teknologi Kunci:**
    *   **Kernel:** C (eBPF), `clang`, `bpf2go`.
    *   **Backend:** Go 1.23, `go-chi/chi` (REST API), `cilium/ebpf` (BPF Management), `SQLite` (Logging).
    *   **Frontend:** React, TypeScript, Vite, Recharts.
    *   **Infrastruktur:** Ansible (Setup Multi-node), Shell Scripting (System Tuning).

## 📂 Struktur Direktori Utama
*   `xdp-go-optimized/bpf/`: Kode sumber kernel C (`xdp_prog_kern.c`) dan header bersama.
*   `xdp-go-optimized/cmd/xdpd/`: Titik masuk utama aplikasi Go.
*   `xdp-go-optimized/internal/`:
    *   `api/`: Handler REST API.
    *   `xdp/`: Manajemen lifecycle BPF (load, attach, pin).
    *   `maps/`: Abstraksi interaksi dengan BPF Maps (Stats, Config, Forwarding).
    *   `db/`: Penyimpanan log trafik ke SQLite.
    *   `bpfobj/`: Kode Go yang dihasilkan secara otomatis dari program C.
*   `xdp-go-optimized/frontend/`: Aplikasi web React untuk visualisasi dashboard.
*   `ansible/`: Playbook untuk konfigurasi node target dan lingkungan eksperimen.
*   `document/`: Dokumentasi teknis fase pengembangan (T10 - T40).

## 🛠️ Perintah Utama (Makefile)
*   **Membangun Seluruh Proyek:** `make all` (Menghasilkan binding BPF, binari Go, dan build frontend).
*   **Generasi Binding BPF:** `make generate` (Memerlukan `bpf2go`).
*   **Membangun Daemon:** `make gobuild`.
*   **Membangun Frontend:** `make frontend`.
*   **Menjalankan Daemon:** `sudo ./xdpd -iface <NIC> -redirect-dev <NIC_OUT>` (Memerlukan hak akses root).
*   **Turbo Mode:** `sudo ./start_turbo.sh` (Script untuk tuning sistem dan performa maksimal).

## ⚙️ Konvensi Pengembangan
*   **Kernel Code:** Logika berat berada di `bpf/xdp_prog_kern.c`. Hindari `bpf_printk` di *hot path*. Gunakan `PERCPU_ARRAY` untuk statistik guna menghindari kontensi.
*   **API:** Selalu gunakan `internal/maps` untuk mengubah perilaku program kernel secara dinamis tanpa memuat ulang program.
*   **Testing:** Validasi throughput dilakukan menggunakan `pktgen` melalui playbook Ansible di direktori `ansible/`.
*   **Turbo Mode:** Menggunakan `XDPDriverMode` (Native) dan mematikan ring buffer events untuk mencapai performa setara DPDK.

## 📝 Catatan Penting
*   **Keamanan:** Daemon harus dijalankan sebagai `root` karena operasi pemuatan program BPF ke kernel bersifat istimewa.
*   **Dependensi:** Memerlukan `clang`, `llvm`, dan kernel Linux yang mendukung XDP (disarankan 5.4+).
*   **Konfigurasi:** File `turbo.json` digunakan untuk seeding awal flag firewall saat daemon mulai berjalan.
