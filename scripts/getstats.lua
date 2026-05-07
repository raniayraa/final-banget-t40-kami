package.path = package.path ..";?.lua;test/?.lua;app/?.lua;"

print(string.format("Lua Version      : %s", pktgen.info.Lua_Version))
print(string.format("Pktgen Version   : %s", pktgen.info.Pktgen_Version))
print(string.format("Pktgen Copyright : %s", pktgen.info.Pktgen_Copyright))
print(string.format("Pktgen Authors   : %s", pktgen.info.Pktgen_Authors))

local log_file = "/tmp/pktgen_stats.log"

local function now()
    return os.date("%Y-%m-%d %H:%M:%S.000")
end

local function stop_requested()
    local f = io.open("/tmp/stop_getstats", "r")
    if f then f:close() return true end
    return false
end

local f = io.open(log_file, "w")
f:write("Time,Port,Metric,Value\n")
f:close()

print("\n--- Starting full per-second stats logging ---\n")

for i = 0, 90 do
    if stop_requested() then break end

    local stats = pktgen.portStats('all', 'port')
    local ts = now()

    for k, v in pairs(stats) do
        if type(v) == "table" then
            for subk, subv in pairs(v) do
                print(string.format("Key: %s\n  %s: %s", tostring(k), tostring(subk), tostring(subv)))
                local f = io.open(log_file, "a")
                f:write(string.format("%s,%s,%s,%s\n", ts, tostring(k), tostring(subk), tostring(subv)))
                f:close()
            end
        else
            print(string.format("Key: %s\n  Value: %s", tostring(k), tostring(v)))
            local f = io.open(log_file, "a")
            f:write(string.format("%s,%s,Value,%s\n", ts, tostring(k), tostring(v)))
            f:close()
        end
    end

    pktgen.delay(1000) -- delay for 1 second
end

print("\nFinished logging to " .. log_file .. "\nHello World!!!!\n")
