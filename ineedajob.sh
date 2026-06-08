#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Starting ineedajob.pro..."

# 1. Backend
echo "Starting backend API on :8000..."
cd "$SCRIPT_DIR"
uvicorn api.main:app --reload &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

sleep 2

# 2. Frontend
echo "Starting frontend on :3000..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo "$BACKEND_PID" > "$SCRIPT_DIR/.pids"
echo "$FRONTEND_PID" >> "$SCRIPT_DIR/.pids"

echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop."

cleanup() {
    echo "Stopping services..."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    rm -f "$SCRIPT_DIR/.pids"
    exit 0
}
trap cleanup INT TERM

wait
