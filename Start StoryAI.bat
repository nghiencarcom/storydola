@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-storyai.ps1"
if errorlevel 1 pause
