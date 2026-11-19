// The pill's typeface: the bundled Atkinson Hyperlegible Next (the brand's
// only typeface), under its own family name so it can't clash with the page's
// fonts. The pill lives in the page, where an extension URL would need a web
// accessible resource and a font URL would be a request the page can see, so
// the font's bytes are bundled into the content script and handed to the
// document's FontFaceSet directly: nothing is fetched, from anywhere.

import latin from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?inline';

export const PILL_FONT = 'ClaimCatcher Atkinson Hyperlegible Next';

/** Adds the pill's font to `doc`, once. */
export function addPillFont(doc: Document) {
  const win = doc.defaultView;
  if (!win || typeof win.FontFace !== 'function' || !doc.fonts) return;
  for (const face of doc.fonts) if (face.family === PILL_FONT) return;
  const face = new win.FontFace(PILL_FONT, bytesOf(latin), { weight: '200 800', display: 'block' });
  doc.fonts.add(face);
  void face.load().catch((error: unknown) => console.warn('[ClaimCatcher] the pill font did not load', error));
}

/** The bytes of a base64 `data:` URL. */
function bytesOf(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
