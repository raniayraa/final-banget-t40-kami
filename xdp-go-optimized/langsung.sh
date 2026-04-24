# Build clean. Sekarang rebuild binary dan restart daemon:

sudo pkill xdpd
# Di node6
go build -o xdpd ./cmd/xdpd/

sudo ./xdpd \
  -iface enp1s0f1np1 \
  -redirect-dev enp1s0f0np0 \
  -config turbo.json \
  -static ./frontend/dist \
  -addr :8085