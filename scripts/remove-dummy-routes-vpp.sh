#!/bin/bash
#
# Check if $1 is a valid positive integer
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Not Adding Multiple Routes" >&2
  exit 0
fi

COUNT=$1

for i in $(seq 1 "$COUNT"); do
  ip="10.100.$((i / 256)).$((i % 256))"
  sudo vppctl ip route del $ip/32 via eth0
done

# Optional second interface configuration
if [ -n "$2" ]; then

  for i in $(seq 1 "$COUNT"); do
    ip="10.200.$((i / 256)).$((i % 256))"
    sudo vppctl ip route del $ip/32 via eth1
  done
fi
