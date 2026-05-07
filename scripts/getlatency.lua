package.path = package.path .. ";?.lua;test/?.lua;app/?.lua;"

print("\n--- Collecting latency stats ---\n")

-- Enable latency measurement on port 0
pktgen.latency("0", "enable")

-- Short settle time to accumulate samples
pktgen.delay(500)

local stats = pktgen.latencyStats("0")

local min_ns    = stats.min_latency or 0
local avg_ns    = stats.avg_latency or 0
local max_ns    = stats.max_latency or 0
local jitter_ns = stats.jitter or 0

print(string.format("Latency -> min: %d ns, avg: %d ns, max: %d ns, jitter: %d ns",
    min_ns, avg_ns, max_ns, jitter_ns))

local f = io.open("/tmp/pktgen_latency.log", "w")
f:write("port,min_ns,avg_ns,max_ns,jitter_ns\n")
f:write(string.format("0,%d,%d,%d,%d\n", min_ns, avg_ns, max_ns, jitter_ns))
f:close()

print("Latency stats written to /tmp/pktgen_latency.log")
