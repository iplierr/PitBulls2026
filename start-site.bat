@echo off
rem Double-click to open the Flugtag Lab live preview at http://localhost:8080
rem Keep this window open while you work (the page refreshes itself when you save a file). Close it to stop.
cd /d "%~dp0"
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080'"
node server.js
pause
