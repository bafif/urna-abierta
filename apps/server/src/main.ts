import pg from 'pg';
import { buildApp, migrate } from './app.ts';

if (process.env.URNA_TEST_SERVER !== 'fake-data-only') {
  // This early server has no login yet. It must not run by accident with real data.
  console.error('Servidor de prueba sin autenticación: definí URNA_TEST_SERVER=fake-data-only para aceptarlo.');
  process.exit(1);
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
const app = buildApp(pool);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
console.log('servidor listo');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => pool.end()).then(() => process.exit(0));
  });
}
