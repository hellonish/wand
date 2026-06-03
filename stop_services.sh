#!/bin/bash

# Stop all services for Wand application
echo "Stopping Wand services..."

# Read PIDs from file if it exists
PID_FILE="/Users/nishant/Desktop/wand/.pids"
if [ -f "$PID_FILE" ]; then
    echo "Stopping processes from PID file..."
    while IFS= read -r pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "Stopping process $pid..."
            kill "$pid" 2>/dev/null
        fi
    done < "$PID_FILE"
    rm "$PID_FILE"
fi

# Additional cleanup - kill any remaining processes by name
echo "Cleaning up any remaining processes..."

# Kill uvicorn processes
pkill -f "uvicorn api.main:app" 2>/dev/null

# Kill Stripe listener
pkill -f "stripe listen" 2>/dev/null

# Kill npm/node processes running on port 3000 (Next.js)
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Kill any processes on port 8000 (FastAPI)
lsof -ti:8000 | xargs kill -9 2>/dev/null

echo ""
echo "All services stopped!"
echo "Backend API: Stopped"
echo "Frontend:    Stopped"
echo "Stripe:      Stopped"
