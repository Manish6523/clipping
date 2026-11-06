@echo off
title AutoClipDaemon Runner
echo ============================================================
echo         Starting AutoClipDaemon Clipping Engine
echo ============================================================
cd /d "%~dp0"

if exist "venv\Scripts\python.exe" (
    echo [OK] Using virtual environment: .\venv
    set "PYTHON_EXE=venv\Scripts\python.exe"
) else (
    echo [WARN] Virtual environment not found, falling back to system python.
    set "PYTHON_EXE=python"
)

echo [OK] Running pre-flight system diagnostics...
"%PYTHON_EXE%" scripts\healthcheck.py
if %ERRORLEVEL% neq 0 (
    echo [WARN] Healthcheck reported issues. Starting daemon anyway...
)

echo [OK] Launching AutoClipDaemon...
echo Web UI: http://localhost:8080
"%PYTHON_EXE%" main.py
pause

