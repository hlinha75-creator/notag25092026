const test = require('node:test');
const assert = require('node:assert/strict');
const { startResourceMonitor } = require('../src/modules/operations/resourceMonitor');

test('monitor de recursos nao derruba o processo quando memoryUsage retorna ENFILE', () => {
  const warnings = [];
  let memoryCalls = 0;
  const fakeProcess = {
    version: 'v-test',
    pid: 123,
    hrtime: { bigint: () => BigInt((memoryCalls + 1) * 1000000) },
    cpuUsage: () => ({ user: 10, system: 5 }),
    memoryUsage: () => {
      memoryCalls += 1;
      if (memoryCalls > 1) throw Object.assign(new Error('file table overflow'), { code: 'ENFILE' });
      return { rss: 100, heapUsed: 50, external: 10, arrayBuffers: 5 };
    },
    _getActiveHandles: () => [],
    _getActiveRequests: () => []
  };
  const delay = { enable() {}, disable() {}, reset() {}, percentile: () => 0 };
  const monitor = startResourceMonitor({
    processRef: fakeProcess,
    delay,
    logger: () => {},
    warnLogger: (message) => warnings.push(message),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {}
  });

  assert.doesNotThrow(() => monitor.sample());
  assert.match(warnings[0], /ENFILE/);
  monitor.stop();
});
