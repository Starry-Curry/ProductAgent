$ErrorActionPreference = 'Stop'
$runtime = Join-Path (Split-Path -Parent $PSScriptRoot) 'var\frp'
$stateFile = Join-Path $runtime 'process.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No Sakura tunnel was started here.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if ($process) {
    if ($process.Path -ne $state.executable) { throw 'PID belongs to another program; refusing to stop it.' }
    Stop-Process -Id $state.pid -ErrorAction Stop
}
Remove-Item -LiteralPath $stateFile
Remove-Item -LiteralPath (Join-Path $runtime 'frpc.pid') -ErrorAction SilentlyContinue
Write-Output 'Sakura tunnel stopped; the local application is unchanged.'
