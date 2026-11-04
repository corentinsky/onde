// Applique le schéma sur un Postgres vierge et vérifie la sécurité par ligne.
// Usage : DATABASE_URL=postgres://... node supabase/tests/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
const notices = [];
client.on('notice', (n) => notices.push(n.message));
await client.connect();

const run = async (label, sql) => {
  try {
    await client.query(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}\n  ${e.message}${e.where ? `\n  ${e.where}` : ''}`);
    await client.end();
    process.exit(1);
  }
};

await run('socle Supabase simulé', readFileSync(join(here, 'stubs.sql'), 'utf8'));
for (const f of readdirSync(join(root, 'migrations')).sort()) {
  await run(`migration ${f}`, readFileSync(join(root, 'migrations', f), 'utf8'));
}
await run('données de démo', readFileSync(join(root, 'seed.sql'), 'utf8'));
await run('tests de sécurité', readFileSync(join(here, 'rls.sql'), 'utf8'));
for (const n of notices.filter((m) => m.startsWith('ok'))) console.log(`  ${n}`);
await client.end();
