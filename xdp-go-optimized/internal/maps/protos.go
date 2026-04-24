package maps

import (
	"github.com/cilium/ebpf"
)

// AddProto blocks an IP protocol number (0-255).
func AddProto(m *ebpf.Map, proto uint8) error {
	v := uint8(1)
	return m.Put(uint32(proto), v)
}

// RemoveProto unblocks an IP protocol number by zeroing its entry in the ARRAY map.
func RemoveProto(m *ebpf.Map, proto uint8) error {
	v := uint8(0)
	return m.Put(uint32(proto), v)
}

// ListProtos iterates the ARRAY map and returns all protocol numbers where the value is non-zero.
func ListProtos(m *ebpf.Map) ([]uint8, error) {
	var protos []uint8
	var key uint32
	iter := m.Iterate()
	for {
		var val uint8
		if !iter.Next(&key, &val) {
			break
		}
		if val != 0 {
			protos = append(protos, uint8(key))
		}
	}
	return protos, iter.Err()
}

// SetProtos replaces the blocked_protos map with the given list.
func SetProtos(m *ebpf.Map, newProtos []uint8) error {
	existing, err := ListProtos(m)
	if err != nil {
		return err
	}

	wanted := make(map[uint8]struct{}, len(newProtos))
	for _, p := range newProtos {
		wanted[p] = struct{}{}
	}

	for _, p := range existing {
		if _, ok := wanted[p]; !ok {
			if err := RemoveProto(m, p); err != nil {
				return err
			}
		}
	}
	for _, p := range newProtos {
		if err := AddProto(m, p); err != nil {
			return err
		}
	}
	return nil
}
