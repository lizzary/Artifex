@echo off
setlocal enabledelayedexpansion

:: --- Detect Go ---
set "GO="
for /f "delims=" %%i in ('where go 2^>nul') do set "GO=%%i" & goto :go_found

:: Fallback: check common install paths
for %%d in (
    "C:\Go\bin\go.exe"
    "C:\Program Files\Go\bin\go.exe"
    "%USERPROFILE%\go\bin\go.exe"
) do (
    if exist %%d set "GO=%%~d" & goto :go_found
)

:: Fallback: search Go SDK directories
for /d %%d in ("%USERPROFILE%\sdk\go*") do (
    if exist "%%d\bin\go.exe" set "GO=%%d\bin\go.exe" & goto :go_found
)

:: Still not found — ask user
echo Go was not found in PATH or common locations.
set /p GO_INPUT="Enter full path to go.exe: "
if exist "!GO_INPUT!" (
    set "GO=!GO_INPUT!"
    goto :go_found
)
echo [ERROR] go.exe not found at the specified path.
exit /b 1

:go_found
echo [INFO] Using Go: %GO%
set "LDFLAGS=-s -w"
set "GOFLAGS="

if "%~1"=="" goto :noonx

if /I "%~1"=="build"     goto :build
if /I "%~1"=="full"      goto :build
if /I "%~1"=="noonx"     goto :noonx
if /I "%~1"=="build-noonx" goto :noonx
if /I "%~1"=="run"       goto :run
if /I "%~1"=="clean"     goto :clean
if /I "%~1"=="dist"      goto :dist
if /I "%~1"=="dist-full" goto :dist-full
if /I "%~1"=="help"      goto :help

echo [ERROR] Unknown target: %~1
goto :help

:: --------------------------------------------------
:: Full build with CGO + ONNX Runtime
:: --------------------------------------------------
:build
echo.
echo === Full build (CGO + ONNX Runtime) ===
echo Prerequisites: GCC (MinGW) + onnxruntime.dll
echo.
set CGO_ENABLED=1
"%GO%" build %GOFLAGS% -ldflags "%LDFLAGS%" -o artifex-server.exe .
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed. If you do not have GCC, try: build.bat noonx
    echo.
    exit /b 1
)
echo [OK] artifex-server.exe built.
goto :end

:: --------------------------------------------------
:: Pure Go build (no ONNX, portable)
:: --------------------------------------------------
:noonx
echo.
echo === Pure Go build (no ONNX, portable) ===
echo.
set CGO_ENABLED=0
"%GO%" build %GOFLAGS% -tags noonx -ldflags "%LDFLAGS%" -o artifex-server-noonx.exe .
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    exit /b 1
)
echo [OK] artifex-server-noonx.exe built.
goto :end

:: --------------------------------------------------
:: Dev server
:: --------------------------------------------------
:run
echo.
echo === Dev server (http://127.0.0.1:8000) ===
echo.
set CGO_ENABLED=0
"%GO%" run %GOFLAGS% -tags noonx . -host 127.0.0.1 -port 8000
goto :end

:: --------------------------------------------------
:: Clean build artifacts
:: --------------------------------------------------
:clean
echo.
echo === Cleaning ===
del /q artifex-server.exe 2>nul
del /q artifex-server-noonx.exe 2>nul
if exist dist rmdir /s /q dist 2>nul
echo [OK] Done.
goto :end

:: --------------------------------------------------
:: Distribution
:: --------------------------------------------------
:dist
call :noonx
if %ERRORLEVEL% neq 0 exit /b 1
if exist dist\Artifex rmdir /s /q dist\Artifex 2>nul
mkdir dist\Artifex\models\default 2>nul
mkdir dist\Artifex\models\user_model 2>nul
mkdir dist\Artifex\uploads 2>nul
copy /y artifex-server-noonx.exe dist\Artifex\Artifex.exe >nul
copy /y settings.json dist\Artifex\ >nul
echo [OK] Distribution prepared in dist\Artifex\
goto :end

:dist-full
call :noonx
if %ERRORLEVEL% neq 0 exit /b 1
if exist dist\Artifex rmdir /s /q dist\Artifex 2>nul
mkdir dist\Artifex\_internal\frontend 2>nul
mkdir dist\Artifex\models\default 2>nul
mkdir dist\Artifex\models\user_model 2>nul
mkdir dist\Artifex\uploads 2>nul
copy /y artifex-server-noonx.exe dist\Artifex\Artifex.exe >nul
copy /y settings.json dist\Artifex\ >nul
xcopy /e /y ..\frontend\build\* dist\Artifex\_internal\frontend\ >nul 2>nul
echo [OK] Full distribution prepared in dist\Artifex\
goto :end

:: --------------------------------------------------
:: Help
:: --------------------------------------------------
:help
echo.
echo   Usage:   build.bat [target]
echo.
echo   Targets:
echo     build       Full build with ONNX Runtime (needs GCC + onnxruntime.dll)
echo     noonx       Pure Go build, no ONNX, portable (default)
echo     run         Dev server at http://127.0.0.1:8000
echo     clean       Remove build artifacts
echo     dist        Create distribution directory
echo     dist-full   Create distribution with frontend included
echo     help        Show this help
echo.

:end
endlocal
