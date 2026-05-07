#!/bin/bash

if [ "$1" != "" ]; then
        NIC=$1
else
    echo "Please provide the network interface you'd like to monitor."
    echo "example: $0 eth0"
    exit 1
fi

if [ "$2" != "" ]; then
        pktsize=$2
else
    echo "Please provide the packet size used"
    echo "example: $0 eth0 64"
    exit 1
fi

p=0
d=0
t=0
echo "timestamp(s);cpu(%);pps_received;pps_dropped;throughput(Mbits/s)"
while sleep 1; do
r=$(netstat -i | grep $NIC | awk '{print $3,$5}' | grep -v statistics)
        p_now=$(echo $r | awk '{print $1}')
        d_now=$(echo $r |awk '{print $2}')
        t=$((t+1))
        if [ "$p" -gt "0" ]; then
                dropped=$((d_now - d))
                rx=$((p_now - p))
                perc_d=$(echo "scale=5;($dropped/$rx)*100" | bc -l)
                #bitrate_rx=$(echo "scale=5;(rx*pktsize*8/1000)" | bc -l)
                bitrate_rx=$(echo "scale=2;($rx*$pktsize/100000)" | bc -l)
                cpu_usage=$(top -b -n 1 | grep ksoftirqd/ | awk '{sum += $9} END {print sum}')
                #echo "DEBUG: rx=$rx, pktsize=$pktsize"
                echo "$t;$cpu_usage;$rx;$dropped;$bitrate_rx"
        fi
        p=$p_now
        d=$d_now
done
