package api

import (
	"net/http"

	"github.com/telmat/xdp-go/internal/maps"
)

// configResponse is the full firewall configuration returned by GET /api/config.
type configResponse struct {
	Flags    maps.FwFlags `json:"flags"`
	TCPPorts []uint16     `json:"tcp_ports"`
	UDPPorts []uint16     `json:"udp_ports"`
	Protos   []uint8      `json:"protos"`
}

// configRequest is the body for PUT /api/config.
// All fields are pointers so callers can send partial updates.
type configRequest struct {
	Flags    *maps.FwFlags `json:"flags"`
	TCPPorts []uint16      `json:"tcp_ports"`
	UDPPorts []uint16      `json:"udp_ports"`
	Protos   []uint8       `json:"protos"`
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}
	objs := s.mgr.Objects()

	flags, err := maps.ReadFlags(objs.FwConfig)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tcpPorts, err := maps.ListPorts(objs.BlockedPortsTcp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	udpPorts, err := maps.ListPorts(objs.BlockedPortsUdp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	protos, err := maps.ListProtos(objs.BlockedProtos)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, configResponse{
		Flags:    flags,
		TCPPorts: tcpPorts,
		UDPPorts: udpPorts,
		Protos:   protos,
	})
}

func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	if !s.mgr.IsAttached() {
		writeError(w, http.StatusServiceUnavailable, "XDP not running")
		return
	}

	var req configRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	objs := s.mgr.Objects()

	if req.Flags != nil {
		if err := maps.WriteFlags(objs.FwConfig, *req.Flags); err != nil {
			writeError(w, http.StatusInternalServerError, "write flags: "+err.Error())
			return
		}
	}
	if req.TCPPorts != nil {
		if err := maps.SetPorts(objs.BlockedPortsTcp, req.TCPPorts); err != nil {
			writeError(w, http.StatusInternalServerError, "write tcp ports: "+err.Error())
			return
		}
	}
	if req.UDPPorts != nil {
		if err := maps.SetPorts(objs.BlockedPortsUdp, req.UDPPorts); err != nil {
			writeError(w, http.StatusInternalServerError, "write udp ports: "+err.Error())
			return
		}
	}
	if req.Protos != nil {
		if err := maps.SetProtos(objs.BlockedProtos, req.Protos); err != nil {
			writeError(w, http.StatusInternalServerError, "write protos: "+err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
