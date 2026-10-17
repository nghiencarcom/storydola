$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$gatewayDir = Join-Path $rootDir "dola-studio\dola-render-gateway"
$cacheDir = Join-Path $rootDir ".npm-cache"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Cần cài Node.js 20.9+ và npm trước."
}

$nodeVersionOutput = (& node --version 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionOutput -notmatch '^v?(\d+)\.(\d+)\.(\d+)') {
  throw "Không đọc được phiên bản Node.js. Hãy cài Node.js 20.9+ rồi mở PowerShell mới."
}
$nodeMajor = [int]$Matches[1]
$nodeMinor = [int]$Matches[2]
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 9)) {
  throw "Node.js hiện tại là $nodeVersionOutput; dự án cần Node.js 20.9 trở lên."
}

$npmVersionOutput = (& npm --version 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $npmVersionOutput -notmatch '^\d+\.\d+\.\d+') {
  throw "Không chạy được npm. Hãy cài lại Node.js LTS có kèm npm rồi mở PowerShell mới."
}
Write-Host "Node.js $nodeVersionOutput / npm $npmVersionOutput" -ForegroundColor DarkGray

$pythonCommand = $null
$pythonPrefix = @()
foreach ($version in @("3.14", "3.13", "3.12", "3.11")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $probeExitCode = 1
    try {
      & py "-$version" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
      $probeExitCode = $LASTEXITCODE
    } catch { }
    if ($probeExitCode -eq 0) {
      $pythonCommand = "py"
      $pythonPrefix = @("-$version")
      break
    }
  }
}
if (-not $pythonCommand -and (Get-Command python -ErrorAction SilentlyContinue)) {
  $probeExitCode = 1
  try {
    & python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
    $probeExitCode = $LASTEXITCODE
  } catch { }
  if ($probeExitCode -eq 0) { $pythonCommand = "python" }
}
if (-not $pythonCommand) {
  throw "Cần cài Python 3.11+ (https://www.python.org/downloads/windows/) rồi chạy lại npm run setup:local."
}

Write-Host "Cài dependency Node.js..." -ForegroundColor Cyan
Push-Location $rootDir
try {
  npm ci --cache $cacheDir
  if ($LASTEXITCODE -ne 0) { throw "npm ci ở thư mục gốc thất bại." }
  npm ci --prefix (Join-Path $rootDir "dola-studio") --cache $cacheDir
  if ($LASTEXITCODE -ne 0) { throw "npm ci trong dola-studio thất bại." }

  $venvDir = Join-Path $gatewayDir ".venv"
  $venvPython = Join-Path $venvDir "Scripts\python.exe"
  if (-not (Test-Path $venvPython)) {
    & $pythonCommand @pythonPrefix -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "Không thể tạo môi trường Python của Gateway." }
  }

  Write-Host "Cài dependency Python..." -ForegroundColor Cyan
  & $venvPython -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw "Không thể cập nhật pip." }
  & $venvPython -m pip install -r (Join-Path $gatewayDir "requirements.txt")
  if ($LASTEXITCODE -ne 0) { throw "Không thể cài dependency Python của Gateway." }

  $bundledChromium = Join-Path $gatewayDir "browsers\chromium-1243\chrome-win64\chrome.exe"
  $bundledMarker = Join-Path $gatewayDir "browsers\chromium-1243\INSTALLATION_COMPLETE"
  if ((Test-Path -LiteralPath $bundledChromium -PathType Leaf) -and (Test-Path -LiteralPath $bundledMarker -PathType Leaf)) {
    Write-Host "Dùng Chromium Windows x64 đi kèm workspace; bỏ qua tải browser riêng." -ForegroundColor Green
  } else {
    Write-Host "Workspace không có Chromium đi kèm; tải browser cho Patchright..." -ForegroundColor Cyan
    $browserDir = Join-Path $gatewayDir "browsers"
    New-Item -ItemType Directory -Force -Path $browserDir | Out-Null
    $previousBrowserPath = $env:PLAYWRIGHT_BROWSERS_PATH
    try {
      $env:PLAYWRIGHT_BROWSERS_PATH = $browserDir
      & $venvPython -m patchright install chromium
      if ($LASTEXITCODE -ne 0) { throw "Không thể cài Chromium cho Patchright." }
    } finally {
      if ($null -eq $previousBrowserPath) {
        Remove-Item Env:PLAYWRIGHT_BROWSERS_PATH -ErrorAction SilentlyContinue
      } else {
        $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowserPath
      }
    }
  }

  node (Join-Path $rootDir "scripts\prepare-local-config.cjs")
  if ($LASTEXITCODE -ne 0) { throw "Không thể tạo cấu hình local." }
} finally {
  Pop-Location
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Warning "Chưa tìm thấy FFmpeg. Cổng ứng dụng vẫn chạy, nhưng một số chức năng xử lý media cần FFmpeg."
}
Write-Host "Cài đặt xong. Chạy npm start để mở StoryAI + Dola tại cổng 3021 và Gateway tại cổng 8210." -ForegroundColor Green
