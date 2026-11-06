import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { buildApp, migrate } from './app.ts';
import { PhotoConfigError, photoStoreFromEnv, type PhotoStore } from './photo-store.ts';

const testMode = process.env.URNA_TEST_SERVER === 'fake-data-only';
if (!testMode && process.env.URNA_ACEPTO_RESPONSABILIDAD !== 'si') {
  console.error('El partido es el responsable de esta base y de cumplir la ley. Definí URNA_ACEPTO_RESPONSABILIDAD=si para aceptarlo, o URNA_TEST_SERVER=fake-data-only para probar con personas inventadas.');
  process.exit(1);
}
// Before the test mode makes up a field key: photos in a bucket need one that lasts.
let photos: PhotoStore;
try {
  photos = photoStoreFromEnv();
} catch (error) {
  if (!(error instanceof PhotoConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
if (!process.env.URNA_FIELD_KEY) {
  if (!testMode) {
    console.error('Falta URNA_FIELD_KEY: es la clave que protege las categorías sensibles y los segundos pasos. El instalador la genera; sin ella no arranca.');
    process.exit(1);
  }
  process.env.URNA_FIELD_KEY = randomBytes(32).toString('base64url');
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
try {
  const migrated = await migrate(pool);
  if (migrated.length) console.log(`base: migraciones aplicadas ${migrated.join(', ')}`);
} catch (error) {
  // «urna estado» and «urna actualizar» show the last lines of the log: this one has to say it plainly.
  console.error((error as Error).message);
  process.exit(1);
}
const app = buildApp(pool, { testMode, photos });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
console.log('servidor listo');
console.log(`fotos: ${photos.where}`);
// Without waiting: a bucket that fails must not keep the rest of the system from working.
void photos.probe();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => pool.end()).then(() => process.exit(0));
  });
}
