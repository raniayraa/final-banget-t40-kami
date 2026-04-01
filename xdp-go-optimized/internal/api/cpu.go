package api

import (
	"fmt"
	"log"
	"math/bits"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type cpuResponse struct {
	NumCPUs int `json:"num_cpus"`
	MaxCPUs int `json:"max_cpus"`
}

// handleGetCPU returns the current CPU affinity count and the system maximum.
func (s *Server) handleGetCPU(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cpuResponse{
		NumCPUs: readCurrentCPUCount(),
		MaxCPUs: runtime.NumCPU(),
	})
}

// handlePutCPU limits packet processing to CPUs 0..(num_cpus-1) by:
//  1. Pinning this daemon process via taskset
//  2. Setting NIC RX/TX queue count to num_cpus via ethtool
//  3. Pinning each NIC IRQ to its corresponding CPU
func (s *Server) handlePutCPU(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NumCPUs int `json:"num_cpus"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	max := runtime.NumCPU()
	if req.NumCPUs < 1 || req.NumCPUs > max {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("num_cpus must be between 1 and %d", max))
		return
	}

	cpuList := "0"
	if req.NumCPUs > 1 {
		cpuList = fmt.Sprintf("0-%d", req.NumCPUs-1)
	}

	// 1. Pin daemon process.
	pid := strconv.Itoa(os.Getpid())
	if out, err := exec.Command("taskset", "-cp", cpuList, pid).CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError,
			"taskset: "+strings.TrimSpace(string(out)))
		return
	}

	iface := s.mgr.Ifname()
	redirectDev := s.mgr.RedirectDev()

	// 2. Set NIC queue count = num_cpus so the kernel only schedules RX on those queues.
	if err := setNICQueues(iface, req.NumCPUs); err != nil {
		log.Printf("warn: set NIC queues %s: %v", iface, err)
	}
	if redirectDev != "" {
		if err := setNICQueues(redirectDev, req.NumCPUs); err != nil {
			log.Printf("warn: set NIC queues %s: %v", redirectDev, err)
		}
	}

	// 3. Pin each NIC IRQ to a dedicated CPU (round-robin within the allowed set).
	if err := pinIRQs(iface, req.NumCPUs); err != nil {
		log.Printf("warn: pin IRQs %s: %v", iface, err)
	}
	if redirectDev != "" {
		if err := pinIRQs(redirectDev, req.NumCPUs); err != nil {
			log.Printf("warn: pin IRQs %s: %v", redirectDev, err)
		}
	}

	writeJSON(w, http.StatusOK, cpuResponse{NumCPUs: req.NumCPUs, MaxCPUs: max})
}

// setNICQueues tries to set the NIC combined queue count; falls back to rx+tx.
func setNICQueues(iface string, n int) error {
	ns := strconv.Itoa(n)
	out, err := exec.Command("ethtool", "-L", iface, "combined", ns).CombinedOutput()
	if err == nil {
		return nil
	}
	// Some NICs don't support combined — try separate rx/tx.
	out, err = exec.Command("ethtool", "-L", iface, "rx", ns, "tx", ns).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ethtool -L %s: %s", iface, strings.TrimSpace(string(out)))
	}
	return nil
}

// pinIRQs reads /proc/interrupts for iface, then writes smp_affinity for each
// IRQ so that queue-i goes to CPU (i % numCPUs).
func pinIRQs(iface string, numCPUs int) error {
	data, err := os.ReadFile("/proc/interrupts")
	if err != nil {
		return err
	}

	i := 0
	for _, line := range strings.Split(string(data), "\n") {
		// Match lines that contain the iface name.
		if !strings.Contains(line, iface) {
			continue
		}
		// IRQ number is the first field before the colon.
		fields := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(fields) < 1 {
			continue
		}
		irq := strings.TrimSpace(fields[0])
		if _, err := strconv.Atoi(irq); err != nil {
			continue // skip non-numeric (header lines, etc.)
		}

		cpu := i % numCPUs
		mask := fmt.Sprintf("%x", 1<<cpu)
		affinityPath := filepath.Join("/proc/irq", irq, "smp_affinity")
		if err := os.WriteFile(affinityPath, []byte(mask), 0); err != nil {
			log.Printf("warn: set IRQ %s affinity to CPU %d: %v", irq, cpu, err)
		}
		i++
	}
	return nil
}

// readCurrentCPUCount reads /proc/self/status and counts the bits set in the
// Cpus_allowed hex mask to determine how many CPUs this process can use.
func readCurrentCPUCount() int {
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return runtime.NumCPU()
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "Cpus_allowed:\t") {
			continue
		}
		hexStr := strings.TrimSpace(strings.TrimPrefix(line, "Cpus_allowed:\t"))
		hexStr = strings.ReplaceAll(hexStr, ",", "")
		count := 0
		for _, c := range hexStr {
			var nibble uint8
			switch {
			case c >= '0' && c <= '9':
				nibble = uint8(c - '0')
			case c >= 'a' && c <= 'f':
				nibble = uint8(c-'a') + 10
			case c >= 'A' && c <= 'F':
				nibble = uint8(c-'A') + 10
			default:
				continue
			}
			count += bits.OnesCount8(nibble)
		}
		if count > 0 {
			return count
		}
	}
	return runtime.NumCPU()
}
