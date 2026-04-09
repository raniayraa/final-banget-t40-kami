package api

import (
	"net/http"
)

type statusResponse struct {
	Running   bool   `json:"daemon_running"`
	Interface string `json:"interface"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, statusResponse{
		Running:   s.mgr.IsRunning(),
		Interface: s.iface,
	})
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.mgr.IsRunning() {
		writeError(w, http.StatusConflict, "firewall already running")
		return
	}

	if err := s.mgr.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "start failed: "+err.Error())
		return
	}

	s.collector.Start("FW_CHAIN")

	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.mgr.IsRunning() {
		writeError(w, http.StatusConflict, "firewall not running")
		return
	}

	s.collector.Stop()

	if err := s.mgr.Stop(); err != nil {
		writeError(w, http.StatusInternalServerError, "stop failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}
