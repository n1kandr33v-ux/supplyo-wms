@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0wb-print-agent.ps1"
echo.
pause
