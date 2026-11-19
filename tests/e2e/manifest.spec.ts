import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from './extension';

test('installs with only warning-free permissions and nothing running on every page', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

  expect([...manifest.permissions!].sort()).toEqual(['activeTab', 'offscreen', 'scripting', 'sidePanel', 'storage']);
  expect(manifest.optional_permissions).toEqual(['tabCapture']);
  expect(manifest.host_permissions ?? []).toEqual([]);
  // No host is asked for, now or later: Venice and TinyFish answer CORS requests without one.
  expect(manifest.optional_host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
  expect(manifest.minimum_chrome_version).toBe('151');
  expect(manifest).toMatchObject({
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  });
});

test('is named ClaimCatcher, with the tagline and the icon at every size', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

  expect(manifest.name).toBe('ClaimCatcher');
  expect(manifest.description).toBe('Every claim. Caught and checked.');
  const sizes = { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' };
  expect(manifest.icons).toEqual(sizes);
  expect(manifest.action?.default_icon).toEqual(sizes);
});

test('the CSP allows bundled WASM and no remote script', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  const csp = (manifest.content_security_policy as { extension_pages: string }).extension_pages;

  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1]?.trim().split(/\s+/);
  expect(scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(csp).not.toMatch(/https?:|\*/);
});

test('Alt+Shift+L is bound to the same action as the icon click', async ({ serviceWorker }) => {
  // Synthetic key presses don't reach Chrome's shortcut handling, so this
  // checks the binding; `_execute_action` dispatches action.onClicked, the
  // same path the click test drives.
  const commands = await serviceWorker.evaluate(() => chrome.commands.getAll());
  const action = commands.find((c) => c.name === '_execute_action');
  expect(['Alt+Shift+L', '⌥⇧L']).toContain(action?.shortcut); // macOS shows symbols
});

test('the panel uses the bundled Atkinson Hyperlegible Next font', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('status')).toBeVisible();
  // Faces load lazily, once text uses them.
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)))
    .toContain('Atkinson Hyperlegible Next Variable');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"Atkinson Hyperlegible Next Variable"/);
});

test('the built extension references no cross-origin URL', async () => {
  // Every page, script and stylesheet ships in the package; nothing is fetched
  // from a CDN. (Later tickets add the provider's origin, called from the
  // offscreen document only; extend the allow-list then.)
  const root = fileURLToPath(new URL('../../.output/chrome-mv3/', import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter((f) => /\.(html|js|css|json)$/.test(f));
  const offenders: string[] = [];
  for (const file of files) {
    const text = await readFile(root + file, 'utf8');
    for (const [url] of text.matchAll(/(?:src|href|url)\s*[=(]\s*["']?(https?:)?\/\/[^"')\s]+/g)) offenders.push(`${file}: ${url}`);
  }
  expect(offenders).toEqual([]);
});
