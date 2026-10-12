/**
 * Drives the installed k3dlamp build through the k3d plugin's whole job:
 * notice k3d is missing, find it once installed, create a cluster, operate it
 * from Headlamp, and delete it. run.sh installs the build with install.sh and
 * provides a private Docker daemon.
 */
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headlamp = process.env.HEADLAMP_BIN ?? path.join(os.homedir(), '.local/bin/k3dlamp');
// The installer links the binary into bin/; its resources sit beside the real file.
const resources = path.join(path.dirname(fs.realpathSync(headlamp)), 'resources');
const product = '/product';
const k3dRelease = '/opt/k3d';
const k3dOnPath = '/usr/local/bin/k3d';
const clusterConfig = '/fixtures/dev-cluster.yaml';
const kubeconfig = path.join(os.homedir(), '.kube', 'config');
const results = process.env.RESULTS_DIR ?? '/results';

let app: ElectronApplication;
let page: Page;
const mainLog: string[] = [];

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function screenshot(name: string) {
  await page.screenshot({ path: path.join(results, 'screens', `${name}.png`) });
}

// SimpleTable also repeats its empty message in a screen-reader status region.
function noClusters() {
  return page.getByRole('paragraph').filter({ hasText: 'k3d is installed and has no clusters.' });
}

async function go(route: string) {
  await page.evaluate(hash => (window.location.hash = hash), `#${route}`);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Start without k3d, as on a laptop where it was never installed.
  fs.rmSync(k3dOnPath, { force: true });
  fs.mkdirSync(path.dirname(kubeconfig), { recursive: true });
  fs.writeFileSync(kubeconfig, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');

  app = await _electron.launch({
    executablePath: headlamp,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, HEADLAMP_CHECK_FOR_UPDATES: 'false', HEADLAMP_MCP_ENABLE: 'false' },
  });
  app.process().stdout?.on('data', chunk => mainLog.push(String(chunk)));
  app.process().stderr?.on('data', chunk => mainLog.push(String(chunk)));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  fs.writeFileSync(path.join(results, 'headlamp-main.log'), mainLog.join(''));
});

test('ships the product manifest and the k3d plugin', () => {
  expect(fs.readFileSync(path.join(resources, 'app-build-manifest.json'), 'utf8')).toBe(
    fs.readFileSync(path.join(product, 'app-build-manifest.json'), 'utf8')
  );

  const archive = fs.readdirSync(path.join(product, 'plugins')).find(f => f.endsWith('.tar.gz'));
  const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-'));
  execFileSync('tar', ['-xzf', path.join(product, 'plugins', archive!), '-C', unpacked]);
  const [bundle] = fs.readdirSync(unpacked);
  for (const file of ['main.js', 'package.json']) {
    expect(sha256(path.join(resources, '.plugins/headlamp-k3d', file))).toBe(
      sha256(path.join(unpacked, bundle, file))
    );
  }
});

test('runs as k3dlamp, apart from any Headlamp install', async () => {
  const identity = await app.evaluate(({ app }) => ({
    name: app.getName(),
    userData: app.getPath('userData'),
  }));
  expect(identity).toEqual({ name: 'k3dlamp', userData: path.join(os.homedir(), '.config/k3dlamp') });
});

test('says when k3d is not installed', async () => {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'k3d', exact: true })
    .click({ timeout: 120_000 });
  await expect(
    page.getByText('k3d is not installed, or not on the PATH k3dlamp was started with.')
  ).toBeVisible();
  await screenshot('1-k3d-missing');
});

test('shows k3dlamp branding, not Headlamp, in light and dark themes', async () => {
  const bitswalkRed = 'rgb(219, 22, 47)';
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    for (const [route, name, heading] of [
      ['/k3d', 'k3d', 'Create a cluster'],
      ['/', 'home', 'Home'],
      ['/settings/general', 'settings', 'General Settings'],
    ]) {
      await go(route);
      await expect(page.getByRole('img', { name: 'k3dlamp' }).first()).toBeVisible();
      // Wait for the page itself, so the next check can't pass on a blank screen.
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/headlamp/i, { useInnerText: true });
      expect(await page.title()).toMatch(/k3dlamp$/);
      await screenshot(`branding-${colorScheme}-${name}`);
    }
    await go('/k3d');
    // Hovering fades the selected item, so park the pointer over the page body.
    await page.mouse.move(800, 600);
    const selected = page
      .getByRole('navigation', { name: 'Navigation' })
      .getByRole('button', { name: 'k3d', exact: true });
    await expect(selected).toHaveCSS('background-color', bitswalkRed);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await go('/k3d');
  // Let the page's k3d check finish before the next test installs k3d.
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('finds k3d once installed, with no consent prompt', async () => {
  fs.copyFileSync(k3dRelease, k3dOnPath);
  fs.chmodSync(k3dOnPath, 0o755);

  // A consent prompt is a modal native dialog that blocks Electron's main
  // process, so this would time out if approvedCommands were not honoured.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(noClusters()).toBeVisible();
  await screenshot('2-k3d-ready');
});

test('creates a cluster from a k3d config file', async () => {
  test.setTimeout(10 * 60_000);
  await page.getByLabel('k3d config file').fill(clusterConfig);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Creating cluster…')).toBeVisible();
  await screenshot('3-creating');

  await expect(page.getByText('Cluster dev is ready.')).toBeVisible({ timeout: 8 * 60_000 });
  await expect(page.locator('pre')).toContainText("Cluster 'dev' created successfully!");
  await expect(page.locator('pre')).not.toContainText('\u001b');
  // The link only renders once Headlamp has loaded the context k3d wrote.
  await expect(page.getByRole('link', { name: 'k3d-dev' }).first()).toBeVisible({
    timeout: 60_000,
  });
  await screenshot('4-created');
});

test('operates the new cluster from Headlamp', async () => {
  await page.getByRole('link', { name: 'k3d-dev' }).first().click();
  await go('/c/k3d-dev/nodes');
  await expect(page.getByRole('link', { name: 'k3d-dev-server-0' })).toBeVisible({
    timeout: 120_000,
  });
  await screenshot('5-nodes');

  await go('/c/k3d-dev/pods');
  await expect(page.getByText(/^coredns-/).first()).toBeVisible({ timeout: 120_000 });
  await screenshot('6-pods');
});

test('deletes the cluster', async () => {
  test.setTimeout(5 * 60_000);
  await go('/k3d');
  await page
    .getByRole('row', { name: /k3d-dev/ })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('Cluster dev was deleted.')).toBeVisible({ timeout: 4 * 60_000 });
  await expect(noClusters()).toBeVisible();
  await screenshot('7-deleted');

  expect(execFileSync(k3dOnPath, ['cluster', 'list', '-o', 'json']).toString().trim()).toBe('[]');
  expect(fs.readFileSync(kubeconfig, 'utf8')).not.toContain('k3d-dev');
});

test('refuses k3d to renderer code that lacks the plugin capability', async () => {
  const exitCode = await page.evaluate(
    () =>
      new Promise<number>(resolve => {
        const id = 'e2e-unauthorized-k3d';
        const desktopApi = (window as any).desktopApi;
        const remove = desktopApi.receive('command-exit', (commandId: string, code: number) => {
          if (commandId === id) {
            remove?.();
            resolve(code);
          }
        });
        desktopApi.send('run-command', {
          id,
          command: 'k3d',
          args: ['cluster', 'list', '-o', 'json'],
          options: {},
          permissionSecrets: {},
        });
      })
  );
  // Negative codes come from Headlamp's main process: no k3d process was started.
  expect(exitCode).toBeLessThan(0);
});
