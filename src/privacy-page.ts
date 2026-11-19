// The first-run page, which stays available as Privacy & data: one extension
// page (src/entrypoints/welcome/) opened on install, from the panel's ⋯ menu
// and from the panel's "why listening stopped" messages.

import { browser } from 'wxt/browser';

/** Where the page opens: at the top, or at the key setup. */
export type PrivacySection = 'top' | 'key';

export async function openPrivacyPage(section: PrivacySection = 'top'): Promise<void> {
  const url = browser.runtime.getURL('/welcome.html');
  await browser.tabs.create({ url: section === 'top' ? url : `${url}#${section}` });
}
