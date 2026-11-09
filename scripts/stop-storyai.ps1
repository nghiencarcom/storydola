$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& docker compose down
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "StoryAI stopped. Local data volume was kept."
