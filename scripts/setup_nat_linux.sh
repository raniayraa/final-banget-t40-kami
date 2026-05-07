#!/bin/bash

# Check if $1 is a valid positive integer
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Not Adding SNAT IP Tables Rules" >&2
  exit 0
fi

# Interface definitions
IN_IF="enp1s0f0np0"            # to Node 4
OUT_IF="enp1s0f1np1"           # to Node 5

# IP address setup
IN_IP="192.168.1.2/24"
OUT_IP="192.168.2.2/24"

DNAT_NODE4="192.168.1.1"  # NAT target untuk trafik dari Node 5
DNAT_NODE5="192.168.2.3"  # NAT target untuk trafik dari Node 4

echo "[+] Setting interface IP..."
#ip addr flush dev $IN_IF
#ip addr flush dev $OUT_IF
#ip addr add $IN_IP dev $IN_IF
#ip addr add $OUT_IP dev $OUT_IF
#ip link set $IN_IF up
#ip link set $OUT_IF up

echo "[+] Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1
grep -q net.ipv4.ip_forward /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

echo "[+] Flushing iptables..."
iptables -F
iptables -t nat -F

echo "[+] Masquerading..."
iptables -t nat -A POSTROUTING -o $OUT_IF -j MASQUERADE
iptables -t nat -A POSTROUTING -o $IN_IF -j MASQUERADE

echo "[+] Adding FORWARD rules..."
iptables -A FORWARD -i $IN_IF -o $OUT_IF -j ACCEPT
iptables -A FORWARD -i $OUT_IF -o $IN_IF -j ACCEPT

#echo "[+] DNAT: Node 5 → Node 4"
#for port in $(seq 4000 $1); do
#  iptables -t nat -A PREROUTING -i $OUT_IF -p udp --dport $port -j DNAT --to-destination $DNAT_NODE4:4000
#done

#echo "[+] DNAT: Node 4 → Node 5"
#for port in $(seq 4000 $1); do
#  iptables -t nat -A PREROUTING -i $IN_IF -p udp --dport $port -j DNAT --to-destination $DNAT_NODE4:4000
#done

echo "[✓] NAT Linux selesai dikonfigurasi."
