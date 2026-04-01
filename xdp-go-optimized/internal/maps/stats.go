// Package maps provides typed wrappers around the XDP BPF maps.
package maps

import (
	"context"
	"fmt"
	"time"

	"github.com/cilium/ebpf"
)

// Action indices — must match enum xdp_stat_key in common_kern_user.h.
const (
	StatDrop        = uint32(0)
	StatTX          = uint32(1)
	StatRedirect    = uint32(2)
	StatPass        = uint32(3)
	StatTTLExceeded = uint32(4)
	StatMax         = uint32(5)
)

// StatsRec is a per-action packet and byte counter.
type StatsRec struct {
	Packets uint64 `json:"packets"`
	Bytes   uint64 `json:"bytes"`
}

// StatsMap is the aggregated counters for all 5 actions.
type StatsMap struct {
	Drop        StatsRec `json:"drop"`
	TX          StatsRec `json:"tx"`
	Redirect    StatsRec `json:"redirect"`
	Pass        StatsRec `json:"pass"`
	TTLExceeded StatsRec `json:"ttl_exceeded"`
}

// perCPUStatsRec mirrors struct stats_rec for PERCPU_ARRAY lookup.
type perCPUStatsRec struct {
	Packets uint64
	Bytes   uint64
}

// ReadStats reads and aggregates the xdp_stats PERCPU_ARRAY map.
func ReadStats(m *ebpf.Map) (*StatsMap, error) {
	numCPU, err := ebpf.PossibleCPU()
	if err != nil {
		return nil, fmt.Errorf("get cpu count: %w", err)
	}

	result := &StatsMap{}
	recs := []*StatsRec{
		&result.Drop,
		&result.TX,
		&result.Redirect,
		&result.Pass,
		&result.TTLExceeded,
	}

	for key := uint32(0); key < StatMax; key++ {
		perCPU := make([]perCPUStatsRec, numCPU)
		if err := m.Lookup(key, &perCPU); err != nil {
			continue
		}
		for _, cpu := range perCPU {
			recs[key].Packets += cpu.Packets
			recs[key].Bytes += cpu.Bytes
		}
	}

	return result, nil
}

// PollStats repeatedly reads the xdp_stats PERCPU_ARRAY, computes per-interval deltas,
// and calls fn with the delta StatsMap every intervalSec seconds.
// Blocks until ctx is cancelled.
func PollStats(ctx context.Context, m *ebpf.Map, intervalSec int, fn func(delta StatsMap, intervalSec int)) error {
	var prev StatsMap
	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			cur, err := ReadStats(m)
			if err != nil {
				return err
			}
			delta := StatsMap{
				Drop:        StatsRec{cur.Drop.Packets - prev.Drop.Packets, cur.Drop.Bytes - prev.Drop.Bytes},
				TX:          StatsRec{cur.TX.Packets - prev.TX.Packets, cur.TX.Bytes - prev.TX.Bytes},
				Redirect:    StatsRec{cur.Redirect.Packets - prev.Redirect.Packets, cur.Redirect.Bytes - prev.Redirect.Bytes},
				Pass:        StatsRec{cur.Pass.Packets - prev.Pass.Packets, cur.Pass.Bytes - prev.Pass.Bytes},
				TTLExceeded: StatsRec{cur.TTLExceeded.Packets - prev.TTLExceeded.Packets, cur.TTLExceeded.Bytes - prev.TTLExceeded.Bytes},
			}
			prev = *cur
			fn(delta, intervalSec)
		}
	}
}
