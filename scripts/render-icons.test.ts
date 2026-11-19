// The committed toolbar icons (public/icon/*.png) must be what `pnpm icons`
// renders from src/assets/icon*.svg, so a changed SVG can't ship with stale
// PNGs. Compared pixel by pixel in Chromium, with a small tolerance for
// anti-aliasing that differs between Chromium builds.

import { chromium, type Browser } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script without types
import { renderIcons, ROOT, SIZES } from './render-icons.mjs';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** The share of pixels whose colour or alpha differs by more than `tolerance` (0–255) in any channel. */
async function differingShare(a: Buffer, b: Buffer, size: number, tolerance = 24): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([a, b, size, tolerance]) => {
        const pixels = async (base64: string) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = new OffscreenCanvas(size, size);
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0, size, size);
          return { data: context.getImageData(0, 0, size, size).data, width: image.naturalWidth, height: image.naturalHeight };
        };
        const [x, y] = await Promise.all([pixels(a), pixels(b)]);
        if (x.width !== y.width || x.height !== y.height) return 1;
        let differing = 0;
        for (let i = 0; i < x.data.length; i += 4) {
          for (let c = 0; c < 4; c++) {
            if (Math.abs(x.data[i + c]! - y.data[i + c]!) > tolerance) {
              differing++;
              break;
            }
          }
        }
        return differing / (size * size);
      },
      [a.toString('base64'), b.toString('base64'), size, tolerance] as const,
    );
  } finally {
    await page.close();
  }
}

describe('the toolbar icons', () => {
  it('are what `pnpm icons` renders from the SVGs, at every size', { timeout: 60_000 }, async () => {
    const rendered: Map<number, Buffer> = await renderIcons(browser);
    for (const size of SIZES as number[]) {
      const committed = await readFile(`${ROOT}public/icon/${size}.png`);
      expect(await differingShare(committed, rendered.get(size)!, size), `public/icon/${size}.png is stale: run pnpm icons`).toBeLessThan(0.01);
    }
  });
});
