// Package bpfobj contains the auto-generated Go bindings for xdp_prog_kern.c.
// Run "go generate ./internal/bpfobj/..." to regenerate after modifying BPF C sources.
package bpfobj

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -target bpf -I../../bpf/headers -I/home/telmat/belajar-rania/lib/install/include" XdpProg ../../bpf/xdp_prog_kern.c
