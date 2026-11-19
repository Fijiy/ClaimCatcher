// Renders the ClaimCatcher mark to the PNG sizes the manifest uses
// (public/icon/<size>.png). Run with `pnpm icons` after changing an SVG;
// scripts/render-icons.test.ts fails while the committed PNGs aren't what
// this renders.
// src/assets/icon.svg is the master; below 32 px the pixel-snapped
// src/assets/icon-16.svg is used so the 16 px toolbar icon stays crisp.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SIZES = [16, 32, 48, 128];

/** Each size's PNG, rendered from the SVGs in the given browser. */
export async function renderIcons(browser) {
  const master = await readFile(`${ROOT}src/assets/icon.svg`, 'utf8');
  const small = await readFile(`${ROOT}src/assets/icon-16.svg`, 'utf8');
  const pngs = new Map();
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${size < 32 ? small : master}`,
    );
    pngs.set(size, await page.locator('svg').screenshot({ omitBackground: true }));
    await page.close();
  }
  return pngs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch();
  try {
    for (const [size, png] of await renderIcons(browser)) await writeFile(`${ROOT}public/icon/${size}.png`, png);
  } finally {
    await browser.close();
  }
}
