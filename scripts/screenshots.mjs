// Regenerates docs/screenshots/* from the demo build: `npm run build:demo && npm run preview:demo -w @omborchi/web`, then
// `node scripts/screenshots.mjs [baseUrl]`. Uses the system Chrome (PW_CHANNEL=chrome by default).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4178/omborchi/';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });

async function shot(name, { width, height, theme, path, prepare, mobile = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'en-US', timezoneId: 'Asia/Tashkent', colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('omb.theme', t), theme);
  await page.goto(base + path);
  await page.locator('.demo-bar').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  if (prepare) await prepare(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, type: 'png' });
  await ctx.close();
  console.log('saved', name);
}

await shot('dashboard', { width: 1360, height: 860, theme: 'light', path: '' });
await shot('pos', {
  width: 1360,
  height: 860,
  theme: 'dark',
  path: 'pos',
  prepare: async (page) => {
    const search = page.getByTestId('pos-search');
    for (const q of ['Obi non', 'Coca-Cola 1.5', 'Guruch Lazer', 'Sut Musaffo', 'Lay’s pishloqli chips 150']) {
      await search.fill(q);
      await page.getByTestId('pos-grid').getByRole('button').first().click();
    }
    await search.fill('');
    await page.getByTestId('pos-grid').getByRole('button').nth(2).click();
  },
});
await shot('mobile', { width: 390, height: 844, theme: 'light', path: '', mobile: true });
await browser.close();
