@echo off
rem Start Keystone backend in a separate process group so it is NOT
rem reclaimed when the calling session ends.
rem Backend port: 8090 (port 8080 is taken by the local VPN client NtlsUIDlg.exe)

cd /d "%~dp0"

set "SERVER_PORT=8090"
set "SERVER_ADDRESS=127.0.0.1"
set "JWT_SECRET=keystone_dev_secret_key_2026_at_least_32_bytes_ok"
set "DB_HOST=127.0.0.1"
set "DB_PORT=3306"
set "DB_NAME=keystone_system"
set "DB_USERNAME=root"
set "DB_PASSWORD=wqy123456"
set "DB_TIMEZONE=+08:00"
set "REDIS_HOST=127.0.0.1"
set "REDIS_PORT=6379"
set "REDIS_PASSWORD=ruoyi123"

rem SERVER__PORT may be injected by the environment and hijack the port
set "SERVER__PORT="

if not exist "keystone-admin\target\keystone-admin-0.1.0-SNAPSHOT.jar" (
  echo [ERROR] jar not found. Run first: mvn -pl keystone-admin -am package -DskipTests
  pause
  exit /b 1
)

if not exist "logs" mkdir "logs"

echo Starting Keystone backend on http://127.0.0.1:8090/api ...
start "Keystone Backend" cmd /k "java -jar keystone-admin\target\keystone-admin-0.1.0-SNAPSHOT.jar"

echo.
echo Backend started in its own window. Close that window to stop it.
echo Logs: keystone-system\logs\  (or just read the new window)
echo.