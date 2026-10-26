@echo off
rem Stop the PoGo Calendar server: ends the process listening on PORT (default 8642).
if not defined PORT set "PORT=8642"
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  set "FOUND=1"
  taskkill /pid %%p /f >nul && echo PoGo Calendar server stopped ^(process %%p on port %PORT%^).
)
if not defined FOUND echo No server is running on port %PORT%.
timeout /t 3 >nul
