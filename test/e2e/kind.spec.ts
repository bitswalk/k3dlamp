/**
 * Drives the installed k3dlamp build through the kind plugin's job: install the
 * plugin from Artifact Hub, create a cluster with Add cluster, operate it from
 * the app, and delete it. kind is on PATH from the start. k3d.spec.ts runs
 * first, in the same home directory, so its plugin and settings are already
 * there. The plugin comes from the live store, so these specs need network access.
 */
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headlamp = process.env.HEADLAMP_BIN ?? path.join(os.homedir(), '.local/bin/k3dlamp');
const store = { repository: 'bitswalk-k3dlamp-kind-plugin', package: 'k3dlamp-kind-plugin' };
const pluginIdentity = '@bitswalk/headlamp-kind@k3dlamp-kind-plugin';
const kubeconfig = path.join(os.homedir(), '.kube', 'config');
const results = process.env.RESULTS_DIR ?? '/results';

let app: ElectronApplication;
let page: Page;
const mainLog: string[] = [];

interface Prompt {
  modal: boolean;
  title?: string;
  detail?: string;
}

/** Native dialogs the app showed, answered with their first button (Yes, Allow). */
function prompts(): Promise<Prompt[]> {
  return app.evaluate(() => (globalThis as any).e2ePrompts);
}

async function screenshot(name: string) {
  await page.screenshot({ path: path.join(results, 'screens', `${name}.png`) });
}

async function go(route: string) {
  await page.evaluate(hash => (window.location.hash = hash), `#${route}`);
}

function sidebarKind() {
  return page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'kind', exact: true });
}

function noClusters() {
  return page.getByRole('heading', { name: 'No kind clusters' });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await _electron.launch({
    executablePath: headlamp,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, HEADLAMP_CHECK_FOR_UPDATES: 'false', HEADLAMP_MCP_ENABLE: 'false' },
  });
  app.process().stdout?.on('data', chunk => mainLog.push(String(chunk)));
  app.process().stderr?.on('data', chunk => mainLog.push(String(chunk)));
  // As in k3d.spec.ts: accept native dialogs as a user would, and record them.
  await app.evaluate(({ dialog }) => {
    const shown: Prompt[] = ((globalThis as any).e2ePrompts = []);
    const record = (modal: boolean, args: any[]) => {
      const { title, detail } = args[args.length - 1];
      shown.push({ modal, title, detail });
    };
    dialog.showMessageBox = (async (...args: any[]) => {
      record(false, args);
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    dialog.showMessageBoxSync = ((...args: any[]) => {
      record(true, args);
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  fs.writeFileSync(path.join(results, 'headlamp-main-kind.log'), mainLog.join(''));
});

test('installs the kind plugin from Artifact Hub through the Plugin Catalog', async () => {
  test.setTimeout(5 * 60_000);
  // Open the catalog from the home sidebar, as a user does, once the app has
  // settled: it may first reopen the page an earlier spec file left it on.
  await go('/');
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'Plugin Catalog', exact: true })
    .click({ timeout: 120_000 });
  const official = page.getByLabel('Only Official');
  await expect(official).toBeVisible({ timeout: 120_000 });
  // k3d.spec.ts turned the filter off; the catalog may or may not remember it.
  if (await official.isChecked()) {
    await official.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes' }).click();
  }
  await expect(official).not.toBeChecked();
  await page.locator('main').getByLabel('Search').fill('k3dlamp');
  await page.getByRole('link', { name: 'kind for k3dlamp' }).click({ timeout: 120_000 });
  await expect(page).toHaveURL(new RegExp(`/plugin-catalog/${store.repository}/${store.package}$`));
  const install = page.getByRole('button', { name: 'Install', exact: true });
  await expect(install).toBeVisible({ timeout: 120_000 });
  await screenshot('kind-0-store-listing');
  await install.click();
  await page.getByRole('button', { name: 'Reload Now' }).click({ timeout: 180_000 });
  await expect(sidebarKind()).toBeVisible({ timeout: 120_000 });

  const installs = (await prompts()).filter(p => p.title === 'Plugin Installation');
  expect(installs).toHaveLength(1);
  expect(installs[0].detail).toContain(
    'https://github.com/bitswalk/k3dlamp-kind-plugin/releases/download/'
  );
});

test('leaves the kubeconfig unlocked after Headlamp removes a cluster from it', async () => {
  // kind and kubectl treat config.lock existing as another program writing the
  // kubeconfig. Headlamp used to leave that file behind after its first edit,
  // so kind could create clusters but never add them to the kubeconfig again.
  const lockPath = `${kubeconfig}.lock`;
  fs.writeFileSync(
    kubeconfig,
    [
      'apiVersion: v1',
      'kind: Config',
      'clusters:',
      '- name: e2e-removed',
      '  cluster: { server: "https://127.0.0.1:1" }',
      'users:',
      '- name: e2e-removed',
      '  user: { token: e2e }',
      'contexts:',
      '- name: e2e-removed',
      '  context: { cluster: e2e-removed, user: e2e-removed }',
      'current-context: e2e-removed',
      '',
    ].join('\n')
  );
  await go('/');
  const row = page.getByRole('row', { name: /e2e-removed/ });
  await expect(row).toBeVisible({ timeout: 60_000 });

  // Removing a cluster reloads the page.
  const reloaded = page.waitForEvent('load', { timeout: 60_000 });
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await reloaded;

  // Headlamp removes the cluster, user and context, but leaves current-context.
  await expect
    .poll(() => fs.readFileSync(kubeconfig, 'utf8'))
    .not.toContain('name: e2e-removed');
  expect(fs.existsSync(lockPath)).toBe(false);
});

test('creates a single-node cluster with Add cluster', async () => {
  test.setTimeout(10 * 60_000);
  await sidebarKind().click();
  await expect(noClusters()).toBeVisible({ timeout: 60_000 });
  await screenshot('kind-1-ready');

  // The sidebar's own Add Cluster button opens Headlamp's provider list instead.
  await page.getByRole('main').getByRole('button', { name: 'Add cluster', exact: true }).click();
  await expect(page.getByText('Creating cluster…')).toBeVisible();
  await expect(page.getByText('Cluster local-aio is ready.')).toBeVisible({
    timeout: 8 * 60_000,
  });
  await expect(page.locator('pre')).toContainText('Creating cluster "local-aio"');
  // The link only renders once Headlamp has loaded the context kind wrote.
  await expect(page.getByRole('link', { name: 'kind-local-aio' }).first()).toBeVisible({
    timeout: 60_000,
  });
  await screenshot('kind-2-created');
});

test('operates the new cluster from Headlamp', async () => {
  await page.getByRole('link', { name: 'kind-local-aio' }).first().click();
  // Opening a cluster can navigate, or reload the page, more than once after the
  // click, and either can replace or interrupt the next navigation. Ask for its
  // nodes until they show. Exact: the overview's events also link pods named
  // after the node.
  const node = page.getByRole('link', { name: 'local-aio-control-plane', exact: true });
  await expect(async () => {
    await go('/c/kind-local-aio/nodes');
    await expect(node).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 120_000 });
  await screenshot('kind-3-nodes');
});

test('deletes the cluster', async () => {
  test.setTimeout(5 * 60_000);
  await go('/kind');
  await page
    .getByRole('row', { name: /kind-local-aio/ })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('Cluster local-aio was deleted.')).toBeVisible({
    timeout: 4 * 60_000,
  });
  await expect(noClusters()).toBeVisible();
  await screenshot('kind-4-deleted');

  expect(execFileSync('kind', ['get', 'clusters']).toString().trim()).toBe('');
  expect(fs.readFileSync(kubeconfig, 'utf8')).not.toContain('kind-local-aio');
});

test('asked consent once for each of the three kind commands', async () => {
  const consent = (await prompts()).filter(p => p.modal).map(p => p.detail);
  expect(consent).toEqual([
    `${pluginIdentity}: kind get clusters`,
    `${pluginIdentity}: kind create cluster --config - --wait 5m`,
    `${pluginIdentity}: kind delete cluster --name`,
  ]);
});

test('deletes the plugin from Settings → Plugins without offering Save & Apply', async () => {
  test.setTimeout(2 * 60_000);
  const pluginDir = path.join(os.homedir(), '.config/k3dlamp/user-plugins', store.package);
  expect(fs.existsSync(pluginDir)).toBe(true);
  await go('/settings/plugins');
  const row = page.getByRole('row', { name: /headlamp-kind/ });
  await expect(row).toBeVisible({ timeout: 60_000 });

  // Electron answers window.confirm itself, out of Playwright's reach, so accept
  // it in the page as a user would, and record what it asked. Also record whether
  // Save & Apply ever shows. The delete waits out a cancellation window first,
  // and saving in it reloaded the page and abandoned the delete, so the page no
  // longer offers to save a delete at all.
  await page.evaluate(() => {
    const e2e = window as any;
    e2e.e2eConfirms = [];
    window.confirm = (message?: string) => {
      e2e.e2eConfirms.push(String(message));
      return true;
    };
    e2e.e2eSaveShown = false;
    new MutationObserver(() => {
      if ([...document.querySelectorAll('button')].some(b => b.textContent === 'Save & Apply')) {
        e2e.e2eSaveShown = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  // A successful delete reloads the page by itself.
  const reloaded = page.waitForEvent('load', { timeout: 90_000 });
  await row.getByRole('button', { name: 'Delete Plugin' }).click();
  expect(await page.evaluate(() => (window as any).e2eConfirms)).toEqual([
    'Are you sure you want to delete this plugin?',
  ]);
  await expect(row).toBeHidden();
  await expect(page.getByText(`Deleting plugin ${store.package}...`)).toBeVisible();
  await screenshot('kind-5-plugin-deleting');

  await expect(page.getByText(`Deleted plugin ${store.package}.`)).toBeVisible({
    timeout: 30_000,
  });
  // Read it before the page reloads itself, two seconds after the delete.
  expect(await page.evaluate(() => (window as any).e2eSaveShown)).toBe(false);
  await reloaded;
  await expect(page.getByRole('row', { name: /headlamp-k3d/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('row', { name: /headlamp-kind/ })).toBeHidden();
  expect(fs.existsSync(pluginDir)).toBe(false);

  await go('/');
  await expect(
    page
      .getByRole('navigation', { name: 'Navigation' })
      .getByRole('button', { name: 'k3d', exact: true })
  ).toBeVisible();
  await expect(sidebarKind()).toBeHidden();
});
