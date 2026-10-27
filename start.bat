@echo off
rem Start the PoGo Calendar server, then open http://localhost:8642/
rem Node: NODE_EXE if set (e.g. in start.local.bat, which is not published), otherwise node on PATH.
rem No browser: "start.bat nobrowser", or set NO_BROWSER=1 (e.g. in start.local.bat).
cd /d "%~dp0"
if exist start.local.bat call start.local.bat
if not defined NODE_EXE set "NODE_EXE=node"
if /i "%~1"=="nobrowser" set "NO_BROWSER=1"
if not defined NO_BROWSER start "" http://localhost:8642/
"%NODE_EXE%" server.js
pause
