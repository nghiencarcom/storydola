param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$CurrentRoot,
  [Parameter(Mandatory = $true)][int]$LauncherPid
)

$ErrorActionPreference = "Stop"
$stageDir = $null
$newRoot = $null
$failureMessage = $null

function Copy-MissingTree {
  param([string]$Source, [string]$Destination)

  if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  }

  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    $target = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) {
      Copy-MissingTree -Source $item.FullName -Destination $target
    } elseif (-not (Test-Path -LiteralPath $target)) {
      Copy-Item -LiteralPath $item.FullName -Destination $target
    }
  }
}

try {
  $archiveFullPath = (Resolve-Path -LiteralPath $ArchivePath).Path
  $currentFullPath = (Resolve-Path -LiteralPath $CurrentRoot).Path.TrimEnd("\", "/")
  if (-not (Test-Path -LiteralPath (Join-Path $currentFullPath "StoryDola.exe") -PathType Leaf)) {
    throw "Không tìm thấy StoryDola.exe trong thư mục hiện tại."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archiveFullPath)
  try {
    $entries = @($zip.Entries)
    if ($entries.Count -eq 0) { throw "ZIP cập nhật trống." }

    foreach ($entry in $entries) {
      $entryName = $entry.FullName.Replace("\", "/")
      $segments = $entryName.Split("/")
      if ($entryName.StartsWith("/") -or $segments -contains ".." -or $entryName -match "^[A-Za-z]:") {
        throw "ZIP có đường dẫn không hợp lệ; đã hủy cập nhật."
      }
    }

    $launchers = @($entries | Where-Object { $_.FullName.Replace("\", "/") -match "^[^/]+/StoryDola\.exe$" })
    if ($launchers.Count -ne 1) { throw "ZIP không có cấu trúc bản StoryDola portable hợp lệ." }
    $topFolder = $launchers[0].FullName.Replace("\", "/").Split("/")[0]
    foreach ($entry in $entries) {
      $entryName = $entry.FullName.Replace("\", "/")
      if ($entryName -ne "$topFolder/" -and -not $entryName.StartsWith("$topFolder/")) {
        throw "ZIP chứa nhiều thư mục gốc; đã hủy cập nhật."
      }
    }
  } finally {
    $zip.Dispose()
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline -and (Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 300
  }
  if (Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue) {
    throw "StoryDola chưa đóng hoàn toàn. Hãy đóng launcher cũ rồi thử lại."
  }

  $parentDir = Split-Path -Parent $currentFullPath
  $newRoot = Join-Path $parentDir $topFolder
  if ($newRoot.TrimEnd("\", "/") -ieq $currentFullPath) {
    $newRoot = Join-Path $parentDir ($topFolder + "-update-" + [Guid]::NewGuid().ToString("N").Substring(0, 6))
  } elseif (Test-Path -LiteralPath $newRoot) {
    $newRoot = Join-Path $parentDir ($topFolder + "-update-" + [Guid]::NewGuid().ToString("N").Substring(0, 6))
  }

  $stageDir = Join-Path $parentDir (".storydola-update-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $stageDir | Out-Null
  Expand-Archive -LiteralPath $archiveFullPath -DestinationPath $stageDir -Force

  $stagedBundle = Join-Path $stageDir $topFolder
  if (-not (Test-Path -LiteralPath (Join-Path $stagedBundle "StoryDola.exe") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $stagedBundle "APP_INFO.txt") -PathType Leaf)) {
    throw "Không tìm thấy StoryDola.exe hoặc APP_INFO.txt sau khi giải nén ZIP."
  }
  Move-Item -LiteralPath $stagedBundle -Destination $newRoot

  $localStatePaths = @(
    "data",
    "logs",
    "dola-studio\logs",
    "dola-studio\dola-render-gateway\accounts",
    "dola-studio\dola-render-gateway\downloads"
  )
  foreach ($relativePath in $localStatePaths) {
    $source = Join-Path $currentFullPath $relativePath
    if (Test-Path -LiteralPath $source -PathType Container) {
      Copy-MissingTree -Source $source -Destination (Join-Path $newRoot $relativePath)
    }
  }

  foreach ($item in Get-ChildItem -LiteralPath $currentFullPath -Force -File) {
    if ($item.Name -like ".env*") {
      $target = Join-Path $newRoot $item.Name
      if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $item.FullName -Destination $target }
    }
  }

  $gatewayRoot = Join-Path $currentFullPath "dola-studio\dola-render-gateway"
  if (Test-Path -LiteralPath $gatewayRoot -PathType Container) {
    foreach ($item in Get-ChildItem -LiteralPath $gatewayRoot -Force -File) {
      if ($item.Name -like "account_credentials.*" -or $item.Name -match "(?i)\.(db|sqlite3?)(-(shm|wal))?$") {
        $target = Join-Path (Join-Path $newRoot "dola-studio\dola-render-gateway") $item.Name
        if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $item.FullName -Destination $target }
      }
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $newRoot "StoryDola.exe") -PathType Leaf)) {
    throw "Không tìm thấy launcher trong thư mục cài đặt mới."
  }
} catch {
  $failureMessage = $_.Exception.Message
} finally {
  if ($stageDir -and (Test-Path -LiteralPath $stageDir)) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($failureMessage) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "Cài cập nhật thất bại: $failureMessage`r`n`r`nHãy mở lại StoryDola.exe trong thư mục hiện tại.",
    "Không thể cập nhật StoryDola",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

try {
  Start-Process -FilePath (Join-Path $newRoot "StoryDola.exe")
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "Đã cài bản cập nhật tại:`r`n$newRoot`r`n`r`nKhông mở tự động được. Hãy chạy StoryDola.exe trong thư mục này.",
    "Cập nhật StoryDola đã cài xong",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}
