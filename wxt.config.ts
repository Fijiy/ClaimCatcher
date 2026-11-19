import { defineConfig } from 'wxt';
import { ensureSnapshot } from './scripts/mbfc-snapshot.ts';
import { ensureModels } from './scripts/models.ts';

// Everything the manifest promises is pinned here and checked by
// tests/e2e/manifest.spec.ts against the built extension.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Explicit imports everywhere: a reader can see where every name comes from.
  imports: false,
  // Chrome only (see the spec, "Browser").
  browser: 'chrome',
  manifestVersion: 3,
  // The model worker is an ES module: ONNX Runtime needs `import.meta.url`
  // and dynamic `import()` to start its own thread workers.
  vite: () => ({ worker: { format: 'es' } }),
  hooks: {
    // Bundled data and models are made at build time: the MBFC ratings
    // snapshot (fetched when missing or pinned to another commit) and the
    // on-device models (exported when missing; see scripts/models.ts).
    'build:before': async () => {
      await ensureSnapshot();
      await ensureModels();
    },
    // The quality gate's page (src/entrypoints/eval/, for `pnpm eval:local`)
    // is built only by `wxt build --mode eval`, into .output/chrome-mv3-eval/.
    // It never ships.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode === 'eval') return;
      const gate = entrypoints.findIndex((e) => e.name === 'eval');
      if (gate >= 0) entrypoints.splice(gate, 1);
    },
  },
  manifest: {
    // The extension's name and tagline. The store listing title
    // ("ClaimCatcher: Live Fact-Checks") is set in the store dashboard,
    // not here: Chrome shows `name` in the toolbar and extensions page.
    name: 'ClaimCatcher',
    description: 'Every claim. Caught and checked.',
    // Rendered from src/assets/icon*.svg by `pnpm icons`.
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    minimum_chrome_version: '151',
    // Exactly these, so installing shows no warning. Anything more is
    // requested at the moment it is needed.
    permissions: ['storage', 'offscreen', 'sidePanel', 'activeTab', 'scripting'],
    optional_permissions: ['tabCapture'],
    action: {
      default_title: 'ClaimCatcher: start listening on this tab',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    commands: {
      // `_execute_action` fires action.onClicked when the action has no popup,
      // so Alt+Shift+L and the icon click share one code path.
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+L' },
        description: 'Start listening on this tab',
      },
    },
    // Cross-origin isolation, so the on-device worker gets threaded WASM and
    // WebGPU. Extension pages therefore load no cross-origin resources.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    // Bundled WASM only; no remote script of any kind.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
