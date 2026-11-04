const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig, withTransaction } = require('../src/database');

test('databaseConfig creates a PostgreSQL connection from environment variables', () => {
  const keys = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_SSL',
    'DB_SSL_REJECT_UNAUTHORIZED'
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DB_HOST: 'localhost',
      DB_PORT: '5433',
      DB_NAME: 'pos_test',
      DB_USER: 'pos_user',
      DB_PASSWORD: 'secret',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'false'
    });

    const config = databaseConfig();
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 5433);
    assert.equal(config.database, 'pos_test');
    assert.equal(config.user, 'pos_user');
    assert.equal(config.password, 'secret');
    assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test('databaseConfig rejects invalid PostgreSQL ports', () => {
  const original = process.env.DB_PORT;
  Object.assign(process.env, {
    DB_HOST: 'localhost',
    DB_NAME: 'pos_test',
    DB_USER: 'pos_user',
    DB_PORT: '70000'
  });
  try {
    assert.throws(() => databaseConfig(), /DB_PORT debe ser un puerto válido/);
  } finally {
    if (original === undefined) delete process.env.DB_PORT;
    else process.env.DB_PORT = original;
  }
});

test('withTransaction rejects unsupported isolation levels before connecting', async () => {
  await assert.rejects(withTransaction(async () => {}, 'SNAPSHOT'), /Nivel de aislamiento/);
});
