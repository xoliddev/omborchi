// GitHub Pages serves 404.html for unknown paths: make it the SPA so deep links work.
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] ?? 'dist-demo';
copyFileSync(join(dir, 'index.html'), join(dir, '404.html'));
writeFileSync(join(dir, '.nojekyll'), '');
console.log(`SPA fallback written to ${dir}/404.html`);
