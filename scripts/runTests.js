const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const testDirectory = path.join(projectRoot, 'test');
const testFiles = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDirectory, name));

if (testFiles.length === 0) {
  console.error('Nenhum teste ativo foi encontrado em test/.');
  process.exit(1);
}

const nodeArguments = [];
if (process.env.npm_lifecycle_event === 'test:coverage') {
  nodeArguments.push(
    '--experimental-test-coverage',
    '--test-coverage-lines=50',
    '--test-coverage-functions=50',
    '--test-coverage-branches=65'
  );
}
nodeArguments.push('--test', ...testFiles);

const result = spawnSync(process.execPath, nodeArguments, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' }
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
