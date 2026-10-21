@echo off
rem Start the PoGo Calendar server, then open http://localhost:8642/
rem Node: NODE_EXE if set (e.g. in start.local.bat, which is not published), otherwise node on PATH.
cd /d "%~dp0"
if exist start.local.bat call start.local.bat
if not defined NODE_EXE set "NODE_EXE=node"
start "" http://localhost:8642/
"%NODE_EXE%" server.js
pause
