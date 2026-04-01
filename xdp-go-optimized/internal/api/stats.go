package api

import (
	"net/http"

	"github.com/telmat/xdp-go/internal/maps"
)

func (s *Server) handleStatsLive(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}

	stats, err := maps.ReadStats(s.mgr.Objects().XdpStats)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, stats)
}
