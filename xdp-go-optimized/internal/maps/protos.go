package maps

import (
	"errors"

	"github.com/cilium/ebpf"
)

// AddProto blocks an IP protocol number (0-255).
func AddProto(m *ebpf.Map, proto uint8) error {
	v := uint8(1)
	return m.Put(proto, v)
}

// RemoveProto unblocks an IP protocol number.
func RemoveProto(m *ebpf.Map, proto uint8) error {
	err := m.Delete(proto)
	if errors.Is(err, ebpf.ErrKeyNotExist) {
		return nil
	}
	return err
}

// ListProtos returns all blocked protocol numbers.
func ListProtos(m *ebpf.Map) ([]uint8, error) {
	var protos []uint8
	var key uint8
	iter := m.Iterate()
	for {
		var val uint8
		if !iter.Next(&key, &val) {
			break
		}
		protos = append(protos, key)
	}
	return protos, iter.Err()
}

// SetProtos replaces the entire blocked_protos map with the given list.
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
