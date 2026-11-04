// Publie les fichiers de l’émetteur (infra/emetteur) sous /emetteur/ pour l’installation en une commande.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '../../../infra/emetteur');
const to = join(here, '../public/emetteur');
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) if (f !== 'README.md') cpSync(join(from, f), join(to, f));
console.log(`Émetteur : ${readdirSync(to).length} fichiers publiés sous /emetteur/`);
