# Removes the ssh:// -> PuTTY link handler installed by install.ps1.

Remove-Item -Path 'HKCU:\Software\Classes\ssh' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $env:LOCALAPPDATA 'NetMonitor\ssh-launch.ps1') -Force -ErrorAction SilentlyContinue
Write-Host 'ssh:// link handler removed.' -ForegroundColor Green
