package api

import (
	"net/http"

	"github.com/telmat/linux-fw/internal/config"
)

// configRequest is the body for PUT /api/config.
// All fields are pointers/nil-able so callers can send partial updates.
type configRequest struct {
	Flags    *config.FwFlags `json:"flags"`
	TCPPorts []uint16        `json:"tcp_ports"`
	UDPPorts []uint16        `json:"udp_ports"`
	Protos   []int           `json:"protos"`
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := s.mgr.GetConfig()
	// Ensure slices are non-null in JSON output.
	if cfg.TCPPorts == nil {
		cfg.TCPPorts = []uint16{}
	}
	if cfg.UDPPorts == nil {
		cfg.UDPPorts = []uint16{}
	}
	if cfg.Protos == nil {
		cfg.Protos = []int{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"flags":     cfg.Flags,
		"tcp_ports": cfg.TCPPorts,
		"udp_ports": cfg.UDPPorts,
		"protos":    cfg.Protos,
	})
}

func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	var req configRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Reject protocol 0 ("all") or out-of-range values to prevent accidents.
	for _, p := range req.Protos {
		if p <= 0 || p > 255 {
			writeError(w, http.StatusBadRequest, "protocol must be 1–255")
			return
		}
	}

	// Start from the current config and merge the partial update.
	cfg := s.mgr.GetConfig()
	if req.Flags != nil {
		cfg.Flags = *req.Flags
	}
	if req.TCPPorts != nil {
		cfg.TCPPorts = req.TCPPorts
	}
	if req.UDPPorts != nil {
		cfg.UDPPorts = req.UDPPorts
	}
	if req.Protos != nil {
		cfg.Protos = req.Protos
	}

	// Apply live (rebuilds iptables rules if firewall is running).
	if err := s.mgr.ApplyConfig(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "apply config: "+err.Error())
		return
	}

	// Persist to JSON file for next daemon startup.
	if s.cfgPath != "" {
		if err := config.Save(s.cfgPath, &cfg); err != nil {
			// Non-fatal: log but continue (in-memory config is already updated).
			_ = err
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
