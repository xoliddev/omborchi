import { expect, test, type Page } from '@playwright/test';

const errors: string[] = [];

async function boot(page: Page, path = '') {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(path);
  // The first visit builds Demo Market inside the browser (PGlite in a Web Worker).
  await expect(page.locator('.demo-bar')).toBeVisible({ timeout: 120_000 });
}

const money = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, ''));

async function viewAs(page: Page, name: string) {
  const select = page.locator('.demo-bar select');
  const value = await select.locator('option', { hasText: name }).getAttribute('value');
  await select.selectOption(value!);
}

test.beforeEach(() => {
  errors.length = 0;
});

test('POS sale updates stock, the sales list and the dashboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'covered by the mobile test');
  await boot(page);
  await expect(page.getByTestId('kpi-revenue')).toBeVisible();
  const todayBefore = money(await page.getByTestId('today-revenue').textContent());

  await page.getByRole('link', { name: 'Checkout' }).click();
  const search = page.getByTestId('pos-search');
  await search.fill('Obi non');
  const tile = page.getByTestId('pos-grid').getByRole('button', { name: /Obi non/ }).first();
  const stockBefore = money(await tile.locator('.t-stock').textContent());
  await search.press('Enter');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await search.fill('Obi non');
  await search.press('Enter');
  await expect(page.getByTestId('cart-line').locator('input')).toHaveValue('2');
  const total = money(await page.getByTestId('cart-total').textContent());
  expect(total).toBeGreaterThan(0);

  await page.keyboard.press('F4');
  await page.getByTestId('pay-cash').fill(String(total + 5000));
  await expect(page.getByTestId('change')).toContainText('5,000');
  await page.getByTestId('confirm-payment').click();
  const done = page.getByText(/Sale S-\d+ completed/);
  await expect(done).toBeVisible();
  const saleNo = ((await done.textContent()) ?? '').match(/S-\d+/)![0];
  await page.getByTestId('new-sale').click();

  // stock on the tile went down by two
  await search.fill('Obi non');
  await expect(page.getByTestId('pos-grid').getByRole('button', { name: /Obi non/ }).first().locator('.t-stock')).toContainText(`${stockBefore - 2} `);

  // the sale shows up in the sales list
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.getByText(saleNo)).toBeVisible();

  // and today's revenue on the dashboard includes it
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect.poll(async () => money(await page.getByTestId('today-revenue').textContent())).toBe(todayBefore + total);
  expect(errors).toEqual([]);
});

test('roles: a cashier gets the checkout but no reports', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await boot(page);
  await viewAs(page, 'Jasur');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await viewAs(page, 'Akmal');
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('stock transfer moves quantity between locations', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await boot(page, 'transfers');
  await page.getByRole('button', { name: 'New transfer' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByPlaceholder('Add product: name, SKU or barcode').fill('Guruch Lazer');
  await drawer.getByRole('option').first().click();
  await drawer.getByLabel('Qty').fill('3');
  await drawer.getByRole('button', { name: 'Move stock' }).click();
  await expect(page.getByText(/Transfer TR-\d+ completed/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('reports render and export CSV', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await boot(page, 'reports/abc');
  await expect(page.getByText('Share of result by class')).toBeVisible();
  await page.getByRole('link', { name: 'Debt aging' }).click();
  await expect(page.getByText(/Outstanding/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toBe('debt-aging-customer.csv');
  expect(errors).toEqual([]);
});

test('mobile: dashboard and checkout fit a 375px screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
  await expect(page.getByTestId('kpi-revenue')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByTestId('pos-grid').getByRole('button').first().click();
  await page.getByRole('button', { name: /^Cart/ }).click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
