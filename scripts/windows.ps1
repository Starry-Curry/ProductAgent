param([ValidateSet('start','dev','test','typecheck','benchmark','build')][string]$Task='start')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeCandidates=@((Join-Path $projectRoot '.runtime\node24\node.exe'))
$systemNode=Get-Command node.exe -ErrorAction SilentlyContinue
if($systemNode){$nodeCandidates+= $systemNode.Source}
$taskNodeExe=$null
foreach($candidate in $nodeCandidates){
    if(Test-Path -LiteralPath $candidate){
        $version=& $candidate --version
        if($LASTEXITCODE -eq 0 -and $version -match '^v24\.'){$taskNodeExe=$candidate;break}
    }
}
if(-not $taskNodeExe){throw 'Node.js 24 is required. Install Node 24 or place it in .runtime\node24.'}
if(-not(Test-Path -LiteralPath 'node_modules\next\dist\bin\next')){throw 'Dependencies are missing. Run npm ci using Node.js 24 first.'}
$tempPath=Join-Path $projectRoot '.runtime\tmp'
New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
$env:TEMP=$tempPath
$env:TMP=$tempPath
$env:NEXT_TELEMETRY_DISABLED='1'
if($Task -in @('start','dev')){
    if($Task -eq 'start' -and -not(Test-Path -LiteralPath '.next\BUILD_ID')){
        & $taskNodeExe node_modules/next/dist/bin/next build
        if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    }
    & $taskNodeExe scripts/local-demo.mjs $Task
}elseif($Task -eq 'test'){
    $testFiles=@(Get-ChildItem -LiteralPath tests -Filter '*.test.ts' -File | ForEach-Object {$_.FullName})
    & $taskNodeExe --experimental-strip-types --test @testFiles
}elseif($Task -eq 'typecheck'){
    & $taskNodeExe node_modules/typescript/bin/tsc --noEmit
}elseif($Task -eq 'benchmark'){
    & $taskNodeExe --experimental-strip-types scripts/benchmark.ts
}else{
    & $taskNodeExe node_modules/next/dist/bin/next build
}
exit $LASTEXITCODE
