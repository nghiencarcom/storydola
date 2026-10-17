const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function createLogger(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (message) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 8 * 1024 * 1024) {
        fs.renameSync(file, file + ".1");
      }
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, { mode: 0o600 });
    } catch (error) {
      process.stderr.write(`Cannot write Studio log: ${error.message}\n`);
    }
  };
}

function supervise({ command, args, cwd, env, log, portBusy, onFailure,
  maxRestarts = 5, baseDelay = 1000, stableMs = 60000, output = true }) {
  let child;
  let timer;
  let stopped = false;
  let restarts = 0;

  function launch() {
    if (stopped) return;
    const started = Date.now();
    child = spawn(command, args, { cwd, env, stdio: ["inherit", "pipe", "pipe"] });
    log(`Next.js spawned pid=${child.pid || "unknown"}`);
    for (const [stream, sink, label] of [
      [child.stdout, process.stdout, "stdout"], [child.stderr, process.stderr, "stderr"]
    ]) {
      stream.on("data", chunk => {
        log(`${label}: ${chunk.toString().trimEnd()}`);
        if (output) sink.write(chunk);
      });
    }
    child.on("error", error => log(`spawn error: ${error.message}`));
    child.on("close", (code, signal) => {
      log(`Next.js closed pid=${child.pid || "unknown"} code=${code} signal=${signal} intentional=${stopped}`);
      if (stopped) return;
      if (Date.now() - started >= stableMs) restarts = 0;
      if (restarts >= maxRestarts) {
        log(`Stopped retrying after ${maxRestarts} consecutive restarts`);
        onFailure(1);
        return;
      }
      const delay = Math.min(30000, baseDelay * 2 ** restarts++);
      log(`Restart ${restarts}/${maxRestarts} in ${delay}ms`);
      timer = setTimeout(async () => {
        try {
          if (stopped) return;
          if (await portBusy()) {
            log("Port now belongs to another listener; old supervisor exits without replacing it");
            onFailure(0);
            return;
          }
          launch();
        } catch (error) {
          log(`Restart check failed: ${error.message}`);
          onFailure(1);
        }
      }, delay);
    });
  }

  launch();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  };
}

module.exports = { createLogger, supervise };
