// Kopira poslednje podatke u paket da aplikacija ima šta da prikaže i pre povezivanja sa servisom.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'data/public');
const to = path.join(root, 'web/public/data');
if (!fs.existsSync(from)) {
  console.error('Nema podataka. Prvo pokrenite: npm run update');
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, filter: (f) => !f.endsWith('.tmp') });
console.log('Podaci kopirani u web/public/data');
