#!/bin/bash

INPUT_FILE="/tmp/output.log"    # Change this if your input file is named differently
OUTPUT_FILE="pktgen_summary.csv"

echo "timestamp(s);cpu(%);pps_rx;pps_rx_missed;pps_rx_error;rx_throughput(Mbits/s);pps_tx;pps_tx_error;tx_throughput(Mbits/s)" > "$OUTPUT_FILE"

declare -A prev
declare -A curr

last_time=0

tail -n +2 "$INPUT_FILE" | while IFS=',' read -r time key metric value; do
    # skip lines without numeric timestamps
    [[ "$time" =~ ^[0-9]+$ ]] || continue

    curr["$metric"]=$value

    if [[ "$last_time" -ne "$time" ]]; then
        if [[ "$last_time" -ne 0 ]]; then
            delta_time=$((time - last_time))
            # Avoid division by zero
            [[ "$delta_time" -eq 0 ]] && delta_time=1

            # Calculate deltas
            pps_rx=$((curr[ipackets] - prev[ipackets]))
            pps_tx=$((curr[opackets] - prev[opackets]))
            rx_missed=$((curr[imissed] - prev[imissed]))
            rx_error=$((curr[ierrors] - prev[ierrors]))
            tx_error=$((curr[oerrors] - prev[oerrors]))

            ibytes_diff=$((curr[ibytes] - prev[ibytes]))
            obytes_diff=$((curr[obytes] - prev[obytes]))

            rx_mbps=$(awk "BEGIN {printf \"%.2f\", ($ibytes_diff * 8) / (1024 * 1024 * $delta_time)}")
            tx_mbps=$(awk "BEGIN {printf \"%.2f\", ($obytes_diff * 8) / (1024 * 1024 * $delta_time)}")

            echo "$time;0;$pps_rx;$rx_missed;$rx_error;$rx_mbps;$pps_tx;$tx_error;$tx_mbps" >> "$OUTPUT_FILE"
        fi

        # Copy current to previous
        for m in ipackets imissed ierrors opackets oerrors ibytes obytes; do
            prev["$m"]=${curr["$m"]}
        done

        last_time=$time
    fi
done
