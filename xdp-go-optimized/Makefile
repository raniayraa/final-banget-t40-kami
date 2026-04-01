CLANG     ?= clang
GOPATH    ?= $(shell go env GOPATH)
FRONTEND  := frontend

.PHONY: all tools generate gobuild frontend clean run

all: generate gobuild frontend

# Install bpf2go tool (one-time setup)
tools:
	go install github.com/cilium/ebpf/cmd/bpf2go@latest

# Step 1: Use bpf2go to compile BPF C and generate Go bindings
generate:
	go generate ./internal/bpfobj/...

# Step 2: Download dependencies and build Go binary
gobuild:
	go mod tidy
	go build -o xdpd ./cmd/xdpd/

# Step 3: Build React frontend
frontend:
	cd $(FRONTEND) && npm install && npm run build

# Run the daemon (requires root)
run:
	sudo ./xdpd -iface $(IFACE) -addr :8080 -static ./frontend/dist

clean:
	rm -f xdpd
	rm -f internal/bpfobj/*_bpfel.go internal/bpfobj/*_bpfeb.go internal/bpfobj/*.o
	cd $(FRONTEND) && rm -rf dist node_modules
