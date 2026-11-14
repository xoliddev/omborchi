// GitHub Pages has no SPA rewrites. Write the app shell to every static route so deep links
// answer 200 (not a 404 that browsers log as a console error), and keep 404.html as the
// fallback for dynamic paths such as /sales/<id>.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-demo';
const index = join(dir, 'index.html');
const ROUTES = [
  'pos',
  'sales',
  'customers',
  'products',
  'stock',
  'transfers',
  'write-offs',
  'counts',
  'alerts',
  'purchasing',
  'suppliers',
  'reports',
  'reports/sales',
  'reports/abc',
  'reports/stock',
  'reports/dead',
  'reports/shifts',
  'reports/debts',
  'audit',
  'settings',
];
for (const r of ROUTES) {
  mkdirSync(join(dir, r), { recursive: true });
  copyFileSync(index, join(dir, r, 'index.html'));
}
copyFileSync(index, join(dir, '404.html'));
writeFileSync(join(dir, '.nojekyll'), '');
console.log(`SPA shell written to ${ROUTES.length} routes + 404.html in ${dir}`);
