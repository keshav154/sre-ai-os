@echo off
echo ===================================================
echo             Starting SRE AI OS
echo ===================================================

echo [1/2] Checking and Starting FastAPI Backend...
cd backend
if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
    echo Installing backend dependencies...
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
)
start "SRE AI OS Backend" cmd /k ".\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"
cd ..

echo [2/2] Checking and Starting Next.js Frontend...
cd frontend
if not exist "node_modules\" (
    echo Installing frontend dependencies...
    npm install
)
start "SRE AI OS Frontend" cmd /k "npm run dev"
cd ..

echo.
echo Both services are starting up in separate terminal windows!
echo - Frontend will be available at: http://localhost:3000
echo - Backend API will be available at: http://localhost:8000
echo.
echo Press any key to close this launcher window...
pause >nul
