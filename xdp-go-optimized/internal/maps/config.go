package maps

import (
	"fmt"

	"github.com/cilium/ebpf"
)

// Firewall config flag indices — must match enum fw_config_key in common_kern_user.h.
const (
	FwCfgBlockICMPPing    = uint32(0)
	FwCfgBlockIPFragments = uint32(1)
	FwCfgBlockMalformedTC = uint32(2)
	FwCfgBlockAllTCP      = uint32(3)
	FwCfgBlockAllUDP      = uint32(4)
	FwCfgBlockBroadcast   = uint32(5)
	FwCfgBlockMulticast   = uint32(6)
	FwCfgEventsEnabled       = uint32(7) // 0=no PASS/TX/REDIRECT events, 1=sampled logging
	FwCfgSecurityEvents      = uint32(8) // 0=no DROP/TTL_EXCEEDED events, 1=security logging (default)
	FwCfgMax                 = uint32(9)
)

// FwFlags holds all 8 firewall feature flags.
type FwFlags struct {
	BlockICMPPing    bool `json:"block_icmp_ping"`
	BlockIPFragments bool `json:"block_ip_fragments"`
	BlockMalformedTC bool `json:"block_malformed_tcp"`
	BlockAllTCP      bool `json:"block_all_tcp"`
	BlockAllUDP      bool `json:"block_all_udp"`
	BlockBroadcast   bool `json:"block_broadcast"`
	BlockMulticast   bool `json:"block_multicast"`
	EventsEnabled         bool `json:"events_enabled"`
	SecurityEventsEnabled bool `json:"security_events_enabled"`
}

// ReadFlags reads all fw_config ARRAY entries.
func ReadFlags(m *ebpf.Map) (FwFlags, error) {
	var raw [9]uint8
	for i := uint32(0); i < FwCfgMax; i++ {
		if err := m.Lookup(i, &raw[i]); err != nil {
			return FwFlags{}, fmt.Errorf("lookup fw_config[%d]: %w", i, err)
		}
	}
	return FwFlags{
		BlockICMPPing:         raw[0] != 0,
		BlockIPFragments:      raw[1] != 0,
		BlockMalformedTC:      raw[2] != 0,
		BlockAllTCP:           raw[3] != 0,
		BlockAllUDP:           raw[4] != 0,
		BlockBroadcast:        raw[5] != 0,
		BlockMulticast:        raw[6] != 0,
		EventsEnabled:         raw[7] != 0,
		SecurityEventsEnabled: raw[8] != 0,
	}, nil
}

// SetFlag writes a single fw_config flag (0=off, 1=on).
func SetFlag(m *ebpf.Map, key uint32, enabled bool) error {
	v := uint8(0)
	if enabled {
		v = 1
	}
	return m.Put(key, v)
}

// WriteFlags writes all flags to fw_config in one pass.
func WriteFlags(m *ebpf.Map, f FwFlags) error {
	pairs := []struct {
		key uint32
		val bool
	}{
		{FwCfgBlockICMPPing, f.BlockICMPPing},
		{FwCfgBlockIPFragments, f.BlockIPFragments},
		{FwCfgBlockMalformedTC, f.BlockMalformedTC},
		{FwCfgBlockAllTCP, f.BlockAllTCP},
		{FwCfgBlockAllUDP, f.BlockAllUDP},
		{FwCfgBlockBroadcast, f.BlockBroadcast},
		{FwCfgBlockMulticast, f.BlockMulticast},
		{FwCfgEventsEnabled, f.EventsEnabled},
		{FwCfgSecurityEvents, f.SecurityEventsEnabled},
	}
	for _, p := range pairs {
		if err := SetFlag(m, p.key, p.val); err != nil {
			return err
		}
	}
	return nil
}
