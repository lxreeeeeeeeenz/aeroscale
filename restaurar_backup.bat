@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "ZIP=%~1"
if "%ZIP%"=="" (
  echo Arraste o arquivo aeroscale-backup-....zip para cima deste .bat
  echo ou rode:  restaurar_backup.bat "C:\caminho\aeroscale-backup.zip"
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  set "PY="
  where py >nul 2>nul && set "PY=py -3"
  if not defined PY ( where python >nul 2>nul && set "PY=python" )
  if not defined PY (
    echo [ERRO] Python nao encontrado. Instale o Python 3.10+ ^(marque "Add python.exe to PATH"^).
    pause
    exit /b 1
  )
  echo Preparando o ambiente pela primeira vez...
  %PY% -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  echo ok> ".venv\.deps_ok"
)
echo Restaurando "%ZIP%" ...
".venv\Scripts\python.exe" app.py --restore "%ZIP%"
if errorlevel 1 (
  echo [ERRO] A restauracao falhou. Seus dados atuais nao foram alterados se o arquivo era invalido.
) else (
  echo.
  echo Pronto. Abra o iniciar.bat para usar o AeroScale.
)
pause
