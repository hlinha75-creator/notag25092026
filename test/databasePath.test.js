const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('database path resolves relative to project root', () => {
  const originalEnv = process.env.DATABASE_PATH;
  const originalCwd = process.cwd();

  try {
    process.env.DATABASE_PATH = './data/notag.sqlite';
    process.chdir(path.resolve(projectRoot, 'src'));

    delete require.cache[require.resolve('../src/config/env')];
    const env = require('../src/config/env');

    assert.equal(env.databasePath, path.resolve(projectRoot, 'data/notag.sqlite'));
    assert.equal(typeof env.resolveDatabasePath, 'function');
    assert.equal(env.resolveDatabasePath('./data/notag.sqlite'), path.resolve(projectRoot, 'data/notag.sqlite'));
  } finally {
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalEnv;
    delete require.cache[require.resolve('../src/config/env')];
  }
});
