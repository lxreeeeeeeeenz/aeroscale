@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Rode o iniciar.bat uma vez antes de fazer backup.
  pause
  exit /b 1
)
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESK=%%i"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"`) do set "TS=%%i"
set "OUT=%DESK%\aeroscale-backup-%TS%.zip"
".venv\Scripts\python.exe" app.py --backup "%OUT%"
if errorlevel 1 (
  echo [ERRO] Falha ao gerar o backup.
) else (
  echo.
  echo Backup salvo na Area de Trabalho: %OUT%
  echo Guarde este arquivo antes de formatar o Windows.
)
pause
