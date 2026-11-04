require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { closePool, getPool } = require('./database');

async function main() {
  const script = await fs.readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await getPool().query(script);
  console.log('Esquema POS para PostgreSQL instalado o actualizado correctamente.');
}

main()
  .catch((error) => {
    console.error(`No se pudo inicializar la base de datos PostgreSQL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
