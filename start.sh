#!/usr/bin/env bash
# FocusGen Backend Server Launcher
echo "==================================================="
echo "  FocusGen - Eco-Adaptive AI Image Intelligence"
echo "  Starting Backend Server at http://localhost:3000"
echo "==================================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

# Try to open default browser
(sleep 2 && (xdg-open http://localhost:3000 || open http://localhost:3000 || sensible-browser http://localhost:3000) 2>/dev/null) &

# Run server
node --dns-result-order=ipv4first server.js
