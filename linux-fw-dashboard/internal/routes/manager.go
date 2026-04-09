// Package routes manages kernel IP routes and neighbor (ARP) entries.
package routes

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
)

// RouteEntry represents a single kernel routing table entry.
type RouteEntry struct {
	Dest    string `json:"dest"`    // e.g. "192.168.1.0/24" or "default"
	Gateway string `json:"gateway"` // empty for directly-connected routes
	Dev     string `json:"dev"`     // interface name
	Metric  int    `json:"metric"`  // 0 = kernel default (not explicitly set)
}

// NeighEntry represents a single kernel neighbor (ARP) table entry.
type NeighEntry struct {
	IP    string `json:"ip"`    // neighbor IP address
	MAC   string `json:"mac"`   // link-layer address (e.g. "aa:bb:cc:dd:ee:ff")
	Dev   string `json:"dev"`   // interface name
	State string `json:"state"` // e.g. "PERMANENT", "REACHABLE", "STALE"
}

// ListRoutes runs "ip route show" and parses the output into RouteEntry slices.
func ListRoutes() ([]RouteEntry, error) {
	out, err := exec.Command("ip", "route", "show").Output()
	if err != nil {
		return nil, fmt.Errorf("ip route show: %w", err)
	}
	return parseRoutes(string(out)), nil
}

// AddRoute runs "ip route add" with the given entry fields.
func AddRoute(r RouteEntry) error {
	if r.Dest == "" {
		return fmt.Errorf("dest is required")
	}
	dest := r.Dest
	// Normalize CIDR to network address (e.g. 192.168.56.6/24 → 192.168.56.0/24).
	if _, ipNet, err := net.ParseCIDR(dest); err == nil {
		dest = ipNet.String()
	}
	args := []string{"route", "add", dest}
	if r.Gateway != "" {
		gw := r.Gateway
		// Strip prefix length if user typed e.g. "192.168.1.1/24" — only the IP is needed.
		if ip, _, err := net.ParseCIDR(gw); err == nil {
			gw = ip.String()
		}
		args = append(args, "via", gw)
	}
	if r.Dev != "" {
		args = append(args, "dev", r.Dev)
	}
	if r.Metric > 0 {
		args = append(args, "metric", strconv.Itoa(r.Metric))
	}
	out, err := exec.Command("ip", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ip route add: %w (output: %s)", err, out)
	}
	return nil
}

// DelRoute runs "ip route del <dest>".
func DelRoute(dest string) error {
	out, err := exec.Command("ip", "route", "del", dest).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ip route del: %w (output: %s)", err, out)
	}
	return nil
}

// ListNeighbors runs "ip neigh show" and returns entries that have a MAC address.
func ListNeighbors() ([]NeighEntry, error) {
	out, err := exec.Command("ip", "neigh", "show").Output()
	if err != nil {
		return nil, fmt.Errorf("ip neigh show: %w", err)
	}
	return parseNeighbors(string(out)), nil
}

// AddNeighbor adds a permanent static ARP entry via "ip neigh add ... nud permanent".
func AddNeighbor(n NeighEntry) error {
	if n.IP == "" || n.MAC == "" || n.Dev == "" {
		return fmt.Errorf("ip, mac, and dev are required")
	}
	out, err := exec.Command("ip", "neigh", "add", n.IP, "lladdr", n.MAC, "dev", n.Dev, "nud", "permanent").CombinedOutput()
	if err != nil {
		return fmt.Errorf("ip neigh add: %w (output: %s)", err, out)
	}
	return nil
}

// DelNeighbor removes a neighbor entry via "ip neigh del <ip> dev <dev>".
func DelNeighbor(ip, dev string) error {
	out, err := exec.Command("ip", "neigh", "del", ip, "dev", dev).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ip neigh del: %w (output: %s)", err, out)
	}
	return nil
}

// parseRoutes parses the output of "ip route show" token-by-token.
// Each line: <dest> [via <gw>] [dev <dev>] [proto ...] [scope ...] [metric N] ...
func parseRoutes(output string) []RouteEntry {
	var result []RouteEntry
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		tokens := strings.Fields(line)
		if len(tokens) == 0 {
			continue
		}
		r := RouteEntry{Dest: tokens[0]}
		for i := 1; i < len(tokens)-1; i++ {
			switch tokens[i] {
			case "via":
				r.Gateway = tokens[i+1]
				i++
			case "dev":
				r.Dev = tokens[i+1]
				i++
			case "metric":
				r.Metric, _ = strconv.Atoi(tokens[i+1])
				i++
			}
		}
		result = append(result, r)
	}
	return result
}

// parseNeighbors parses "ip neigh show" output.
// Each line: <ip> dev <iface> lladdr <mac> <STATE>
// Entries without a lladdr (FAILED/INCOMPLETE) are omitted.
func parseNeighbors(output string) []NeighEntry {
	var result []NeighEntry
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		tokens := strings.Fields(line)
		if len(tokens) < 2 {
			continue
		}
		n := NeighEntry{IP: tokens[0]}
		for i := 1; i < len(tokens)-1; i++ {
			switch tokens[i] {
			case "dev":
				n.Dev = tokens[i+1]
				i++
			case "lladdr":
				n.MAC = tokens[i+1]
				i++
			}
		}
		// Last token is the state (PERMANENT, REACHABLE, STALE, etc.)
		if len(tokens) > 0 {
			n.State = tokens[len(tokens)-1]
		}
		// Skip entries without a MAC (FAILED, INCOMPLETE states)
		if n.MAC == "" {
			continue
		}
		result = append(result, n)
	}
	return result
}
