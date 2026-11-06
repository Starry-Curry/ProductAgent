param([int]$Port=8021,[switch]$Offline,[switch]$NewSession,[switch]$SkipInstall)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if(-not $SkipInstall){
 if(-not(Get-Command uv -ErrorAction SilentlyContinue)){throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/'}
 if(-not(Get-Command npm.cmd -ErrorAction SilentlyContinue)){throw 'Install Node.js with npm (Vite requires Node >=22.12, or a supported newer version).'}
 & uv sync --frozen
 if($LASTEXITCODE -ne 0){throw 'Python dependency installation failed'}
 & npm.cmd --prefix frontend ci
 if($LASTEXITCODE -ne 0){throw 'Frontend dependency installation failed'}
 & npm.cmd --prefix frontend run build
 if($LASTEXITCODE -ne 0){throw 'Frontend build failed'}
}
$demoPython=Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if(-not(Test-Path -LiteralPath $demoPython)){throw 'Python environment missing; run without -SkipInstall'}
$demoArguments=@('scripts/run_as2_demo.py','--port',"$Port")
if($Offline){$demoArguments+='--offline'}
if($NewSession){$demoArguments+='--new-session'}
& $demoPython @demoArguments
exit $LASTEXITCODE
