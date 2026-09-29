@echo off
rem ============================================================
rem  ASCII-named entry point.
rem  Some terminals/tools mangle non-ASCII paths, so this file
rem  just forwards to the localized launcher next to it.
rem  Double-clicking Æô¶¯ZCode(´ø×´Ì¬À¸).cmd does the same thing.
rem
rem  Encoding: keep this file ANSI(GBK/936) without BOM, same as
rem  the localized launcher. Do not add chcp here either.
rem ============================================================
set "TLOG=%~dp0launch-timing.log"
>>"%TLOG%" echo   [cmd-fwd] %TIME%  forwarder: calling inner launcher next
call "%~dp0Æô¶¯ZCode(´ø×´Ì¬À¸).cmd" %*
>>"%TLOG%" echo   [cmd-fwd] %TIME%  forwarder: inner call returned errorlevel=%errorlevel%
exit /b %errorlevel%
