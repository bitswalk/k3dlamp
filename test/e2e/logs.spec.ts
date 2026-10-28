/**
 * Settings → Logs: what the app's main process and its backend logged since
 * the app started, with a severity filter, and without the backend's
 * per-request timing lines.
 */
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headlamp = process.env.HEADLAMP_BIN ?? path.join(os.homedir(), '.local/bin/k3dlamp');
const results = process.env.RESULTS_DIR ?? '/results';

let app: ElectronApplication;
let page: Page;
const mainLog: string[] = [];

async function screenshot(name: string) {
  // Let the sidebar transition and the terminal's first paint finish first.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(results, 'screens', `${name}.png`) });
}

async function go(route: string) {
  await page.evaluate(hash => (window.location.hash = hash), `#${route}`);
}

/**
 * Searches the whole log with the viewer's Find box, as a user would. The
 * terminal puts only the rows in view in the page, so its text can't be read.
 */
async function find(text: string) {
  const box = page.getByPlaceholder('Find');
  if (!(await box.isVisible())) {
    await page.getByRole('button', { name: 'Find', exact: true }).click();
  }
  // A search runs when the text changes.
  await box.fill('');
  await box.fill(text);
}

/** Waits until the log holds the text, which may take a poll or two. */
async function expectFound(text: string) {
  await expect(async () => {
    await find(text);
    await expect(page.getByText(/^\d+ of \d+$/)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

async function expectNotFound(text: string) {
  await find(text);
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await _electron.launch({
    executablePath: headlamp,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, HEADLAMP_MCP_ENABLE: 'false', HEADLAMP_CHECK_FOR_UPDATES: 'false' },
  });
  app.process().stdout?.on('data', chunk => mainLog.push(String(chunk)));
  app.process().stderr?.on('data', chunk => mainLog.push(String(chunk)));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  fs.writeFileSync(path.join(results, 'headlamp-main-logs.log'), mainLog.join(''));
});

test('shows what the app and its backend logged, from the Settings sidebar', async () => {
  await app.evaluate(() => console.error('e2e: the main process reports a failure'));
  await go('/settings/general');
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'Logs', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
  await expect(page.locator('.xterm-rows')).toContainText(/INFO\s+(app|backend)/);
  await screenshot('settings-logs');

  // The backend's startup lines, and the main process's own.
  await expectFound('Listen address');
  await expectFound('App starting...');
  await expectFound('e2e: the main process reports a failure');
  // The backend served requests to draw this page, but their timing lines are left out.
  await expectNotFound('Request completed successfully');
  // The page keeps reading: a line logged now shows up on its own.
  await app.evaluate(() => console.error('e2e: logged while the page is open'));
  await expectFound('e2e: logged while the page is open');
});

test('filters by severity', async () => {
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'INFO' }).click();
  await page.keyboard.press('Escape');

  await expectNotFound('Listen address');
  await expectFound('e2e: the main process reports a failure');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await screenshot('settings-logs-errors');
});
