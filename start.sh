#!/bin/bash

# Kill processes on backend and frontend ports
for PORT in 8765 5173; do
    PID=$(lsof -ti tcp:$PORT)
    if [ -n "$PID" ]; then
        echo "Killing process on port $PORT (PID: $PID)"
        kill -9 $PID
    else
        echo "No process on port $PORT"
    fi
done

sleep 1

# Start backend in background
echo "Starting backend..."
cd ~/final_t40/dashboard/backend
nohup uvicorn main:app --host 0.0.0.0 --port 8765 --reload > /tmp/backend.log 2>&1 &
echo "Backend PID: $!"

# Start frontend in background
echo "Starting frontend..."
cd ~/final_t40/dashboard/frontend
nohup npm run dev -- --host > /tmp/frontend.log 2>&1 &
echo "Frontend PID: $!"

echo ""
echo "Both services started. Logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
