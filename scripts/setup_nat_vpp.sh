#!/bin/bash

# Check if $1 is a valid positive integer
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "Not Adding SNAT IP Tables Rules" >&2
  exit 0
fi

vppctl nat44 plugin enable
vppctl set interface nat44 in eth1
vppctl set interface nat44 out eth0
vppctl set interface nat44 in eth0
vppctl set interface nat44 out eth1
vppctl nat44 add interface address eth0
vppctl nat44 add interface address eth1
