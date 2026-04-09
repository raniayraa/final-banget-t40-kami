package firewall

import "github.com/telmat/linux-fw/internal/config"

// buildFlagRules converts FwFlags into iptables argument slices for FW_CHAIN.
// Each returned slice is a complete set of arguments to pass to iptables -A FW_CHAIN.
func buildFlagRules(f config.FwFlags) [][]string {
	var rules [][]string

	if f.BlockICMPPing {
		rules = append(rules, []string{"-p", "icmp", "--icmp-type", "echo-request", "-j", "DROP"})
	}
	if f.BlockIPFragments {
		rules = append(rules, []string{"-f", "-j", "DROP"})
	}
	if f.BlockMalformedTC {
		// NULL scan: no flags set
		rules = append(rules, []string{"-p", "tcp", "--tcp-flags", "ALL", "NONE", "-j", "DROP"})
		// XMAS scan: all flags set
		rules = append(rules, []string{"-p", "tcp", "--tcp-flags", "ALL", "ALL", "-j", "DROP"})
		// SYN+FIN
		rules = append(rules, []string{"-p", "tcp", "--tcp-flags", "SYN,FIN", "SYN,FIN", "-j", "DROP"})
		// RST+FIN
		rules = append(rules, []string{"-p", "tcp", "--tcp-flags", "RST,FIN", "RST,FIN", "-j", "DROP"})
	}
	if f.BlockAllTCP {
		rules = append(rules, []string{"-p", "tcp", "-j", "DROP"})
	}
	if f.BlockAllUDP {
		rules = append(rules, []string{"-p", "udp", "-j", "DROP"})
	}
	if f.BlockBroadcast {
		rules = append(rules, []string{"-d", "255.255.255.255", "-j", "DROP"})
	}
	if f.BlockMulticast {
		rules = append(rules, []string{"-d", "224.0.0.0/4", "-j", "DROP"})
	}

	return rules
}
