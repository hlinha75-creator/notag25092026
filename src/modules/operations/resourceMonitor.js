const { monitorEventLoopDelay } = require('node:perf_hooks');

const INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_INTERVAL_MS = 60 * 1000;
const STARTUP_SAMPLES = 4;
const RAM_LIMIT_MB = Number(process.env.RAM_LIMIT_MB || 512);
const WARNING_LEVELS_MB = [350, 400, 450];

function startResourceMonitor(options = {}) {
  const intervalMs = options.intervalMs || INTERVAL_MS;
  const logger = options.logger || console.log;
  const warnLogger = options.warnLogger || console.warn;
  const processRef = options.processRef || process;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const delay = options.delay || monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousCpu = processRef.cpuUsage();
  let previousTime = processRef.hrtime.bigint();
  let warnedLevel = 0;

  function sample(label = '') {
    try {
      const now = processRef.hrtime.bigint();
      const elapsedMicros = Number(now - previousTime) / 1000;
      const cpu = processRef.cpuUsage(previousCpu);
      const cpuPercent = ((cpu.user + cpu.system) / elapsedMicros) * 100;
      const memory = processRef.memoryUsage();
      const rssMb = memory.rss / 1048576;
      const handles = processRef._getActiveHandles?.().length ?? 0;
      const requests = processRef._getActiveRequests?.().length ?? 0;
      logger(`[RECURSOS]${label ? ` ${label}` : ''} CPU ${cpuPercent.toFixed(1)}% | RAM RSS ${rssMb.toFixed(1)} MB/${RAM_LIMIT_MB} MB | Heap ${(memory.heapUsed / 1048576).toFixed(1)} MB | External ${(memory.external / 1048576).toFixed(1)} MB | ArrayBuffers ${(memory.arrayBuffers / 1048576).toFixed(1)} MB | Handles ${handles} | Requests ${requests} | Event loop p99 ${(delay.percentile(99) / 1e6).toFixed(1)} ms`);
      const reachedLevel = WARNING_LEVELS_MB.filter((level) => rssMb >= level).at(-1) || 0;
      if (reachedLevel > warnedLevel) {
        warnLogger(`[RECURSOS] ALERTA: RSS atingiu ${rssMb.toFixed(1)} MB de ${RAM_LIMIT_MB} MB.`);
      }
      warnedLevel = reachedLevel;
      previousCpu = processRef.cpuUsage();
      previousTime = now;
    } catch (error) {
      warnLogger(`[RECURSOS] Falha ao coletar metricas${label ? ` (${label.trim()})` : ''}: ${error.code || error.message}. O monitor continuara ativo.`);
      try {
        previousCpu = processRef.cpuUsage();
        previousTime = processRef.hrtime.bigint();
      } catch {}
    } finally {
      try { delay.reset(); } catch {}
    }
  }

  try {
    logger(`[RECURSOS] INICIAL | Node ${processRef.version} | PID ${processRef.pid} | RAM RSS ${(processRef.memoryUsage().rss / 1048576).toFixed(1)} MB/${RAM_LIMIT_MB} MB`);
  } catch (error) {
    warnLogger(`[RECURSOS] Falha ao coletar metricas iniciais: ${error.code || error.message}. O monitor continuara ativo.`);
  }

  const timer = setIntervalFn(sample, intervalMs);
  let startupSamples = 0;
  const startupTimer = setIntervalFn(() => {
    startupSamples += 1;
    sample(`STARTUP ${startupSamples}/${STARTUP_SAMPLES} |`);
    if (startupSamples >= STARTUP_SAMPLES) clearIntervalFn(startupTimer);
  }, options.startupIntervalMs || STARTUP_INTERVAL_MS);
  timer.unref?.();
  startupTimer.unref?.();
  return {
    sample,
    stop() { clearIntervalFn(timer); clearIntervalFn(startupTimer); delay.disable(); }
  };
}

module.exports = { startResourceMonitor };
