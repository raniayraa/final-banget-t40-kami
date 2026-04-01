package api

import (
	"net/http"
	"os"
	"path/filepath"
)

type statusResponse struct {
	DaemonRunning bool     `json:"daemon_running"`
	XDPAttached   bool     `json:"xdp_attached"`
	Interface     string   `json:"interface"`
	PinnedMaps    []string `json:"pinned_maps"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	attached := s.mgr.IsAttached()

	var mapNames []string
	entries, err := os.ReadDir(s.mgr.PinDir())
	if err == nil {
		for _, e := range entries {
			mapNames = append(mapNames, filepath.Base(e.Name()))
		}
	}

	writeJSON(w, http.StatusOK, statusResponse{
		DaemonRunning: attached,
		XDPAttached:   attached,
		Interface:     s.mgr.Ifname(),
		PinnedMaps:    mapNames,
	})
}
