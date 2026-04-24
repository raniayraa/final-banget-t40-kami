package.path = package.path .. ";?.lua;test/?.lua;app/?.lua;../?.lua"

print("\n--- Collecting latency stats ---\n")

local port = 0
local port_stats = pktgen.pktStats(port)

-- Always write the file so the fetch task never silently fails
local f = io.open("/tmp/pktgen_latency.log", "w")
f:write("port,min_us,avg_us,max_us,num_pkts\n")

if port_stats == nil then
    print("ERROR: pktStats returned nil")
    f:write("0,0,0,0,0\n")
    f:close()
    return
end

prints("pktStats", port_stats)

local lat = port_stats[port] and port_stats[port].latency or nil

if lat == nil then
    print("ERROR: no latency subtable in pktStats")
    f:write("0,0,0,0,0\n")
    f:close()
    return
end

local num_pkts = lat.num_pkts or 0
local min_us   = lat.min_us   or 0
local avg_us   = lat.avg_us   or 0
local max_us   = lat.max_us   or 0

print(string.format("Latency -> min: %.2f us, avg: %.2f us, max: %.2f us, pkts: %d",
    min_us, avg_us, max_us, num_pkts))

f:write(string.format("0,%.2f,%.2f,%.2f,%d\n", min_us, avg_us, max_us, num_pkts))
f:close()

print("Latency stats written to /tmp/pktgen_latency.log")
