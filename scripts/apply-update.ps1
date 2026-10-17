param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$CurrentRoot,
  [Parameter(Mandatory = $true)][int]$LauncherPid
)

$ErrorActionPreference = "Stop"
$stageDir = $null
$failureMessage = $null

function Should-SkipUpdatePath {
  param([string]$RelativePath, [bool]$IsDirectory)

  $normalized = $RelativePath.Replace("\", "/")
  $segments = @($normalized.Split("/"))
  $leaf = $segments[$segments.Length - 1].ToLowerInvariant()
  if ($segments[0].ToLowerInvariant() -eq "data") { return $true }
  if ($segments | Where-Object { $_.ToLowerInvariant() -in @("accounts", "profiles", "downloads", "logs") }) { return $true }
  if ($leaf -like ".env*" -and $leaf -ne ".env.example") { return $true }

  if (-not $IsDirectory) {
    if ($leaf -like "account_credentials.*") { return $true }
    if ($leaf -match "(?i)\.(db|sqlite|sqlite3)(-(shm|wal))?$") { return $true }
    if ($leaf -in @("cookies.txt", "storage_state.json", "storage-state.json", "dola-gateway.log")) { return $true }
  }

  return $false
}

function Copy-UpdateTree {
  param([string]$Source, [string]$Destination, [string]$RelativePath = "")

  if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  }

  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    $childRelativePath = if ($RelativePath) { Join-Path $RelativePath $item.Name } else { $item.Name }
    if (Should-SkipUpdatePath -RelativePath $childRelativePath -IsDirectory $item.PSIsContainer) { continue }

    $target = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) {
      Copy-UpdateTree -Source $item.FullName -Destination $target -RelativePath $childRelativePath
    } else {
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
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
  $stageDir = Join-Path $parentDir (".storydola-update-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $stageDir | Out-Null
  Expand-Archive -LiteralPath $archiveFullPath -DestinationPath $stageDir -Force

  $stagedBundle = Join-Path $stageDir $topFolder
  if (-not (Test-Path -LiteralPath (Join-Path $stagedBundle "StoryDola.exe") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $stagedBundle "APP_INFO.txt") -PathType Leaf)) {
    throw "Không tìm thấy StoryDola.exe hoặc APP_INFO.txt sau khi giải nén ZIP."
  }

  Copy-UpdateTree -Source $stagedBundle -Destination $currentFullPath
  if (-not (Test-Path -LiteralPath (Join-Path $currentFullPath "StoryDola.exe") -PathType Leaf)) {
    throw "Không tìm thấy launcher sau khi cập nhật."
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
  Start-Process -FilePath (Join-Path $currentFullPath "StoryDola.exe")
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "Đã cập nhật chương trình trong:`r`n$currentFullPath`r`n`r`nKhông mở tự động được. Hãy chạy StoryDola.exe trong thư mục này.",
    "Cập nhật StoryDola đã cài xong",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}
