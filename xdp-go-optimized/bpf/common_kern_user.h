/* SPDX-License-Identifier: GPL-2.0 */
/*
 * common_kern_user.h — Shared types for XDP Firewall + Fast Forwarder
 *
 * Menggabungkan:
 *   - combine-parser-firewall/common_kern_user.h  (firewall feature flags)
 *   - fast-forwarding/common_kern_user.h          (forwarding table structs)
 *
 * Digunakan bersama oleh kernel program (xdp_prog_kern.c) dan
 * userspace control plane (xdp_fw_fwd.c).
 */
#ifndef __COMBINE_FW_FWD_KERN_USER_H
#define __COMBINE_FW_FWD_KERN_USER_H

#include <linux/types.h>

/* ─── Firewall: Feature Flags ─────────────────────────────────────────────── */

/*
 * enum fw_config_key — index ke fw_config BPF_MAP_TYPE_ARRAY.
 * Setiap key menyimpan nilai 0 (off) atau 1 (on).
 */
enum fw_config_key {
	FW_CFG_BLOCK_ICMP_PING     = 0,  /* Drop ICMP echo request (ping)        */
	FW_CFG_BLOCK_IP_FRAGMENTS  = 1,  /* Drop fragmented IP packets            */
	FW_CFG_BLOCK_MALFORMED_TCP = 2,  /* Drop NULL/XMAS/SYN+FIN/RST+FIN scans */
	FW_CFG_BLOCK_ALL_TCP       = 3,  /* Drop ALL TCP (override port list)     */
	FW_CFG_BLOCK_ALL_UDP       = 4,  /* Drop ALL UDP (override port list)     */
	FW_CFG_BLOCK_BROADCAST     = 5,  /* Drop dst == 255.255.255.255           */
	FW_CFG_BLOCK_MULTICAST     = 6,  /* Drop dst in 224.0.0.0/4              */
	FW_CFG_EVENTS_ENABLED      = 7,  /* Emit ring buffer events for PASS/TX/REDIRECT (0=off) */
	FW_CFG_SECURITY_EVENTS     = 8,  /* Emit ring buffer events for DROP/TTL_EXCEEDED (0=off) */
	FW_CFG_MAX
};

/* ─── Forwarding: Table Limits ────────────────────────────────────────────── */

#define FWD_TABLE_MAX_ENTRIES   4096  /* Max routes in hash map  */
#define FWD_DEVMAP_MAX_ENTRIES  16    /* Max egress NICs in DEVMAP */

/* ─── Forwarding: Action ──────────────────────────────────────────────────── */

/*
 * enum fwd_action — determines what XDP does after MAC rewrite.
 *
 * FWD_ACTION_TX:
 *   Return XDP_TX — packet dikirim kembali lewat NIC yang SAMA (hairpin).
 *   Cocok untuk topologi single-NIC atau L3 relay pada segmen yang sama.
 *
 * FWD_ACTION_REDIRECT:
 *   Return bpf_redirect_map(&tx_port, key, 0) — packet dikirim ke NIC LAIN
 *   yang terdaftar di DEVMAP (tx_port map). Tanpa menyentuh kernel TCP/IP stack.
 */
enum fwd_action {
	FWD_ACTION_TX       = 0,
	FWD_ACTION_REDIRECT = 1,
};

/* ─── Forwarding: Table Entry ─────────────────────────────────────────────── */

/*
 * struct fwd_entry — satu baris di forwarding table (BPF map value).
 *
 * @dst_mac:      MAC tujuan (next-hop) yang menggantikan eth->h_dest.
 * @src_mac:      MAC interface egress yang menggantikan eth->h_source.
 * @tx_port_key:  Slot DEVMAP untuk XDP_REDIRECT (ifindex egress NIC).
 *                Diabaikan jika action == FWD_ACTION_TX.
 * @action:       enum fwd_action — TX atau REDIRECT.
 * @_pad:         Padding ke 4-byte boundary.
 */
struct fwd_entry {
	__u8  dst_mac[6];
	__u8  src_mac[6];
	__u32 tx_port_key;
	__u8  action;
	__u8  _pad[3];
};

/* ─── Statistics ──────────────────────────────────────────────────────────── */

/*
 * enum xdp_stat_key — index ke xdp_stats BPF_MAP_TYPE_PERCPU_ARRAY.
 */
enum xdp_stat_key {
	STAT_DROP         = 0,  /* Dropped oleh firewall                  */
	STAT_TX           = 1,  /* Fast-forwarded via XDP_TX (same NIC)   */
	STAT_REDIRECT     = 2,  /* Fast-forwarded via XDP_REDIRECT (DEVMAP)*/
	STAT_PASS         = 3,  /* Passed ke kernel stack (no fwd entry)  */
	STAT_TTL_EXCEEDED = 4,  /* TTL <= 1, kernel kirim ICMP Time Exceeded */
	STAT_MAX
};

/*
 * struct stats_rec — packet dan byte counter, satu per CPU per action.
 */
struct stats_rec {
	__u64 packets;
	__u64 bytes;
};

/* ─── Ring Buffer Event ────────────────────────────────────────────────────── */

/*
 * enum pkt_action — action yang diambil terhadap paket, diemit ke ring buffer.
 * Harus sinkron dengan konstanta di Go (internal/maps/ringbuf.go).
 */
enum pkt_action {
	PKT_ACTION_DROP         = 0,
	PKT_ACTION_PASS         = 1,
	PKT_ACTION_TX           = 2,
	PKT_ACTION_REDIRECT     = 3,
	PKT_ACTION_TTL_EXCEEDED = 4,
};

/*
 * struct packet_event — satu event paket yang dikirim ke userspace via ring buffer.
 * Total size: 24 bytes (aligned).
 *
 * src_port/dst_port = 0 untuk paket yang di-drop di L3 (fragment, broadcast, dll.)
 * karena L4 header belum di-parse.
 */
struct packet_event {
	__u64  timestamp_ns;  /* bpf_ktime_get_ns() saat paket diproses      */
	__be32 src_ip;        /* IPv4 source address (network byte order)     */
	__be32 dst_ip;        /* IPv4 destination address (network byte order)*/
	__u16  src_port;      /* L4 source port (0 jika L3-only drop)         */
	__u16  dst_port;      /* L4 destination port (0 jika L3-only drop)    */
	__u8   protocol;      /* IPPROTO_TCP / UDP / ICMP / dll.              */
	__u8   action;        /* enum pkt_action                              */
	__u16  pkt_len;       /* Total packet length in bytes                 */
	__u8   _pad[4];       /* padding ke 24 bytes                          */
};

#endif /* __COMBINE_FW_FWD_KERN_USER_H */
