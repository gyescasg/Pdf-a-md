@echo off
rem Inicia la interfaz web local de pdf-a-md y abre el navegador.
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
    echo No se encontro "uv". Instala uv desde https://docs.astral.sh/uv/ y vuelve a intentarlo.
    pause
    exit /b 1
)
uv run pdf-a-md-web
if errorlevel 1 pause
