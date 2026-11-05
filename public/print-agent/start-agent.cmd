@echo off
cd /d "%~dp0"
if not exist "%~dp0wb-print-agent.ps1" (
 echo Extract ALL files from the ZIP archive into a folder first.
 echo Do not run start-agent.cmd directly inside WinRAR.
 pause
 exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0wb-print-agent.ps1"
echo.
pause

