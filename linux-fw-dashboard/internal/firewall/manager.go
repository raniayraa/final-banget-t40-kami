// Package firewall manages iptables rules for the Linux firewall daemon.
package firewall

import (
	"fmt"
	"os/exec"
	"strconv"
	"sync"

	"github.com/telmat/linux-fw/internal/config"
)

const chainName = "FW_CHAIN"

// Manager owns the iptables chain lifecycle and the current configuration.
type Manager struct {
	mu      sync.RWMutex
	running bool
	cfg     config.FwConfig
}

// NewManager creates a Manager initialized with cfg. The firewall is not
// started automatically — call Start() to attach iptables rules.
func NewManager(cfg *config.FwConfig) *Manager {
	m := &Manager{}
	if cfg != nil {
		m.cfg = *cfg
	}
	return m
}

// Start creates FW_CHAIN, inserts it into the INPUT chain, then applies
// the current configuration. It is idempotent: safe to call if the chain
// already exists from a previous (crashed) daemon run.
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create chain — ignore "already exists" error.
	_ = ipt("-N", chainName)

	// Flush whatever was left from a previous run.
	if err := ipt("-F", chainName); err != nil {
		return fmt.Errorf("flush %s: %w", chainName, err)
	}

	// Insert the jump into INPUT only if it doesn't already exist.
	if err := ipt("-C", "INPUT", "-j", chainName); err != nil {
		// -C returned non-zero → the rule doesn't exist, so insert it.
		if err2 := ipt("-I", "INPUT", "1", "-j", chainName); err2 != nil {
			return fmt.Errorf("insert INPUT jump: %w", err2)
		}
	}

	if err := m.apply(); err != nil {
		return err
	}

	m.running = true
	return nil
}

// Stop removes the INPUT jump, flushes, and deletes FW_CHAIN.
func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	_ = ipt("-D", "INPUT", "-j", chainName)
	_ = ipt("-F", chainName)
	_ = ipt("-X", chainName)

	m.running = false
	return nil
}

// IsRunning reports whether the firewall chain is active.
func (m *Manager) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.running
}

// ApplyConfig updates the in-memory config and rebuilds all rules in FW_CHAIN.
// Safe to call while running (flushes then rebuilds atomically within the mutex).
func (m *Manager) ApplyConfig(cfg config.FwConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg = cfg
	if !m.running {
		return nil
	}
	return m.apply()
}

// GetConfig returns a copy of the current configuration.
func (m *Manager) GetConfig() config.FwConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

// apply rebuilds all rules in FW_CHAIN from m.cfg. Must be called with m.mu held.
func (m *Manager) apply() error {
	// Flush existing rules.
	if err := ipt("-F", chainName); err != nil {
		return fmt.Errorf("flush chain: %w", err)
	}

	// Feature-flag rules.
	for _, rule := range buildFlagRules(m.cfg.Flags) {
		args := append([]string{"-A", chainName}, rule...)
		if err := ipt(args...); err != nil {
			return fmt.Errorf("add flag rule %v: %w", rule, err)
		}
	}

	// Blocked TCP ports.
	for _, p := range m.cfg.TCPPorts {
		if err := ipt("-A", chainName, "-p", "tcp", "--dport", strconv.Itoa(int(p)), "-j", "DROP"); err != nil {
			return fmt.Errorf("add tcp port %d: %w", p, err)
		}
	}

	// Blocked UDP ports.
	for _, p := range m.cfg.UDPPorts {
		if err := ipt("-A", chainName, "-p", "udp", "--dport", strconv.Itoa(int(p)), "-j", "DROP"); err != nil {
			return fmt.Errorf("add udp port %d: %w", p, err)
		}
	}

	// Blocked IP protocols.
	for _, proto := range m.cfg.Protos {
		if err := ipt("-A", chainName, "-p", strconv.Itoa(proto), "-j", "DROP"); err != nil {
			return fmt.Errorf("add proto %d: %w", proto, err)
		}
	}

	// Final RETURN rule — this is the "pass" counter. Must always be last.
	if err := ipt("-A", chainName, "-j", "RETURN"); err != nil {
		return fmt.Errorf("add RETURN: %w", err)
	}

	return nil
}

// ipt runs iptables with the given arguments and returns an error on non-zero exit.
func ipt(args ...string) error {
	cmd := exec.Command("iptables", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("iptables %v: %w (output: %s)", args, err, out)
	}
	return nil
}
