package api

import (
	"net"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/telmat/xdp-go/internal/maps"
)

// handleGetDevmap returns all populated tx_port DEVMAP slots.
//
//	GET /api/devmap
//	→ [{"slot":0,"ifindex":3,"iface":"eth1"}, ...]
func (s *Server) handleGetDevmap(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusConflict, "XDP not running")
		return
	}
	entries := maps.ListDevmapSlots(s.mgr.Objects().TxPort)
	if entries == nil {
		entries = []maps.DevmapEntry{}
	}
	writeJSON(w, http.StatusOK, entries)
}

// handlePostDevmap adds or updates an egress NIC in the tx_port DEVMAP.
//
//	POST /api/devmap
//	Body: {"slot": 0, "iface": "eth1"}
func (s *Server) handlePostDevmap(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusConflict, "XDP not running")
		return
	}
	var req struct {
		Slot  uint32 `json:"slot"`
		Iface string `json:"iface"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Iface == "" {
		writeError(w, http.StatusBadRequest, "iface is required")
		return
	}
	iface, err := net.InterfaceByName(req.Iface)
	if err != nil {
		writeError(w, http.StatusBadRequest, "interface not found: "+req.Iface)
		return
	}
	if err := maps.SetDevmapSlot(s.mgr.Objects().TxPort, req.Slot, uint32(iface.Index)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleDeleteDevmap removes an egress NIC from a tx_port DEVMAP slot.
//
//	DELETE /api/devmap/{slot}
func (s *Server) handleDeleteDevmap(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusConflict, "XDP not running")
		return
	}
	slotStr := chi.URLParam(r, "slot")
	slot64, err := strconv.ParseUint(slotStr, 10, 32)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid slot: "+slotStr)
		return
	}
	if err := maps.DeleteDevmapSlot(s.mgr.Objects().TxPort, uint32(slot64)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
