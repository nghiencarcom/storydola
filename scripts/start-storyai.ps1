$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function New-StoryAIKey {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
}

function Open-StoryAIConfig {
  Start-Process notepad.exe -ArgumentList (Join-Path $projectRoot ".env")
}

function Wait-StoryAIHealthy {
  $containerId = (& docker compose ps -q storyai | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) { return $false }
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $health = (& docker inspect --format '{{.State.Health.Status}}' $containerId | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return $false }
    if ($health -eq "healthy") { return $true }
    if ($health -eq "unhealthy") { return $false }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Restore-PreviousImage {
  param([string]$previousImage, [string]$imageRef)
  if ([string]::IsNullOrWhiteSpace($previousImage)) { return $false }
  & docker image tag $previousImage $imageRef
  if ($LASTEXITCODE -ne 0) { return $false }
  & docker compose up -d --pull never --force-recreate --remove-orphans
  if ($LASTEXITCODE -ne 0) { return $false }
  return (Wait-StoryAIHealthy)
}

$envPath = Join-Path $projectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot ".env.docker.example") -Destination $envPath
  $config = [IO.File]::ReadAllText($envPath)
  $config = $config.Replace("SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=GENERATE_ON_FIRST_START", "SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=$(New-StoryAIKey)")
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($envPath, $config, $utf8NoBom)
  if ($config.Contains("STORYAI_IMAGE=ghcr.io/OWNER/REPOSITORY:latest")) {
    Write-Host "Created .env and generated a local encryption key. Set STORYAI_IMAGE to your published image, save the file, then start StoryAI again."
    Open-StoryAIConfig
    exit 1
  }
}

$config = [IO.File]::ReadAllText($envPath)
$keyLine = [regex]::Match($config, "(?m)^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=(.*)$")
if (-not $keyLine.Success -or [string]::IsNullOrWhiteSpace($keyLine.Groups[1].Value) -or $keyLine.Groups[1].Value -eq "GENERATE_ON_FIRST_START") {
  $generatedKey = "SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=$(New-StoryAIKey)"
  if ($keyLine.Success) {
    $config = [regex]::Replace($config, "(?m)^SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=.*$", $generatedKey)
  } else {
    $config = $config.TrimEnd() + "`r`n$generatedKey`r`n"
  }
}
if ($config -notmatch "(?m)^STORYAI_IMAGE=") {
  $imageLine = [regex]::Match([IO.File]::ReadAllText((Join-Path $projectRoot ".env.docker.example")), "(?m)^STORYAI_IMAGE=.*$").Value
  $config = $config.TrimEnd() + "`r`n$imageLine`r`n"
}
$config = [regex]::Replace($config, "(?m)^STORYAI_UID=.*$", "STORYAI_UID=1000")
$config = [regex]::Replace($config, "(?m)^STORYAI_GID=.*$", "STORYAI_GID=1000")
if ($config -notmatch "(?m)^STORYAI_UID=") { $config = $config.TrimEnd() + "`r`nSTORYAI_UID=1000`r`n" }
if ($config -notmatch "(?m)^STORYAI_GID=") { $config = $config.TrimEnd() + "`r`nSTORYAI_GID=1000`r`n" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($envPath, $config, $utf8NoBom)
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot "data") | Out-Null

if ($config.Contains("STORYAI_IMAGE=ghcr.io/OWNER/REPOSITORY:latest")) {
  Write-Host "Set STORYAI_IMAGE in .env to the registry image published for your installation."
  Open-StoryAIConfig
  exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker is required. Install Docker Desktop, then run this launcher again."
  exit 1
}

& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker Compose v2 is required. Update Docker Desktop and try again."
  exit 1
}

Write-Host "Checking for StoryAI updates..."
$previousImage = (& docker compose images -q storyai | Select-Object -First 1)
$previousImage = if ($null -eq $previousImage) { "" } else { $previousImage.Trim() }
$imageMatch = [regex]::Match($config, "(?m)^STORYAI_IMAGE=(.*)$")
$imageRef = if ($imageMatch.Success) { $imageMatch.Groups[1].Value.Trim() } else { "" }
& docker compose pull
if ($LASTEXITCODE -eq 0) {
  & docker compose up -d --remove-orphans
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "The new version failed to start. Restoring the previous version..."
    if (-not (Restore-PreviousImage $previousImage $imageRef)) {
      & docker compose logs --tail=80 storyai
      exit 1
    }
  }
} else {
  Write-Warning "Update download failed; trying the last installed version."
  & docker compose up -d --pull never --remove-orphans
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Wait-StoryAIHealthy)) {
  if (-not (Restore-PreviousImage $previousImage $imageRef)) {
    & docker compose logs --tail=80 storyai
    Write-Host "StoryAI did not become healthy. Data in .\data was preserved."
    exit 1
  }
}

$port = 3011
if ($config -match "(?m)^STORYAI_PORT=(\d+)$") { $port = [int]$Matches[1] }
$storyaiUrl = "http://localhost:$port"
Write-Host "StoryAI is starting at $storyaiUrl"
Start-Process $storyaiUrl
