package api

import (
	"net/http"
)

func (s *Server) handleStatsLive(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsRunning() {
		writeError(w, http.StatusServiceUnavailable, "firewall not running")
		return
	}
	writeJSON(w, http.StatusOK, s.collector.Latest())
}
