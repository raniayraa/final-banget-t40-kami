package api

import (
	"context"
	"net"
	"net/http"

	"github.com/telmat/xdp-go/internal/maps"
)

type settingsResponse struct {
	Iface       string   `json:"iface"`
	RedirectDev string   `json:"redirect_dev"`
	Interfaces  []string `json:"interfaces"`
}

// handleGetSettings returns the current iface/redirect-dev and available NICs.
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	ifaces, _ := listInterfaces()
	writeJSON(w, http.StatusOK, settingsResponse{
		Iface:       s.mgr.Ifname(),
		RedirectDev: s.mgr.RedirectDev(),
		Interfaces:  ifaces,
	})
}

// handlePutSettings changes iface/redirect-dev. If XDP is running it is
// stopped, reconfigured, then restarted automatically.
func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Iface       string `json:"iface"`
		RedirectDev string `json:"redirect_dev"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Iface == "" {
		writeError(w, http.StatusBadRequest, "iface is required")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	wasRunning := s.mgr.IsAttached()
	if wasRunning {
		if s.rbufCancel != nil {
			s.rbufCancel()
			s.rbufCancel = nil
		}
		if err := s.mgr.Stop(); err != nil {
			writeError(w, http.StatusInternalServerError, "stop: "+err.Error())
			return
		}
	}

	if err := s.mgr.Reconfigure(req.Iface, req.RedirectDev); err != nil {
		writeError(w, http.StatusInternalServerError, "reconfigure: "+err.Error())
		return
	}

	if wasRunning {
		if err := s.mgr.Start(); err != nil {
			writeError(w, http.StatusInternalServerError, "start: "+err.Error())
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		s.rbufCancel = cancel
		go func() {
			_ = maps.ConsumeRingBuf(ctx, s.mgr.Objects().PacketEvents, s.store)
		}()
	}

	ifaces, _ := listInterfaces()
	writeJSON(w, http.StatusOK, settingsResponse{
		Iface:       s.mgr.Ifname(),
		RedirectDev: s.mgr.RedirectDev(),
		Interfaces:  ifaces,
	})
}

// listInterfaces returns all non-loopback network interface names.
func listInterfaces() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var names []string
	for _, iface := range ifaces {
		if iface.Name == "lo" {
			continue
		}
		names = append(names, iface.Name)
	}
	return names, nil
}
