package maps

import (
	"github.com/cilium/ebpf"
)

// Default blocked port lists — mirrors the Python/C app's built-in security baseline.
// These are seeded automatically on each fresh XDP attach unless overridden by a config file.

// DefaultTCPPorts is the default set of TCP destination ports to block:
// FTP, SSH, Telnet, TFTP, NetBIOS, SMB, RDP, VNC, MSSQL, Oracle, MySQL, PostgreSQL.
var DefaultTCPPorts = []uint16{20, 21, 22, 23, 69, 135, 137, 138, 139, 445, 1433, 1521, 3306, 3389, 5432, 5900}

// DefaultUDPPorts is the default set of UDP destination ports to block:
// DNS, TFTP, NTP, NetBIOS, SNMP, Memcached.
var DefaultUDPPorts = []uint16{53, 69, 123, 137, 138, 161, 162, 11211}

// AddPort marks a port as blocked in a blocked_ports_tcp or blocked_ports_udp ARRAY map.
func AddPort(m *ebpf.Map, port uint16) error {
	v := uint8(1)
	return m.Put(uint32(port), v)
}

// RemovePort unblocks a port by zeroing its entry in the ARRAY map.
func RemovePort(m *ebpf.Map, port uint16) error {
	v := uint8(0)
	return m.Put(uint32(port), v)
}

// ListPorts iterates the ARRAY map and returns all ports where the value is non-zero.
func ListPorts(m *ebpf.Map) ([]uint16, error) {
	var ports []uint16
	var key uint32
	iter := m.Iterate()
	for {
		var val uint8
		if !iter.Next(&key, &val) {
			break
		}
		if val != 0 {
			ports = append(ports, uint16(key))
		}
	}
	return ports, iter.Err()
}

// SetPorts replaces the blocked port list: zeros out removed ports, sets new ones.
func SetPorts(m *ebpf.Map, newPorts []uint16) error {
	existing, err := ListPorts(m)
	if err != nil {
		return err
	}

	wanted := make(map[uint16]struct{}, len(newPorts))
	for _, p := range newPorts {
		wanted[p] = struct{}{}
	}

	for _, p := range existing {
		if _, ok := wanted[p]; !ok {
			if err := RemovePort(m, p); err != nil {
				return err
			}
		}
	}

	for _, p := range newPorts {
		if err := AddPort(m, p); err != nil {
			return err
		}
	}
	return nil
}
