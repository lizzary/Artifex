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

:: Still not found - ask user
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

echo.
echo === Full build (CGO + ONNX Runtime) ===
echo Prerequisites: GCC (MinGW) + onnxruntime.dll
echo.
set CGO_ENABLED=1
"%GO%" build -ldflags "-s -w" -o artifex-server.exe .
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed. Make sure GCC (MinGW) is installed and onnxruntime.dll is available.
    echo.
    exit /b 1
)
echo [OK] artifex-server.exe built.

endlocal
