import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp, migrate } from './app.ts';

const testMode = process.env.URNA_TEST_SERVER === 'fake-data-only';
if (!testMode && process.env.URNA_ACEPTO_RESPONSABILIDAD !== 'si') {
  console.error('El partido es el responsable de esta base y de cumplir la ley. Definí URNA_ACEPTO_RESPONSABILIDAD=si para aceptarlo, o URNA_TEST_SERVER=fake-data-only para probar con personas inventadas.');
  process.exit(1);
}
if (!process.env.URNA_SETUP_CODE) {
  process.env.URNA_SETUP_CODE = randomBytes(9).toString('base64url');
  console.log(`Código de instalación: ${process.env.URNA_SETUP_CODE}`);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 8),
  idleTimeoutMillis: 30_000,
});

async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

await waitForDatabase();
await migrate(pool);
const app = buildApp(pool, { testMode });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
console.log('servidor listo');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => pool.end()).then(() => process.exit(0));
  });
}
