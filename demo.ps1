param([int]$Port=8021,[switch]$Offline,[switch]$NewSession,[switch]$SkipInstall,[string]$PythonIndex='',[string]$NpmRegistry='')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if(-not $SkipInstall){
 if(-not(Get-Command uv -ErrorAction SilentlyContinue)){throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/'}
 if(-not(Get-Command npm.cmd -ErrorAction SilentlyContinue)){throw 'Install Node.js with npm (Vite requires Node >=22.12, or a supported newer version).'}
 if($PythonIndex){
  New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'tmp') -Force | Out-Null
  & uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file tmp/demo-runtime-requirements.txt > $null
  if($LASTEXITCODE -ne 0){throw 'Locked dependency export failed'}
  $installPython=Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
  if(-not(Test-Path -LiteralPath $installPython)){
   & uv venv --python 3.12 .venv
   if($LASTEXITCODE -ne 0){throw 'Python environment creation failed'}
  }
  & uv pip install --python $installPython --require-hashes --index-url $PythonIndex -r tmp/demo-runtime-requirements.txt
  if($LASTEXITCODE -ne 0){throw 'Mirrored locked dependency installation failed'}
  & uv pip install --python $installPython --index-url $PythonIndex --no-deps --editable .
  if($LASTEXITCODE -ne 0){throw 'Local application installation failed'}
 }else{
  & uv sync --frozen
  if($LASTEXITCODE -ne 0){throw 'Python dependency installation failed; retry with -PythonIndex https://mirrors.aliyun.com/pypi/simple'}
 }
 if($NpmRegistry){
  & npm.cmd --prefix frontend ci --registry $NpmRegistry
 }else{
  & npm.cmd --prefix frontend ci
 }
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
