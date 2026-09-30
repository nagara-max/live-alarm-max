@echo off
rem Live目覚まし を PC（Windows）で使うための起動スクリプト
cd /d "%~dp0"
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1 || py -m http.server 8000 --bind 127.0.0.1
pause
