// Copie les documents de référence (source unique à la racine du dépôt) vers public/documents/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'documents');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'calendrier-2027.pdf'), join(out, 'calendrier-2027.pdf'));
copyFileSync(join(root, 'assets', 'carte-pdf.png'), join(out, 'carte-pdf.png'));
console.log('Documents synchronisés dans public/documents/.');
