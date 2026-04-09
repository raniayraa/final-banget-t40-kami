package.path = package.path .. ";?.lua;test/?.lua;app/?.lua;"

print(string.format("Lua Version      : %s", pktgen.info.Lua_Version))
print(string.format("Pktgen Version   : %s", pktgen.info.Pktgen_Version))
print(string.format("Pktgen Copyright : %s", pktgen.info.Pktgen_Copyright))
print(string.format("Pktgen Authors   : %s", pktgen.info.Pktgen_Authors))

local log_file = "/tmp/pktgen_stats.log"
local f = io.open(log_file, "w")
f:write("Time,Port,Metric,Value\n")
f:close()

function timestamp()
    return os.date("%Y-%m-%d %H:%M:%S.000")
end

print("\n--- Starting per-second stats logging (all ports, until quit) ---\n")

while true do
    local t_start = os.clock()
    local time_str = timestamp()
    local stats = pktgen.portStats('all', 'port')

    for port, metrics in pairs(stats) do
        if type(metrics) == "table" then
            for metric, value in pairs(metrics) do
                local line = string.format("%s,%s,%s,%s\n",
                    time_str, tostring(port), tostring(metric), tostring(value))
                local ff = io.open(log_file, "a")
                ff:write(line)
                ff:close()
            end
        end
    end

    local t_elapsed = os.clock() - t_start
    local t_remain = 1.0 - t_elapsed
    if t_remain > 0 then
        pktgen.delay(math.floor(t_remain * 1000))
    end
end
