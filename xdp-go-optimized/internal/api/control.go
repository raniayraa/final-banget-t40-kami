package api

import (
	"context"
	"net/http"

	"github.com/telmat/xdp-go/internal/maps"
)

// handleStart attaches the XDP program and starts the ring buffer consumer.
func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.mgr.IsAttached() {
		writeError(w, http.StatusConflict, "XDP already running")
		return
	}

	if err := s.mgr.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "start failed: "+err.Error())
		return
	}

	// Start ring buffer consumer goroutine.
	ctx, cancel := context.WithCancel(context.Background())
	s.rbufCancel = cancel
	go func() {
		_ = maps.ConsumeRingBuf(ctx, s.mgr.Objects().PacketEvents, s.store)
	}()

	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}

// handleRestart stops the XDP program (if running) and immediately starts it again.
// This re-applies default port blocklists and any startup config.
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.mgr.IsAttached() {
		if s.rbufCancel != nil {
			s.rbufCancel()
			s.rbufCancel = nil
		}
		if err := s.mgr.Stop(); err != nil {
			writeError(w, http.StatusInternalServerError, "stop failed: "+err.Error())
			return
		}
	}

	if err := s.mgr.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "start failed: "+err.Error())
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.rbufCancel = cancel
	go func() {
		_ = maps.ConsumeRingBuf(ctx, s.mgr.Objects().PacketEvents, s.store)
	}()

	writeJSON(w, http.StatusOK, map[string]string{"status": "restarted"})
}

// handleStop detaches the XDP program and stops the ring buffer consumer.
func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.mgr.IsAttached() {
		writeError(w, http.StatusConflict, "XDP not running")
		return
	}

	// Cancel the ring buffer consumer first.
	if s.rbufCancel != nil {
		s.rbufCancel()
		s.rbufCancel = nil
	}

	if err := s.mgr.Stop(); err != nil {
		writeError(w, http.StatusInternalServerError, "stop failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}
