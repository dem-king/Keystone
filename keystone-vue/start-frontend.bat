@echo off
rem Start Keystone frontend dev server in a separate process group so it is NOT
rem reclaimed when the calling session ends.
rem Frontend port: 5180 (5173 is taken by another local project)

cd /d "%~dp0"

if not exist "node_modules" (
  echo [ERROR] node_modules not found. Run first: npm ci
  echo         then: npm i @rollup/rollup-win32-x64-msvc
  echo         and:  npm i @esbuild/win32-x64
  pause
  exit /b 1
)

set "VITE_API_PROXY_TARGET=http://127.0.0.1:8090"
set "VITE_PORT=5180"

echo Starting Keystone frontend on http://localhost:5180 ...
start "Keystone Frontend" cmd /k "node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5180 --strictPort"

echo.
echo Frontend started in its own window. Close that window to stop it.
echo.