@echo off
setlocal enabledelayedexpansion
title ZCode 状态栏启动器

rem ============================================================
rem  本文件有两种被调用的方式：
rem    (1) 直接双击 / 命令行运行 -> 显示进度窗口，8 秒后自动关闭
rem    (2) start-zcode-silent.vbs 用 --hidden 参数调用 -> 全程无窗口
rem  静默模式下不 pause、不倒数，改用退出码告诉调用方出了什么事：
rem    0 = 成功
rem    1 = 缺 node，或缺 ZCode.exe
rem    3 = ZCode 正在运行但没开调试端口，需要你先做决定（此刻尚未做任何改动）
rem    4 = 调试端口 40 秒内没就绪
rem
rem  编码注意：本文件必须存成 ANSI(GBK/936)、不带 BOM，且不要在里面写 chcp。
rem  存成 UTF-8（带不带 BOM 都一样）时 cmd.exe 会把中文行切错，报出一堆
rem  "is not recognized as an internal or external command"。
rem ============================================================

set "DIR=%~dp0"
set "PORT=9222"
set "NODE=node"
set "ZCODE="
set "HIDDEN="
set "SOFTFAIL="
if /I "%~1"=="--hidden" set "HIDDEN=1"
set "TLOG=%~dp0launch-timing.log"
for /f "tokens=1-4 delims=:.," %%a in ("!TIME!") do set /a "TBASE=((1%%a-100)*3600+(1%%b-100)*60+(1%%c-100))*1000+((1%%d-100)*10)"
if not defined TBASE set "TBASE=0"
call :STAMP cmd-entry

echo.
echo   ZCode 底部数据统计条 —— 启动器
echo   ================================================
echo.

rem ---------- 1. 找 Node ----------
call :STAMP where-node
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] 找不到 node。请先安装 Node.js 22 或更高版本。
  echo       下载: https://nodejs.org/
  echo.
call :STAMP exit-1-no-node
  if defined HIDDEN exit /b 1
  pause
call :STAMP exit-1-no-node-pause
  exit /b 1
)
call :STAMP node-version-probe-START
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
call :STAMP node-version-probe-DONE
echo   [1/4] Node !NODEV!  OK

rem ---------- 2. 找 ZCode.exe ----------
for %%P in (
  "E:\新建文件夹\ZCode\ZCode.exe"
  "E:\ZCode\ZCode.exe"
  "D:\ZCode\ZCode.exe"
  "%LOCALAPPDATA%\Programs\ZCode\ZCode.exe"
  "%ProgramFiles%\ZCode\ZCode.exe"
  "%ProgramFiles(x86)%\ZCode\ZCode.exe"
) do (
  if not defined ZCODE if exist %%P set "ZCODE=%%~P"
)
if not defined ZCODE (
  echo   [X] 找不到 ZCode.exe。
  echo       请用记事本打开本文件，把 ZCode.exe 的完整路径填到上面的列表里。
  echo.
call :STAMP exit-1-no-zcode
  if defined HIDDEN exit /b 1
  pause
call :STAMP exit-1-no-zcode-pause
  exit /b 1
)
echo   [2/4] ZCode: "!ZCODE!"

rem ---------- 3. ZCode 是否已在运行 ----------
set "RUNNING="
call :STAMP running-check-START
tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | findstr /I "ZCode.exe" >nul
if not errorlevel 1 set "RUNNING=1"

call :STAMP running-check-DONE-running=!RUNNING!
if defined RUNNING (
  rem 已经在运行 —— 看看它是否已经开了调试端口
call :STAMP running-port-probe-START
  node -e "fetch('http://127.0.0.1:%PORT%/json/version').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>nul
  if not errorlevel 1 (
call :STAMP branch-running-port-UP-attach
    echo   [3/4] ZCode 已在运行且已开调试端口 —— 直接挂接
  ) else (
call :STAMP branch-running-port-DOWN-need-restart
    echo   [3/4] ZCode 正在运行，但没有开调试端口。
    echo.
    echo         调试端口只能在启动时开启，所以必须先完全退出 ZCode。
    echo         注意：ZCode 设置了关闭时最小化到托盘，普通关闭不会退出进程。
    echo.
    echo         未保存的对话内容可能丢失，请先确认 ZCode 里没有正在进行的任务。
    echo.
    rem 这一问必须由人回答；静默模式下交回给调用方去弹出可见窗口
    if defined HIDDEN exit /b 3
    choice /C YN /N /M "         现在强制关闭并重启 ZCode 吗？[Y=是 /N=否] "
    echo.
    if errorlevel 2 (
      echo         已取消。请手动退出 ZCode 后重新运行本脚本。
      echo.
      pause
call :STAMP exit-0-user-cancelled
      exit /b 0
    )
    echo         正在关闭 ZCode ...
    taskkill /IM ZCode.exe /F >nul 2>nul
    rem 等领域锁释放
    for /l %%i in (1,1,20) do (
call :STAMP restart-wait-iter
      tasklist /FI "IMAGENAME eq ZCode.exe" 2>nul | findstr /I "ZCode.exe" >nul
      if errorlevel 1 goto :ZCODE_DEAD
      ping -n 1 -w 300 127.0.0.1 >nul
    )
    :ZCODE_DEAD
    echo         ZCode 已退出。
  )
)

rem ---------- 4. 启动 / 挂接 ----------
if defined RUNNING (
call :STAMP launch-port-probe-START
  node -e "fetch('http://127.0.0.1:%PORT%/json/version').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>nul
  if errorlevel 1 (
call :STAMP branch-launch-port-DOWN-will-start
    echo   [4/4] 启动 ZCode（带 --remote-debugging-port=%PORT%）...
    start "" "!ZCODE!" --remote-debugging-port=%PORT%
  ) else (
call :STAMP branch-launch-port-UP-skip-start
    echo   [4/4] 跳过启动
  )
) else (
  echo   [4/4] 启动 ZCode（带 --remote-debugging-port=%PORT%）...
  start "" "!ZCODE!" --remote-debugging-port=%PORT%
)

rem 等调试端口就绪（最多约 40 秒）
set "READY="
call :STAMP port-wait-loop-ENTER
for /l %%i in (1,1,80) do (
call :STAMP port-wait-iter-%%i-of-80
  node -e "fetch('http://127.0.0.1:%PORT%/json/version').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>nul
  if not errorlevel 1 (
call :STAMP port-wait-iter-%%i-UP-ready
    set "READY=1"
    goto :PORT_OK
  )
  ping -n 1 -w 400 127.0.0.1 >nul
)
:PORT_OK
call :STAMP port-wait-loop-EXIT

echo.
if defined READY (
  echo   调试端口 127.0.0.1:%PORT% 已就绪。
) else (
  echo   [!] 端口尚未就绪，注入器会继续等待。
  echo       ZCode 首次启动较慢属正常现象。
  set "SOFTFAIL=1"
)

echo   正在后台启动注入器 ...
call :STAMP injector-locked-probe-START
node "%DIR%zcode-statusbar.mjs" --locked >nul 2>nul
if not errorlevel 1 (
call :STAMP injector-alive-skip-start
  echo   [i] 检测到注入器已在运行 —— 跳过，不会重复启动。
) else (
call :STAMP injector-dead-will-start
call :STAMP daemon-start
  start "ZCode 状态栏" /min /d "%DIR%" cmd /c ""%NODE%" "zcode-statusbar.mjs" > "statusbar.log" 2>&1"
)

echo.
echo   ================================================
echo    完成。统计条会在 ZCode 窗口右下角出现。
echo.
echo    日志   : "%DIR%statusbar.log"
echo    自检   : node "%DIR%zcode-statusbar.mjs" --print
echo    停止   : 关闭那个最小化的 "ZCode 状态栏" 窗口即可
echo   ================================================
echo.

rem 静默模式：不倒数、不等 8 秒，用退出码回报
if defined HIDDEN (
call :STAMP exit-4-softfail
  if defined SOFTFAIL exit /b 4
call :STAMP exit-0-hidden-ok
  exit /b 0
)

echo   本窗口 8 秒后自动关闭 ...
ping -n 9 -w 1000 127.0.0.1 >nul
call :STAMP exit-0-visible-ok
endlocal
exit /b 0
rem ---------- timing (additive, no behavior change) ----------
:STAMP
set "TAG=%~1"
for /f "tokens=1-4 delims=:.," %%a in ("!TIME!") do set /a "TNOW=((1%%a-100)*3600+(1%%b-100)*60+(1%%c-100))*1000+((1%%d-100)*10)"
set /a "TEL=TNOW-TBASE"
if !TEL! lss 0 set /a "TEL=TEL+86400000"
>>"%TLOG%" echo   [cmd] !TIME!  +!TEL!ms  !TAG!
goto :eof
