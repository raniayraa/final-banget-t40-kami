// Package stats polls iptables counters and computes per-interval traffic rates.
package stats

import (
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// StatsRec holds delta packet and byte counts for one interval.
type StatsRec struct {
	Packets uint64 `json:"packets"`
	Bytes   uint64 `json:"bytes"`
}

// LiveStats is returned by GET /api/stats/live.
type LiveStats struct {
	Drop StatsRec `json:"drop"`
	Pass StatsRec `json:"pass"`
}

// snapshot is a raw absolute counter read at a point in time.
type snapshot struct {
	dropPkts  uint64
	dropBytes uint64
	passPkts  uint64
	passBytes uint64
	readAt    time.Time
}

// Collector runs a background goroutine that parses iptables counters every 2s.
type Collector struct {
	mu        sync.RWMutex
	latest    LiveStats
	stopCh    chan struct{}
	chain     string
}

// NewCollector creates a Collector. Call Start() to begin polling.
func NewCollector() *Collector {
	return &Collector{stopCh: make(chan struct{})}
}

// Start launches the background polling goroutine for the given iptables chain.
func (c *Collector) Start(chain string) {
	c.chain = chain
	go c.pollLoop()
}

// Stop signals the polling goroutine to exit.
func (c *Collector) Stop() {
	select {
	case c.stopCh <- struct{}{}:
	default:
	}
}

// Latest returns the most recently computed rate deltas. Safe for concurrent use.
func (c *Collector) Latest() LiveStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.latest
}

func (c *Collector) pollLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var prev snapshot
	havePrev := false

	for {
		select {
		case <-c.stopCh:
			return
		case t := <-ticker.C:
			out, err := exec.Command("iptables", "-L", c.chain, "-v", "-n", "-x").Output()
			if err != nil {
				continue
			}
			dp, db, pp, pb, err := parseCounters(string(out))
			if err != nil {
				continue
			}
			cur := snapshot{dp, db, pp, pb, t}
			if havePrev {
				c.mu.Lock()
				c.latest = LiveStats{
					Drop: StatsRec{
						Packets: safeDelta(cur.dropPkts, prev.dropPkts),
						Bytes:   safeDelta(cur.dropBytes, prev.dropBytes),
					},
					Pass: StatsRec{
						Packets: safeDelta(cur.passPkts, prev.passPkts),
						Bytes:   safeDelta(cur.passBytes, prev.passBytes),
					},
				}
				c.mu.Unlock()
			}
			prev = cur
			havePrev = true
		}
	}
}

// parseCounters parses "iptables -L <chain> -v -n -x" output.
// It sums pkts/bytes for all DROP-target rules (drop counters) and reads
// pkts/bytes from the RETURN-target rule (pass counter — always the last rule).
func parseCounters(output string) (dropPkts, dropBytes, passPkts, passBytes uint64, err error) {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		// Each data line has at least 3 columns: pkts bytes target ...
		if len(fields) < 3 {
			continue
		}
		pkts, e1 := strconv.ParseUint(fields[0], 10, 64)
		bytes, e2 := strconv.ParseUint(fields[1], 10, 64)
		if e1 != nil || e2 != nil {
			// Header line or non-numeric — skip.
			continue
		}
		target := fields[2]
		switch target {
		case "DROP":
			dropPkts += pkts
			dropBytes += bytes
		case "RETURN":
			passPkts = pkts
			passBytes = bytes
		}
	}
	return
}

// safeDelta returns cur - prev, or 0 if counters wrapped/reset.
func safeDelta(cur, prev uint64) uint64 {
	if cur >= prev {
		return cur - prev
	}
	return 0
}
