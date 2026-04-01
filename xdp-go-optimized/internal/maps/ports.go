package maps

import (
	"errors"

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

// AddPort inserts a port into a blocked_ports_tcp or blocked_ports_udp HASH map.
func AddPort(m *ebpf.Map, port uint16) error {
	v := uint8(1)
	return m.Put(port, v)
}

// RemovePort deletes a port from a blocked ports map.
// Returns nil if the port was not present.
func RemovePort(m *ebpf.Map, port uint16) error {
	err := m.Delete(port)
	if errors.Is(err, ebpf.ErrKeyNotExist) {
		return nil
	}
	return err
}

// ListPorts iterates a blocked ports HASH map and returns all blocked port numbers.
func ListPorts(m *ebpf.Map) ([]uint16, error) {
	var ports []uint16
	var key uint16
	iter := m.Iterate()
	for {
		var val uint8
		if !iter.Next(&key, &val) {
			break
		}
		ports = append(ports, key)
	}
	return ports, iter.Err()
}

// SetPorts replaces the entire contents of a blocked ports map with the given list.
// Any port not in the list is removed.
func SetPorts(m *ebpf.Map, newPorts []uint16) error {
	existing, err := ListPorts(m)
	if err != nil {
		return err
	}

	wanted := make(map[uint16]struct{}, len(newPorts))
	for _, p := range newPorts {
		wanted[p] = struct{}{}
	}

	// Remove ports no longer wanted
	for _, p := range existing {
		if _, ok := wanted[p]; !ok {
			if err := RemovePort(m, p); err != nil {
				return err
			}
		}
	}

	// Add new ports
	for _, p := range newPorts {
		if err := AddPort(m, p); err != nil {
			return err
		}
	}
	return nil
}
