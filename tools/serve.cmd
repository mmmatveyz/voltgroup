@echo off
echo Starting VoltGroup local HTTP server on http://localhost:8000 ...
cd /d "%~dp0\.."
python -m http.server 8000
