/**
 * The update check: it reads k3dlamp's releases at start, announces a newer
 * one, can be turned off from the notice or Settings → Updates, and shows a new
 * release's notes once after an upgrade. GitHub's API is answered with stub
 * releases, so the specs don't depend on what is published.
 */
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headlamp = process.env.HEADLAMP_BIN ?? path.join(os.homedir(), '.local/bin/k3dlamp');
const results = process.env.RESULTS_DIR ?? '/results';
const version: string = JSON.parse(fs.readFileSync('/product/app-build-manifest.json', 'utf8'))
  .product.version;
const releases = 'https://api.github.com/repos/bitswalk/k3dlamp/releases';
const redOnDark = 'rgb(255, 107, 125)';

function release(tag: string) {
  return { name: tag, html_url: `https://github.com/bitswalk/k3dlamp/releases/tag/${tag}`, body: '' };
}

let app: ElectronApplication;
let page: Page;
const mainLog: string[] = [];
const rendererLog: string[] = [];

/** Sets what the stub GitHub API answers, by URL. Other URLs get a 404. */
function answerGitHub(answers: Record<string, unknown>) {
  return app.evaluate((_, value) => ((globalThis as any).e2eGitHub.answers = value), answers);
}

/** Every GitHub API request the app made, in order. */
function gitHubRequests(): Promise<string[]> {
  return app.evaluate(() => (globalThis as any).e2eGitHub.requests);
}

async function screenshot(name: string) {
  // Let the sidebar and dialog transitions finish first.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(results, 'screens', `${name}.png`) });
}

async function go(route: string) {
  await page.evaluate(hash => (window.location.hash = hash), `#${route}`);
}

const notice = () => page.getByText('An update is available');
const updatesHeading = () => page.getByRole('heading', { name: 'Updates', exact: true });
const checkSwitch = () => page.getByLabel('Check for updates at startup');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const env = { ...process.env, HEADLAMP_MCP_ENABLE: 'false' };
  delete env.HEADLAMP_CHECK_FOR_UPDATES;
  app = await _electron.launch({
    executablePath: headlamp,
    args: ['--no-sandbox', '--disable-gpu'],
    env,
  });
  app.process().stdout?.on('data', chunk => mainLog.push(String(chunk)));
  app.process().stderr?.on('data', chunk => mainLog.push(String(chunk)));
  // Stub GitHub's API in the main process, below the page: Playwright's own
  // routing hands a file:// page's cross-origin fetch a status 0 response.
  // The stub answers CORS as GitHub does; the app's request sets Content-Type,
  // so it is preflighted. Every other request goes to the network.
  await app.evaluate(({ net, protocol }) => {
    const gitHub = ((globalThis as any).e2eGitHub = {
      answers: {} as Record<string, unknown>,
      requests: [] as string[],
    });
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type',
      'access-control-allow-methods': 'GET',
    };
    protocol.handle('https', request => {
      if (!request.url.startsWith('https://api.github.com/')) {
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      gitHub.requests.push(request.url);
      const answer = gitHub.answers[request.url];
      return new Response(JSON.stringify(answer ?? { message: 'Not Found' }), {
        status: answer === undefined ? 404 : 200,
        headers: { ...cors, 'content-type': 'application/json' },
      });
    });
  });
  await answerGitHub({ [releases]: [release('v99.0.0')] });
  page = await app.firstWindow();
  page.on('console', message => rendererLog.push(`${message.type()}: ${message.text()}`));
  // The first check can run before the stub is in place, so start again.
  await page.reload();
});

test.afterAll(async () => {
  await app?.close();
  fs.writeFileSync(path.join(results, 'headlamp-main-update.log'), mainLog.join(''));
  fs.writeFileSync(path.join(results, 'renderer-update.log'), rendererLog.join('\n') + '\n');
});

test('checks k3dlamp releases at start and announces a newer one', async () => {
  await expect(notice()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read more' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable update notifications' })).toHaveCSS(
    'color',
    redOnDark
  );
  const requests = await gitHubRequests();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter(url => url !== releases)).toEqual([]);
  await screenshot('update-notice');
});

test("Settings → Updates shares the notice's off setting", async () => {
  await page.getByRole('button', { name: 'Disable update notifications' }).click();
  await expect(notice()).toBeHidden();

  await go('/settings/general');
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'Updates', exact: true })
    .click();
  await expect(updatesHeading()).toBeVisible();
  await expect(checkSwitch()).not.toBeChecked();
  await expect(page.locator('body')).not.toContainText(/headlamp/i, { useInnerText: true });
  await screenshot('settings-updates');

  // On again: the next start announces the release.
  await checkSwitch().check();
  expect(await page.evaluate(() => localStorage.getItem('disable_update_check'))).toBe('false');
  await page.reload();
  await expect(notice()).toBeVisible();

  // Off from Settings: the next start doesn't check.
  await expect(updatesHeading()).toBeVisible();
  await checkSwitch().uncheck();
  const checks = (await gitHubRequests()).length;
  await page.reload();
  await expect(updatesHeading()).toBeVisible();
  await page.waitForTimeout(5000);
  expect(await gitHubRequests()).toHaveLength(checks);
  await expect(notice()).toBeHidden();
});

test("shows a new release's notes once after an upgrade, without the install steps", async () => {
  const notes = [
    'Adds Settings → Updates.',
    '',
    '| Component | Source |',
    '| --- | --- |',
    '| Headlamp | v0.46.0 |',
    '',
    '<!-- end-release-notes -->',
    '',
    'Install or upgrade for the current user:',
  ].join('\n');
  await answerGitHub({
    [releases]: [release(`v${version}`)],
    [`${releases}/tags/v${version}`]: { ...release(`v${version}`), body: notes },
  });
  // As after an upgrade from an older version, with the check on.
  await page.evaluate(() => {
    localStorage.setItem('disable_update_check', 'false');
    localStorage.setItem('app_version', '0.0.1');
  });
  await page.reload();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Release Notes (${version})`)).toBeVisible();
  await expect(dialog.getByText('Adds Settings → Updates.')).toBeVisible();
  await expect(dialog.getByRole('table')).toBeVisible();
  await expect(dialog).not.toContainText('Install or upgrade');
  // The installed version is the latest, so there's no update notice.
  await expect(notice()).toBeHidden();
  expect(await gitHubRequests()).toContain(`${releases}/tags/v${version}`);
  await screenshot('release-notes');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(updatesHeading()).toBeVisible();
  await page.waitForTimeout(5000);
  await expect(page.getByRole('dialog')).toBeHidden();
});
