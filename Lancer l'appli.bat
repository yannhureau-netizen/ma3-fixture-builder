@echo off
rem Double-clic : lance le serveur local et ouvre l'appli dans le navigateur.
rem Pour arreter : fermer cette fenetre (ou Ctrl+C).
title MA3 Fixture Builder - serveur local
cd /d "%~dp0"

rem Si le serveur tourne deja (autre fenetre), on ouvre juste le navigateur.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo Le serveur tourne deja : ouverture du navigateur.
  start "" http://localhost:8090
  timeout /t 3 >nul
  exit /b
)

echo Laisse cette fenetre ouverte tant que tu utilises l'appli.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1" -Open
echo.
echo Le serveur s'est arrete.
pause
