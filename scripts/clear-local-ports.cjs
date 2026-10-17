const { execFile } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function normalizePorts(ports) {
  const normalized = [...new Set(ports.map((port) => Number(port)))];
  if (normalized.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("Cấu hình cổng của ứng dụng không hợp lệ.");
  }
  return normalized;
}

function parseJsonArray(output) {
  const value = String(output || "").trim();
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function windowsPortListeners(ports, rootDir) {
  const rootLiteral = `'${path.resolve(rootDir).replace(/'/g, "''")}'`;
  const portList = `@(${ports.join(",")})`;
  const script = `
$root = [System.IO.Path]::GetFullPath(${rootLiteral}).TrimEnd([char[]]@('\\','/'))
$rootPrefix = $root + [System.IO.Path]::DirectorySeparatorChar
$ports = ${portList}
$connections = @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
$processById = @{}
foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) { $processById[[string]$process.ProcessId] = $process }
$rows = @()
foreach ($connection in $connections) {
  $listenerPid = [int]$connection.OwningProcess
  $chain = @()
  $currentPid = $listenerPid
  for ($hop = 0; $hop -lt 16 -and $currentPid -gt 0; $hop++) {
    $process = $processById[[string]$currentPid]
    if ($null -eq $process) { break }
    $chain += [pscustomobject]@{ ProcessId = [int]$process.ProcessId; ParentProcessId = [int]$process.ParentProcessId; Name = [string]$process.Name; CommandLine = [string]$process.CommandLine }
    if ([int]$process.ParentProcessId -eq $currentPid) { break }
    $currentPid = [int]$process.ParentProcessId
  }
  $owned = $false
  $targetPid = $listenerPid
  foreach ($entry in $chain) {
    $commandLine = ([string]$entry.CommandLine).Replace('/', '\\')
    if ($commandLine.IndexOf($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $owned = $true }
    if ($commandLine -match 'scripts[\\\\/](dev-local\\.cjs|dev\\.js)') { $targetPid = [int]$entry.ProcessId }
  }
  $rows += [pscustomobject]@{ Port = [int]$connection.LocalPort; ListenerPid = $listenerPid; TargetPid = $targetPid; Owned = $owned }
}
if ($rows.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($rows) -Compress -Depth 3 }
`;
  const result = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return parseJsonArray(result.stdout).map((row) => ({
    port: Number(row.Port),
    listenerPid: Number(row.ListenerPid),
    targetPid: Number(row.TargetPid),
    owned: row.Owned === true,
  }));
}

async function unixProcessInfo(pid) {
  try {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", "ppid=,args="], { encoding: "utf8" });
    const match = String(result.stdout || "").trim().match(/^(\d+)\s+([\s\S]+)$/);
    return match ? { pid, parentPid: Number(match[1]), commandLine: match[2] } : null;
  } catch {
    return null;
  }
}

async function unixWorkingDirectory(pid) {
  try {
    const result = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    return String(result.stdout || "").split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1) || "";
  } catch {
    return "";
  }
}

async function unixPortListeners(port, rootDir) {
  let output = "";
  try {
    const result = await execFileAsync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    output = result.stdout || "";
  } catch (error) {
    if (error.code === 1) return [];
    if (error.code === "ENOENT") throw new Error("Không thể kiểm tra cổng vì máy thiếu lsof.");
    throw new Error(`Không kiểm tra được cổng ${port}: ${error.message}`);
  }

  const root = path.resolve(rootDir);
  const listeners = [];
  for (const listenerPid of [...new Set(output.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 1))]) {
    const chain = [];
    const seen = new Set();
    let currentPid = listenerPid;
    while (currentPid > 1 && !seen.has(currentPid) && chain.length < 16) {
      seen.add(currentPid);
      const info = await unixProcessInfo(currentPid);
      if (!info) break;
      chain.push(info);
      currentPid = info.parentPid;
    }

    let owned = false;
    let targetPid = listenerPid;
    for (const info of chain) {
      const cwd = await unixWorkingDirectory(info.pid);
      if (info.commandLine.includes(root) || cwd === root || cwd.startsWith(`${root}${path.sep}`)) owned = true;
      if (/scripts\/(dev-local\.cjs|dev\.js)(?:\s|$)/.test(info.commandLine)) targetPid = info.pid;
    }
    listeners.push({ port, listenerPid, targetPid, owned });
  }
  return listeners;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntilClear(ports) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const openPorts = [];
    for (const port of ports) if (await isPortOpen(port)) openPorts.push(port);
    if (!openPorts.length) return;
    await delay(250);
  }
  const stillOpen = [];
  for (const port of ports) if (await isPortOpen(port)) stillOpen.push(port);
  if (stillOpen.length) throw new Error(`Chưa giải phóng được cổng ${stillOpen.join(", ")}. Hãy đóng tiến trình cũ rồi chạy lại.`);
}

async function clearLocalPorts(ports, rootDir, { forceExternalPorts = [] } = {}) {
  const selectedPorts = normalizePorts(ports);
  const forcedPorts = new Set(normalizePorts(forceExternalPorts));
  const listeners = process.platform === "win32"
    ? await windowsPortListeners(selectedPorts, rootDir)
    : (await Promise.all(selectedPorts.map((port) => unixPortListeners(port, rootDir)))).flat();
  if (!listeners.length) return;

  const externalPorts = [...new Set(listeners.filter((listener) => !listener.owned).map((listener) => listener.port))];
  const protectedExternalPorts = externalPorts.filter((port) => !forcedPorts.has(port));
  if (protectedExternalPorts.length) {
    throw new Error(`Cổng ${protectedExternalPorts.join(", ")} đang được tiến trình ngoài dự án sử dụng; ứng dụng không tự dừng tiến trình đó.`);
  }

  const targets = [...new Set(listeners.map((listener) => listener.targetPid).filter((pid) => Number.isInteger(pid) && pid > 1))];
  if (!targets.length) return;
  console.log(`[Khởi động] Đang dọn các cổng cũ của dự án: ${[...new Set(listeners.map((listener) => listener.port))].join(", ")}.`);

  if (process.platform === "win32") {
    for (const pid of targets) {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      }).catch(() => undefined);
    }
  } else {
    for (const pid of targets) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw new Error(`Không thể dừng tiến trình cũ ở cổng dự án: ${error.message}`);
      }
    }
  }

  await waitUntilClear([...new Set(listeners.map((listener) => listener.port))]);
}

module.exports = { clearLocalPorts };
