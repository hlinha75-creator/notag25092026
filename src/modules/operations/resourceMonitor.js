const { monitorEventLoopDelay } = require('node:perf_hooks');

const INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_INTERVAL_MS = 60 * 1000;
const STARTUP_SAMPLES = 4;
const RAM_LIMIT_MB = Number(process.env.RAM_LIMIT_MB || 512);
const WARNING_LEVELS_MB = [350, 400, 450];

function startResourceMonitor(options = {}) {
  const intervalMs = options.intervalMs || INTERVAL_MS;
  const logger = options.logger || console.log;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousCpu = process.cpuUsage();
  let previousTime = process.hrtime.bigint();
  let warnedLevel = 0;

  function sample(label = '') {
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - previousTime) / 1000;
    const cpu = process.cpuUsage(previousCpu);
    const cpuPercent = ((cpu.user + cpu.system) / elapsedMicros) * 100;
    const memory = process.memoryUsage();
    const rssMb = memory.rss / 1048576;
    logger(`[RECURSOS]${label ? ` ${label}` : ''} CPU ${cpuPercent.toFixed(1)}% | RAM RSS ${rssMb.toFixed(1)} MB/${RAM_LIMIT_MB} MB | Heap ${(memory.heapUsed / 1048576).toFixed(1)} MB | External ${(memory.external / 1048576).toFixed(1)} MB | ArrayBuffers ${(memory.arrayBuffers / 1048576).toFixed(1)} MB | Event loop p99 ${(delay.percentile(99) / 1e6).toFixed(1)} ms`);
    const reachedLevel = WARNING_LEVELS_MB.filter((level) => rssMb >= level).at(-1) || 0;
    if (reachedLevel > warnedLevel) {
      (options.warnLogger || console.warn)(`[RECURSOS] ALERTA: RSS atingiu ${rssMb.toFixed(1)} MB de ${RAM_LIMIT_MB} MB.`);
    }
    warnedLevel = reachedLevel;
    previousCpu = process.cpuUsage();
    previousTime = now;
    delay.reset();
  }

  logger(`[RECURSOS] INICIAL | Node ${process.version} | PID ${process.pid} | RAM RSS ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB/${RAM_LIMIT_MB} MB`);

  const timer = setInterval(sample, intervalMs);
  let startupSamples = 0;
  const startupTimer = setInterval(() => {
    startupSamples += 1;
    sample(`STARTUP ${startupSamples}/${STARTUP_SAMPLES} |`);
    if (startupSamples >= STARTUP_SAMPLES) clearInterval(startupTimer);
  }, options.startupIntervalMs || STARTUP_INTERVAL_MS);
  timer.unref?.();
  startupTimer.unref?.();
  return { stop() { clearInterval(timer); clearInterval(startupTimer); delay.disable(); } };
}

module.exports = { startResourceMonitor };
