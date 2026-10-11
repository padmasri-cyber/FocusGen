@echo off
title FocusGen Backend Server
echo ===================================================
echo   FocusGen - Eco-Adaptive AI Image Intelligence
echo   Starting Backend Server at http://localhost:3000
echo ===================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed or not in PATH!
  echo Please install Node.js from https://nodejs.org
  pause
  exit /b 1
)

:: Open browser after 2 seconds in background
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Start the server
echo Starting server with IPv4 resolution...
node --dns-result-order=ipv4first server.js
pause
