@echo off
setlocal
chcp 65001 >nul
title AeroScale
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo  [ERRO] Python nao encontrado.
  echo  Instale o Python 3.10+ em https://www.python.org/downloads/
  echo  e marque "Add python.exe to PATH" durante a instalacao.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando ambiente virtual...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel criar o ambiente virtual.
    pause
    exit /b 1
  )
)

if not exist ".venv\.deps_ok" (
  echo Instalando dependencias...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias. Verifique a conexao com a internet.
    pause
    exit /b 1
  )
  echo ok> ".venv\.deps_ok"
)

".venv\Scripts\python.exe" app.py
if errorlevel 1 pause
