// Playwright fixtures for testing the built extension:
//   context        a fresh Chrome profile with .output/chrome-mv3 loaded; it
//                  waits for the first-run page that opens on install
//   grantedPermissions  option: optional permissions the profile starts with
//                  (as if the viewer had accepted Chrome's dialog)
//   tabAudio       option: Chrome's audio isn't muted (to a fake output
//                  device instead), so tabCapture hears the tab
//   firstRunPage   the first-run page Chrome opened on install
//   serviceWorker  the extension's service worker (evaluate chrome.* in it)
//   extensionId
//   fixtures       origin of the local fixture server (tests/e2e/pages)
//   openSite       opens a fixture page at a real site's URL (YouTube, House)
//   clickAction    clicks the toolbar icon on a page (CDP Extensions.triggerAction)
//   sidePanel      waits for the side panel page to open and returns it

import { test as base, chromium, type Browser, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixture-server';
import { grantInProfile } from './granted-permissions';

const EXTENSION = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));

interface Fixtures {
  profileDir: string;
  grantedPermissions: string[];
  tabAudio: boolean;
  context: BrowserContext;
  firstRunPage: Page;
  serviceWorker: Worker;
  extensionId: string;
  clickAction: (page: Page) => Promise<void>;
  sidePanel: () => Promise<Page>;
  openSite: (url: string, fixturePage: string) => Promise<Page>;
}

interface WorkerFixtures {
  fixtures: string;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  fixtures: [
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server.origin);
      await server.close();
    },
    { scope: 'worker' },
  ],

  profileDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'claimcatcher-e2e-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  grantedPermissions: [[], { option: true }],
  tabAudio: [false, { option: true }],

  context: async ({ profileDir, grantedPermissions, tabAudio }, use) => {
    const launch = () =>
      chromium.launchPersistentContext(profileDir, {
        // Full Chrome for Testing (not the headless shell), which loads extensions.
        channel: 'chromium',
        headless: process.env.HEADED !== '1',
        // Headless Playwright mutes Chrome, and a muted Chrome gives tabCapture
        // silence. With `tabAudio`, sound goes to a fake output device instead,
        // so nothing plays out loud and tabCapture still hears the tab.
        ...(tabAudio ? { ignoreDefaultArgs: ['--mute-audio'] } : {}),
        args: [
          ...(tabAudio ? ['--disable-audio-output'] : []),
          `--disable-extensions-except=${EXTENSION}`,
          `--load-extension=${EXTENSION}`,
          // Lets the CDP Extensions domain click the toolbar icon.
          '--enable-unsafe-extension-debugging',
          '--autoplay-policy=no-user-gesture-required',
          // A second CDP endpoint, used by `sidePanel` (see there).
          '--remote-debugging-port=0',
        ],
      });
    let context = await launch();
    // Installing opens the first-run page. Wait for it, so it can't open later
    // and become the active tab in the middle of a test.
    await waitForFirstRun(context);
    if (grantedPermissions.length > 0) {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      await context.close();
      await grantInProfile(profileDir, id, grantedPermissions);
      context = await launch(); // not a new install: no first-run page this time
    }
    await use(context);
    await context.close();
  },

  firstRunPage: async ({ context }, use) => {
    const page = context.pages().find(isFirstRun);
    if (!page) throw new Error('no first-run page (a profile with grantedPermissions was relaunched, so it has none)');
    await use(page);
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  clickAction: async ({ context, extensionId }, use) => {
    await use(async (page) => {
      const cdp = await context.browser()!.newBrowserCDPSession();
      try {
        // triggerAction wants the page's *tab* target, which Playwright doesn't expose.
        const { targetInfos } = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })) as {
          targetInfos: Array<{ targetId: string; url: string }>;
        };
        const tabs = targetInfos.filter((t) => t.url === page.url());
        if (tabs.length !== 1) throw new Error(`expected one tab at ${page.url()}, found ${tabs.length}`);
        await cdp.send('Extensions.triggerAction' as never, { id: extensionId, targetId: tabs[0]!.targetId } as never);
      } finally {
        await cdp.detach();
      }
    });
  },

  // Playwright's launched context doesn't list side panel pages, but a
  // connectOverCDP connection to the same browser does. So the panel is
  // reached through a second connection. That connection doesn't hear about
  // a panel opened again after closing, so it reconnects until it sees one.
  sidePanel: async ({ profileDir, extensionId }, use) => {
    let observer: Browser | undefined;
    const isPanel = (p: Page) => p.url().startsWith(`chrome-extension://${extensionId}/sidepanel.html`) && !p.isClosed();
    const connect = async () => {
      const [port] = (await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n');
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    };
    await use(async () => {
      for (let attempt = 0; ; attempt++) {
        observer ??= await connect();
        const context = observer.contexts()[0]!;
        const open = context.pages().find(isPanel);
        if (open) return open;
        if (attempt === 0) {
          const opened = await context.waitForEvent('page', { predicate: isPanel, timeout: 2_000 }).catch(() => undefined);
          if (opened) return opened;
        } else if (attempt > 40) {
          throw new Error('the side panel did not open');
        } else {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await observer.close();
        observer = undefined;
      }
    });
    await observer?.close();
  },

  // Serves a fixture page at a real site's URL, so the extension sees the real
  // hostname and picks that site's caption reader. Everything under the site's
  // origin comes from the fixture server: the page itself for any page path,
  // and `/media/*` as is (Range requests pass through).
  openSite: async ({ context, fixtures }, use) => {
    await use(async (url, fixturePage) => {
      const { origin } = new URL(url);
      await context.route(`${origin}/**`, async (route) => {
        const requested = new URL(route.request().url());
        const path = requested.pathname.startsWith('/media/') ? requested.pathname : `/${fixturePage}`;
        await route.fulfill({ response: await route.fetch({ url: `${fixtures}${path}${requested.search}` }) });
      });
      const page = await context.newPage();
      await page.goto(url);
      return page;
    });
  },
});

export const expect = test.expect;

function isFirstRun(page: Page): boolean {
  return /^chrome-extension:\/\/[a-p]{32}\/welcome\.html/.test(page.url());
}

async function waitForFirstRun(context: BrowserContext) {
  // Polled: the tab is created at about:blank before it reaches the page.
  for (const deadline = Date.now() + 10_000; !context.pages().some(isFirstRun); ) {
    if (Date.now() > deadline) throw new Error('the first-run page did not open on install');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
