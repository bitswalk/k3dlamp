/**
 * Drives the installed k3dlamp build through the k3d plugin's whole job: install
 * the plugin from Artifact Hub, notice k3d is missing, find it once installed,
 * create a cluster, operate it from the app, and delete it. run.sh installs the
 * build with install.sh and provides a private Docker daemon. The plugin comes
 * from the live store, so these specs need network access.
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const headlamp = process.env.HEADLAMP_BIN ?? path.join(os.homedir(), '.local/bin/k3dlamp');
// The installer links the binary into bin/; its resources sit beside the real file.
const resources = path.join(path.dirname(fs.realpathSync(headlamp)), 'resources');
const product = '/product';
const store = { repository: 'bitswalk-k3dlamp-k3d-plugin', package: 'k3dlamp-k3d-plugin' };
const pluginIdentity = '@bitswalk/headlamp-k3d@k3dlamp-k3d-plugin';
const k3dRelease = '/opt/k3d';
const k3dOnPath = '/usr/local/bin/k3d';
const clusterConfig = '/fixtures/single-node.yaml';
const kubeconfig = path.join(os.homedir(), '.kube', 'config');
const results = process.env.RESULTS_DIR ?? '/results';
// A plugin build to test before Artifact Hub has it; see sideloadPluginBuild.
const pluginBuild = process.env.K3D_PLUGIN_MAIN_JS;

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

function noClusters() {
  return page.getByRole('heading', { name: 'No k3d clusters' });
}

/** The custom cluster editor's text, as Monaco renders it. */
function editorText() {
  return page.locator('.monaco-editor .view-lines');
}

/**
 * Replaces the store-installed plugin's main.js with a local build, and its
 * digest in Headlamp's installation receipt, as if Artifact Hub had served that
 * build. It lets the specs try a plugin release that needs this k3dlamp release
 * before either is published. The plugin keeps its store identity and grants.
 */
async function sideloadPluginBuild(build: string) {
  const receipts = path.join(os.homedir(), '.config/k3dlamp/plugin-installation-receipts.json');
  const store = JSON.parse(fs.readFileSync(receipts, 'utf8'));
  const receipt = store.receipts.find((r: any) => r.package === 'k3dlamp-k3d-plugin');
  const main = fs.readFileSync(build);
  fs.writeFileSync(path.join(receipt.inventoryPath, receipt.bundleName, 'main.js'), main);
  receipt.files['main.js'] = crypto.createHash('sha256').update(main).digest('hex');
  fs.writeFileSync(receipts, JSON.stringify(store, null, 2));
  await page.reload();
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
  // Native dialogs can't be clicked from Playwright, so answer them in the
  // main process the way a user accepting them would, and record each one.
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
  fs.writeFileSync(path.join(results, 'headlamp-main.log'), mainLog.join(''));
});

test('ships the product manifest and the App and Plugin Catalogs, not the k3d plugin', () => {
  expect(fs.readFileSync(path.join(resources, 'app-build-manifest.json'), 'utf8')).toBe(
    fs.readFileSync(path.join(product, 'app-build-manifest.json'), 'utf8')
  );
  expect(fs.readdirSync(path.join(resources, '.plugins')).sort()).toEqual([
    'app-catalog',
    'plugin-catalog',
  ]);
});

test('runs as k3dlamp, apart from any Headlamp install', async () => {
  const identity = await app.evaluate(({ app }) => ({
    name: app.getName(),
    userData: app.getPath('userData'),
  }));
  expect(identity).toEqual({ name: 'k3dlamp', userData: path.join(os.homedir(), '.config/k3dlamp') });
});

test('installs the k3d plugin from Artifact Hub through the Plugin Catalog', async () => {
  test.setTimeout(5 * 60_000);
  // Find it as a user does: the plugin isn't official, so it only lists with
  // that filter off, and it sits beyond the first 60 Artifact Hub results.
  await go('/plugin-catalog');
  await page.getByLabel('Only Official').click({ timeout: 120_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByLabel('Only Official')).not.toBeChecked();
  await page.locator('main').getByLabel('Search').fill('k3dlamp');
  await page.getByRole('link', { name: 'k3d for k3dlamp' }).click({ timeout: 120_000 });
  await expect(page).toHaveURL(new RegExp(`/plugin-catalog/${store.repository}/${store.package}$`));
  const install = page.getByRole('button', { name: 'Install', exact: true });
  await expect(install).toBeVisible({ timeout: 120_000 });
  await screenshot('0-store-listing');
  await install.click();
  await page.getByRole('button', { name: 'Reload Now' }).click({ timeout: 180_000 });
  await expect(
    page
      .getByRole('navigation', { name: 'Navigation' })
      .getByRole('button', { name: 'k3d', exact: true })
  ).toBeVisible({ timeout: 120_000 });

  const installs = (await prompts()).filter(p => p.title === 'Plugin Installation');
  expect(installs).toHaveLength(1);
  expect(installs[0].detail).toContain(
    'https://github.com/bitswalk/k3dlamp-k3d-plugin/releases/download/'
  );

  if (pluginBuild) {
    await sideloadPluginBuild(pluginBuild);
  }
});

test('says when k3d is not installed', async () => {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('button', { name: 'k3d', exact: true })
    .click({ timeout: 120_000 });
  await expect(
    page.getByText('k3d is not installed, or not on the PATH this app was started with.')
  ).toBeVisible();
  await screenshot('1-k3d-missing');
});

test('shows k3dlamp branding, not Headlamp, in light and dark themes', async () => {
  const bitswalkRed = 'rgb(219, 22, 47)';
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    for (const [route, name, heading] of [
      ['/k3d', 'k3d', 'k3d'],
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

test('finds k3d once installed', async () => {
  fs.copyFileSync(k3dRelease, k3dOnPath);
  fs.chmodSync(k3dOnPath, 0o755);

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(noClusters()).toBeVisible();
  await screenshot('2-k3d-ready');
});

test('creates a single-server cluster with Add cluster', async () => {
  test.setTimeout(10 * 60_000);
  // The sidebar's own Add Cluster button opens Headlamp's provider list instead.
  await page.getByRole('main').getByRole('button', { name: 'Add cluster', exact: true }).click();
  await expect(page.getByText('Creating cluster…')).toBeVisible();
  await screenshot('3-creating');

  await expect(page.getByText('Cluster local-aio is ready.')).toBeVisible({
    timeout: 8 * 60_000,
  });
  await expect(page.locator('pre')).toContainText("Cluster 'local-aio' created successfully!");
  await expect(page.locator('pre')).not.toContainText('\u001b');
  // The link only renders once Headlamp has loaded the context k3d wrote.
  await expect(page.getByRole('link', { name: 'k3d-local-aio' }).first()).toBeVisible({
    timeout: 60_000,
  });
  await screenshot('4-created');
});

test('creates from a custom config, and reports what k3d refuses', async () => {
  await page.getByRole('button', { name: 'Custom cluster' }).click();
  // The editor opens on the default config, named after the next free cluster name.
  await expect(editorText()).toContainText('name: local-aio-2');
  await screenshot('4-custom-editor');

  // single-node.yaml names local-aio, which the previous spec created.
  await page.getByLabel('k3d config file to upload').setInputFiles(clusterConfig);
  await expect(editorText()).toContainText('name: local-aio');
  await expect(editorText()).not.toContainText('local-aio-2');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: /a cluster with that name already exists/ })
  ).toBeVisible({ timeout: 60_000 });
  await screenshot('4-custom-refused');

  // The editor keeps the refused draft for another try.
  await page.getByRole('button', { name: 'Edit config' }).click();
  await expect(editorText()).toContainText('Custom cluster editor');
  // The editor's own Close; the activity's window and taskbar close are icons.
  await page.getByText('Close', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit config' })).toBeVisible();
});

test('operates the new cluster from Headlamp', async () => {
  await page.getByRole('link', { name: 'k3d-local-aio' }).first().click();
  // Opening a cluster can navigate, or reload the page, more than once after the
  // click, and either can replace or interrupt the next navigation. Ask for its
  // nodes until they show. Exact: the overview's events also link pods named
  // after the node.
  const node = page.getByRole('link', { name: 'k3d-local-aio-server-0', exact: true });
  await expect(async () => {
    await go('/c/k3d-local-aio/nodes');
    await expect(node).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 120_000 });
  await screenshot('5-nodes');

  await go('/c/k3d-local-aio/pods');
  await expect(page.getByText(/^coredns-/).first()).toBeVisible({ timeout: 120_000 });
  await screenshot('6-pods');
});

test('fits the k3s version and centres the icons in the collapsed sidebar', async () => {
  // k3s versions carry build metadata, such as v1.35.5+k3s1.
  const version = page.getByTitle(/^v\d+\.\d+\.\d+\+k3s\d+$/);
  await expect(version).toHaveText(/\+k3s/);
  await page.getByRole('button', { name: 'Shrink sidebar' }).click();
  // The app keeps the sidebar collapsed across restarts, so expand it again even
  // if a check fails, or the later spec files start with it collapsed.
  try {
    await checkCollapsedSidebar(version);
  } finally {
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
  }
  await expect(version).toHaveText(/\+k3s/);
});

async function checkCollapsedSidebar(version: Locator) {
  await expect(version).toHaveText(/^v\d+\.\d+$/);
  const sidebar = page.locator('.MuiDrawer-paper').first();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeLessThan(100);
  const [button, drawer] = [await version.boundingBox(), await sidebar.boundingBox()];
  expect(button!.x + button!.width).toBeLessThanOrEqual(drawer!.x + drawer!.width);
  expect(await sidebar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Each icon sits at the centre of its button, which highlights on hover, and of
  // the sidebar's list. Headlamp alone puts it 2.5px left of both.
  const buttons = page
    .getByRole('navigation', { name: 'Navigation' })
    .locator('.MuiListItemButton-root');
  // Collapsing remounts each icon, and Iconify draws its svg a render later.
  await expect(buttons.filter({ hasNot: page.locator('svg') })).toHaveCount(0);
  const icons = await buttons.evaluateAll(buttons =>
    buttons.map(button => {
      const centre = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.x + box.width / 2;
      };
      const icon = centre(button.querySelector('svg')!);
      return {
        name: button.getAttribute('aria-label'),
        offInButton: Math.abs(Math.round(icon - centre(button))),
        offInSidebar: Math.abs(Math.round(icon - centre(button.closest('ul')!))),
      };
    })
  );
  expect(icons.length).toBeGreaterThan(0);
  expect(icons).toEqual(icons.map(({ name }) => ({ name, offInButton: 0, offInSidebar: 0 })));
  await screenshot('6-collapsed-sidebar');
}

test('finds Helm charts in the App Catalog', async () => {
  await go('/c/k3d-local-aio/apps/catalog');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await main.getByRole('textbox', { name: 'Search' }).fill('cert-manager');
  await expect(main.getByRole('link', { name: 'cert-manager', exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(main.getByRole('button', { name: 'Install' }).first()).toBeVisible();
  await screenshot('6-app-catalog');
});

test('deletes the cluster', async () => {
  test.setTimeout(5 * 60_000);
  await go('/k3d');
  await page
    .getByRole('row', { name: /k3d-local-aio/ })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('Cluster local-aio was deleted.')).toBeVisible({
    timeout: 4 * 60_000,
  });
  await expect(noClusters()).toBeVisible();
  await screenshot('7-deleted');

  expect(execFileSync(k3dOnPath, ['cluster', 'list', '-o', 'json']).toString().trim()).toBe('[]');
  expect(fs.readFileSync(kubeconfig, 'utf8')).not.toContain('k3d-local-aio');
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

test('asked consent once for each of the three commands', async () => {
  // The user location can't pre-approve commands, so each grant prompts on
  // first use; the saved answer covers every later run.
  const consent = (await prompts()).filter(p => p.modal).map(p => p.detail);
  expect(consent).toEqual([
    `${pluginIdentity}: k3d cluster list -o json`,
    `${pluginIdentity}: k3d cluster create --config -`,
    `${pluginIdentity}: k3d cluster delete`,
  ]);
});
