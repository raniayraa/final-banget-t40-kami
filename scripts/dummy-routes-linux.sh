#!/bin/bash

# Check if $1 is a valid positive integer
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Not Adding Multiple Routes" >&2
  exit 0
fi

COUNT=$1

# First interface configuration
INTERFACE="enp1s0f0np0"
GATEWAY="192.168.2.2"
MACADD="64:9d:99:ff:e6:cf"

for i in $(seq 1 "$COUNT"); do
  ip="10.100.$((i / 256)).$((i % 256))"
  sudo ip route add "$ip/32" via "$GATEWAY" dev "$INTERFACE"
  sudo ip neigh add "$ip" lladdr "$MACADD" dev "$INTERFACE"
done

# Optional second interface configuration
if [ -n "$2" ]; then
  INTERFACE="enp1s0f1np1"
  GATEWAY="192.168.1.2"
  MACADD="64:9d:99:ff:e7:af"

  for i in $(seq 1 "$COUNT"); do
    ip="10.200.$((i / 256)).$((i % 256))"
    sudo ip route add "$ip/32" via "$GATEWAY" dev "$INTERFACE"
    sudo ip neigh add "$ip" lladdr "$MACADD" dev "$INTERFACE"
  done
fi
