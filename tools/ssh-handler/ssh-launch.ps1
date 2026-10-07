# Opens an ssh:// link in PuTTY. Registered as the Windows handler for ssh:// by install.ps1.
#   ssh://10.10.0.1            -> putty -ssh 10.10.0.1
#   ssh://admin@10.10.0.1:2222 -> putty -ssh admin@10.10.0.1 -P 2222
# The link comes from a web page, so it is validated strictly and only ever passed to PuTTY as
# arguments, never run as code.
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [switch]$DryRun
)

$m = [regex]::Match($Url, '^ssh://(?:([A-Za-z0-9._-]{1,64})@)?([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?/?$')
if (-not $m.Success) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Not a valid SSH link:`n$Url", 'NetMonitor SSH') | Out-Null
    exit 1
}

$user = $m.Groups[1].Value
$sshHost = $m.Groups[2].Value
$port = $m.Groups[3].Value

$target = if ($user) { "$user@$sshHost" } else { $sshHost }
$puttyArgs = @('-ssh', $target)
if ($port) { $puttyArgs += @('-P', $port) }

if ($DryRun) {
    Write-Output ($puttyArgs -join ' ')
    exit 0
}

$putty = @(
    "$env:ProgramFiles\PuTTY\putty.exe",
    "${env:ProgramFiles(x86)}\PuTTY\putty.exe",
    (Get-Command putty.exe -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $putty) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('PuTTY was not found. Install it from https://www.putty.org', 'NetMonitor SSH') | Out-Null
    exit 1
}

Start-Process -FilePath $putty -ArgumentList $puttyArgs
