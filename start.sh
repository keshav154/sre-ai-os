#!/bin/bash

echo "==================================================="
echo "             Starting SRE AI OS"
echo "==================================================="

# Function to clean up child processes on exit
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

# Trap Ctrl+C (SIGINT) and SIGTERM
trap cleanup SIGINT SIGTERM

echo "[1/2] Checking and Starting FastAPI Backend on port 8000..."
cd backend
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
    echo "Installing backend dependencies..."
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi
python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

echo "[2/2] Checking and Starting Next.js Frontend on port 3000..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "Both services are starting up!"
echo "- Frontend will be available at: http://localhost:3000"
echo "- Backend API will be available at: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop both services."

# Wait for background processes to keep script running
wait
