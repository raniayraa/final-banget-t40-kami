// Package config manages the persistent JSON configuration for the Linux firewall daemon.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// FwFlags holds all feature flags. JSON keys match the XDP version for frontend compatibility.
type FwFlags struct {
	BlockICMPPing    bool `json:"block_icmp_ping"`
	BlockIPFragments bool `json:"block_ip_fragments"`
	BlockMalformedTC bool `json:"block_malformed_tcp"`
	BlockAllTCP      bool `json:"block_all_tcp"`
	BlockAllUDP      bool `json:"block_all_udp"`
	BlockBroadcast   bool `json:"block_broadcast"`
	BlockMulticast   bool `json:"block_multicast"`
}

// FwConfig is the full persistent configuration state.
type FwConfig struct {
	Flags    FwFlags  `json:"flags"`
	TCPPorts []uint16 `json:"tcp_ports"`
	UDPPorts []uint16 `json:"udp_ports"`
	Protos   []int    `json:"protos"`
}

// Load reads a FwConfig from a JSON file. If the file does not exist, an empty
// FwConfig is returned without error. This means the daemon starts with no rules.
func Load(path string) (*FwConfig, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &FwConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg FwConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Save atomically writes cfg to path using a temp file + rename to prevent
// partial writes from corrupting the config on next daemon startup.
func Save(path string, cfg *FwConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
