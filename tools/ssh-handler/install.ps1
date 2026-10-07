# Registers ssh:// links to open in PuTTY for the current Windows user (no admin rights needed).
# Copies ssh-launch.ps1 to %LOCALAPPDATA%\NetMonitor and points HKCU\Software\Classes\ssh at it.

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'NetMonitor'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$launcher = Join-Path $installDir 'ssh-launch.ps1'
Copy-Item -Path (Join-Path $PSScriptRoot 'ssh-launch.ps1') -Destination $launcher -Force

$root = 'HKCU:\Software\Classes\ssh'
New-Item -Path "$root\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $root -Name '(default)' -Value 'URL:SSH Protocol'
Set-ItemProperty -Path $root -Name 'URL Protocol' -Value ''
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" `"%1`""
Set-ItemProperty -Path "$root\shell\open\command" -Name '(default)' -Value $command

Write-Host 'ssh:// links will now open in PuTTY.' -ForegroundColor Green
Write-Host "Launcher: $launcher"
