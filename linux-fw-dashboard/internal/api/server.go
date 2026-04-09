// Package api provides the HTTP REST API and static file server.
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/telmat/linux-fw/internal/firewall"
	"github.com/telmat/linux-fw/internal/stats"
)

// Server holds shared state for all HTTP handlers.
type Server struct {
	mgr       *firewall.Manager
	collector *stats.Collector
	cfgPath   string
	iface     string
	mu        sync.Mutex
}

// NewServer creates a Server with the given firewall manager and stats collector.
func NewServer(mgr *firewall.Manager, collector *stats.Collector, cfgPath, iface string) *Server {
	return &Server{mgr: mgr, collector: collector, cfgPath: cfgPath, iface: iface}
}

// Router builds and returns the chi router with all API routes and static file serving.
func (s *Server) Router(staticDir string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Route("/api", func(r chi.Router) {
		r.Get("/status", s.handleStatus)
		r.Post("/start", s.handleStart)
		r.Post("/stop", s.handleStop)
		r.Get("/config", s.handleGetConfig)
		r.Put("/config", s.handlePutConfig)
		r.Get("/stats/live", s.handleStatsLive)
		r.Get("/routes", s.handleGetRoutes)
		r.Post("/routes", s.handlePostRoute)
		r.Delete("/routes/{dest}", s.handleDeleteRoute)
		r.Get("/neighbors", s.handleGetNeighbors)
		r.Post("/neighbors", s.handlePostNeighbor)
		r.Delete("/neighbors/{ip}/{dev}", s.handleDeleteNeighbor)
	})

	// Serve React build output; fall back to index.html for SPA routing.
	r.Handle("/*", spaHandler(staticDir))

	return r
}

// corsMiddleware adds permissive CORS headers for development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// spaHandler serves static files and falls back to index.html for any path
// that doesn't match an existing file (required for React Router client-side routing).
func spaHandler(dir string) http.Handler {
	fsys := http.Dir(dir)
	fileServer := http.FileServer(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := fsys.Open(r.URL.Path)
		if err != nil {
			if os.IsNotExist(err) {
				http.ServeFile(w, r, filepath.Join(dir, "index.html"))
				return
			}
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, r)
	})
}

// writeJSON encodes v as JSON and writes it to w with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// decodeJSON decodes the request body into dst. Returns false and writes an
// error response if decoding fails.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}
