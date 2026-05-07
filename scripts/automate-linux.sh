#!/bin/bash
#
# Start long_running.sh in the background
/home/telmat/rx-scripts/netdev-0-const.sh > /home/telmat/data-exp/log-$1-0.csv &
PID1=$!
/home/telmat/rx-scripts/netdev-1-const.sh > /home/telmat/data-exp/log-$1-1.csv &
PID2=$!
echo "Started monitoring script with PID $PID1 and $PID2"

# Wait 3 minutes (180 seconds)
sleep 95

# Kill the process
kill $PID1 $PID2
echo "Killed monitoring script (PID $PID1 and $PID2)"

scp /home/telmat/data-exp/log-$1-*.csv telmat@10.90.1.15:/home/telmat/exp-data/$1/
