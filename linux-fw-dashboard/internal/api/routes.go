package api

import (
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/telmat/linux-fw/internal/routes"
)

// ── Routes (ip route) ────────────────────────────────────────────────────────

func (s *Server) handleGetRoutes(w http.ResponseWriter, r *http.Request) {
	list, err := routes.ListRoutes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if list == nil {
		list = []routes.RouteEntry{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handlePostRoute(w http.ResponseWriter, r *http.Request) {
	var entry routes.RouteEntry
	if !decodeJSON(w, r, &entry) {
		return
	}
	if entry.Dest == "" {
		writeError(w, http.StatusBadRequest, "dest is required")
		return
	}
	if err := routes.AddRoute(entry); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) handleDeleteRoute(w http.ResponseWriter, r *http.Request) {
	// dest may be URL-encoded (e.g. "192.168.1.0%2F24" for CIDR notation).
	dest, _ := url.QueryUnescape(chi.URLParam(r, "dest"))
	if dest == "" {
		writeError(w, http.StatusBadRequest, "missing dest parameter")
		return
	}
	if err := routes.DelRoute(dest); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "dest": dest})
}

// ── Neighbors (ip neigh) ─────────────────────────────────────────────────────

func (s *Server) handleGetNeighbors(w http.ResponseWriter, r *http.Request) {
	list, err := routes.ListNeighbors()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if list == nil {
		list = []routes.NeighEntry{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handlePostNeighbor(w http.ResponseWriter, r *http.Request) {
	var entry routes.NeighEntry
	if !decodeJSON(w, r, &entry) {
		return
	}
	if entry.IP == "" || entry.MAC == "" || entry.Dev == "" {
		writeError(w, http.StatusBadRequest, "ip, mac, and dev are required")
		return
	}
	if err := routes.AddNeighbor(entry); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entry.State = "PERMANENT"
	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) handleDeleteNeighbor(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	dev := chi.URLParam(r, "dev")
	if ip == "" || dev == "" {
		writeError(w, http.StatusBadRequest, "ip and dev are required")
		return
	}
	if err := routes.DelNeighbor(ip, dev); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "ip": ip, "dev": dev})
}
