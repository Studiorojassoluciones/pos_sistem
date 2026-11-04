const { Pool } = require('pg');

let pool;

function databaseConfig() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables de conexión: ${missing.join(', ')}. Configura el archivo .env.`);
  }

  const port = Number(process.env.DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT debe ser un puerto válido entre 1 y 65535.');
  }

  return {
    host: process.env.DB_HOST,
    port,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(databaseConfig());
    pool.on('error', (error) => {
      console.error('Error en una conexión inactiva de PostgreSQL:', error);
    });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    const connectionPool = pool;
    pool = undefined;
    await connectionPool.end();
  }
}

async function withTransaction(callback, isolationLevel = 'READ COMMITTED') {
  if (!['READ COMMITTED', 'SERIALIZABLE'].includes(isolationLevel)) {
    throw new Error('Nivel de aislamiento de transacción no permitido.');
  }

  const client = await getPool().connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('No se pudo revertir la transacción de PostgreSQL:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { closePool, databaseConfig, getPool, withTransaction };
