@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist data\model.json call npm run bootstrap
start "" http://localhost:8787
call npm start
pause
