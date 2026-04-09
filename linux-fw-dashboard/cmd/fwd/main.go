// fwd — Linux Firewall Dashboard daemon with REST API and React frontend.
//
// Usage:
//
//	sudo ./fwd [-iface <NIC>] [-config <file>] [-addr :8080] [-static ./frontend/dist]
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/telmat/linux-fw/internal/api"
	"github.com/telmat/linux-fw/internal/config"
	"github.com/telmat/linux-fw/internal/firewall"
	"github.com/telmat/linux-fw/internal/stats"
)

func main() {
	iface      := flag.String("iface",  "",                "network interface name (informational only)")
	cfgPath    := flag.String("config", "./config.json",   "path to persistent JSON config file")
	addr       := flag.String("addr",   ":8080",           "HTTP listen address")
	static     := flag.String("static", "./frontend/dist", "React build directory to serve")
	flag.Parse()

	if os.Getuid() != 0 {
		log.Fatal("fwd must run as root (UID 0) to use iptables and ip route")
	}

	// Load persistent config (non-existence is OK — starts with empty config).
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config %s: %v", *cfgPath, err)
	}

	mgr       := firewall.NewManager(cfg)
	collector := stats.NewCollector()
	srv       := api.NewServer(mgr, collector, *cfgPath, *iface)

	httpSrv := &http.Server{
		Addr:         *addr,
		Handler:      srv.Router(*static),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("fwd listening on %s  (config=%s)", *addr, *cfgPath)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutCtx)

	if mgr.IsRunning() {
		collector.Stop()
		if err := mgr.Stop(); err != nil {
			log.Printf("stop firewall: %v", err)
		}
	}
	log.Println("bye")
}
