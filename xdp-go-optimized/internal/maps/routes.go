package maps

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/cilium/ebpf"
)

// FwdAction mirrors enum fwd_action in common_kern_user.h.
type FwdAction uint8

const (
	FwdActionTX       FwdAction = 0
	FwdActionRedirect FwdAction = 1
)

func (a FwdAction) String() string {
	if a == FwdActionTX {
		return "tx"
	}
	return "redirect"
}

// FwdEntry mirrors struct fwd_entry (16 bytes) in common_kern_user.h.
type FwdEntry struct {
	DstMAC    [6]byte   `json:"-"`
	SrcMAC    [6]byte   `json:"-"`
	TxPortKey uint32    `json:"port_key"`
	Action    FwdAction `json:"action"`
	_         [3]byte   // padding
}

// RouteEntry is the JSON-friendly representation of a forwarding table row.
type RouteEntry struct {
	IP        string `json:"ip"`
	DstMAC    string `json:"dst_mac"`
	SrcMAC    string `json:"src_mac"`
	Action    string `json:"action"`
	TxPortKey uint32 `json:"port_key"`
}

// ipToKey converts a dotted-decimal IP string to a 4-byte BPF map key.
// The bytes are stored in network (big-endian) order so they match iph->daddr
// in the kernel, which is also in network byte order.
// cilium/ebpf serialises [4]byte keys verbatim (no host-endian swap),
// whereas a uint32 key would be swapped on little-endian hosts, causing a
// permanent lookup mismatch against the kernel's __be32 iph->daddr.
func ipToKey(s string) ([4]byte, error) {
	ip := net.ParseIP(s)
	if ip == nil {
		return [4]byte{}, fmt.Errorf("invalid IP: %s", s)
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return [4]byte{}, fmt.Errorf("IPv6 not supported: %s", s)
	}
	return [4]byte{ip4[0], ip4[1], ip4[2], ip4[3]}, nil
}

// ipFromKey converts a 4-byte BPF map key back to dotted-decimal string.
func ipFromKey(b [4]byte) string {
	return net.IP(b[:]).String()
}

// parseMACBytes parses a "aa:bb:cc:dd:ee:ff" string into [6]byte.
func parseMACBytes(s string) ([6]byte, error) {
	s = strings.ToLower(s)
	hw, err := net.ParseMAC(s)
	if err != nil {
		return [6]byte{}, fmt.Errorf("invalid MAC %q: %w", s, err)
	}
	var b [6]byte
	copy(b[:], hw)
	return b, nil
}

// macToString formats [6]byte as "aa:bb:cc:dd:ee:ff".
func macToString(b [6]byte) string {
	var parts [6]string
	for i, v := range b {
		parts[i] = hex.EncodeToString([]byte{v})
	}
	return strings.Join(parts[:], ":")
}

// AddRoute inserts or updates a forwarding table entry.
func AddRoute(fwdMap *ebpf.Map, r RouteEntry) error {
	key, err := ipToKey(r.IP)
	if err != nil {
		return err
	}
	dstMAC, err := parseMACBytes(r.DstMAC)
	if err != nil {
		return err
	}
	srcMAC, err := parseMACBytes(r.SrcMAC)
	if err != nil {
		return err
	}
	action := FwdActionRedirect
	if strings.ToLower(r.Action) == "tx" {
		action = FwdActionTX
	}
	entry := FwdEntry{
		DstMAC:    dstMAC,
		SrcMAC:    srcMAC,
		TxPortKey: r.TxPortKey,
		Action:    action,
	}
	return fwdMap.Put(key, entry)
}

// DeleteRoute removes a forwarding entry by destination IP.
func DeleteRoute(fwdMap *ebpf.Map, ip string) error {
	key, err := ipToKey(ip)
	if err != nil {
		return err
	}
	err = fwdMap.Delete(key)
	if errors.Is(err, ebpf.ErrKeyNotExist) {
		return nil
	}
	return err
}

// ListRoutes returns all entries in the forwarding table.
func ListRoutes(fwdMap *ebpf.Map) ([]RouteEntry, error) {
	var routes []RouteEntry
	var key [4]byte
	iter := fwdMap.Iterate()
	for {
		var entry FwdEntry
		if !iter.Next(&key, &entry) {
			break
		}
		routes = append(routes, RouteEntry{
			IP:        ipFromKey(key),
			DstMAC:    macToString(entry.DstMAC),
			SrcMAC:    macToString(entry.SrcMAC),
			Action:    entry.Action.String(),
			TxPortKey: entry.TxPortKey,
		})
	}
	return routes, iter.Err()
}

// SetDevmapSlot registers an egress NIC ifindex in the tx_port DEVMAP.
func SetDevmapSlot(devmap *ebpf.Map, slot uint32, ifindex uint32) error {
	return devmap.Put(slot, ifindex)
}

// DevmapEntry describes one populated tx_port DEVMAP slot.
type DevmapEntry struct {
	Slot    uint32 `json:"slot"`
	Ifindex uint32 `json:"ifindex"`
	Iface   string `json:"iface,omitempty"`
}

const devmapMaxSlots = 16 // must match FWD_DEVMAP_MAX_ENTRIES in common_kern_user.h

// ListDevmapSlots returns all non-zero tx_port DEVMAP slots with their ifindex
// and, when resolvable, the interface name.
func ListDevmapSlots(devmap *ebpf.Map) []DevmapEntry {
	var entries []DevmapEntry
	for slot := uint32(0); slot < devmapMaxSlots; slot++ {
		var ifindex uint32
		if err := devmap.Lookup(slot, &ifindex); err != nil || ifindex == 0 {
			continue
		}
		entry := DevmapEntry{Slot: slot, Ifindex: ifindex}
		if iface, err := net.InterfaceByIndex(int(ifindex)); err == nil {
			entry.Iface = iface.Name
		}
		entries = append(entries, entry)
	}
	return entries
}

// DeleteDevmapSlot removes an egress NIC from the given tx_port DEVMAP slot.
func DeleteDevmapSlot(devmap *ebpf.Map, slot uint32) error {
	err := devmap.Delete(slot)
	if errors.Is(err, ebpf.ErrKeyNotExist) {
		return nil
	}
	return err
}
