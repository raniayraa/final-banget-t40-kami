package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/telmat/xdp-go/internal/maps"
)

func (s *Server) handleGetRoutes(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}

	routes, err := maps.ListRoutes(s.mgr.Objects().FwdTable)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if routes == nil {
		routes = []maps.RouteEntry{}
	}
	writeJSON(w, http.StatusOK, routes)
}

func (s *Server) handlePostRoute(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}

	var entry maps.RouteEntry
	if !decodeJSON(w, r, &entry) {
		return
	}
	if entry.IP == "" || entry.DstMAC == "" || entry.SrcMAC == "" {
		writeError(w, http.StatusBadRequest, "ip, dst_mac, and src_mac are required")
		return
	}

	if err := maps.AddRoute(s.mgr.Objects().FwdTable, entry); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) handleDeleteRoute(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}

	ip := chi.URLParam(r, "ip")
	if ip == "" {
		writeError(w, http.StatusBadRequest, "missing ip parameter")
		return
	}

	if err := maps.DeleteRoute(s.mgr.Objects().FwdTable, ip); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "ip": ip})
}
