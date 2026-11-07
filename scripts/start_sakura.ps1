param([string]$FrpcPath = '', [string]$TunnelId = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'var\frp'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$names = @('NATFRP_TOKEN','NATFRP_TARGET','NATFRP_HOSTS','WUJIAN_FRPC_PATH','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $localEnv = Join-Path $root '.env'
    if (Test-Path -LiteralPath $localEnv) {
        foreach ($line in Get-Content -LiteralPath $localEnv -Encoding UTF8) {
            if ($line -match '^\s*(NATFRP_TOKEN|NATFRP_TARGET|NATFRP_HOSTS|WUJIAN_FRPC_PATH)\s*=\s*(.*)\s*$') {
                $name, $value = $Matches[1], $Matches[2].Trim().Trim('"').Trim("'")
                [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            }
        }
    }
    if ($TunnelId) { $env:NATFRP_TARGET = $TunnelId }
    if (-not $env:NATFRP_TOKEN -or -not $env:NATFRP_TARGET) { throw 'Set NATFRP_TOKEN and NATFRP_TARGET in the local .env first.' }
    if (-not $FrpcPath) { $FrpcPath = $env:WUJIAN_FRPC_PATH }
    if (-not $FrpcPath) { $FrpcPath = Join-Path $runtime 'frpc.exe' }
    $FrpcPath = (Get-Item -LiteralPath $FrpcPath -ErrorAction Stop).FullName
    $version = & $FrpcPath -V
    if ($LASTEXITCODE -ne 0 -or $version -notmatch 'sakura') { throw 'Use the official Sakura frpc client.' }
    $pidFile = Join-Path $runtime 'frpc.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $running = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile -Raw)) -ErrorAction SilentlyContinue
        if ($running -and $running.Path -eq $FrpcPath) { Write-Output 'Sakura tunnel is already running.'; return }
    }
    foreach ($name in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    $env:NO_PROXY = '*'
    $arguments = @('--disable_log_color','--no_check_update','--proxy','none')
    if ($env:NATFRP_HOSTS) { $arguments += @('--hosts',$env:NATFRP_HOSTS) }
    $process = Start-Process -FilePath $FrpcPath -ArgumentList $arguments -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'stdout.log') -RedirectStandardError (Join-Path $runtime 'stderr.log') -PassThru
    @{pid=$process.Id; executable=$FrpcPath} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'process.json') -Encoding UTF8
    [string]$process.Id | Set-Content -LiteralPath $pidFile -Encoding ASCII
    Write-Output "Sakura direct tunnel started. Logs: $runtime"
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
