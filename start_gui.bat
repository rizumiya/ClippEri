@echo off
cd /d "%~dp0"
echo Starting ClippEri GUI...
echo --------------------------------
echo Server is starting, please wait...
echo Browser will open automatically at http://localhost:3000
echo.
node src/server.js
echo.
echo Server stopped.
pause
