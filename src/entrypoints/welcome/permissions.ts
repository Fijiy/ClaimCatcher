// The optional permissions the viewer has granted, for Privacy & data. Only
// optional ones are listed: install permissions can't be revoked one by one.
// The page calls chrome.permissions itself; removing a permission needs no
// user gesture, and Chrome confirms it with `onRemoved`.

import { browser, type Browser } from 'wxt/browser';

type Permission = Browser.runtime.ManifestPermission;

export interface Grant {
  /** An API permission (`tabCapture`) or a host origin pattern. */
  kind: 'permission' | 'origin';
  id: string;
  label: string;
  detail: string;
}

const described: Record<string, { label: string; detail: string }> = {
  tabCapture: {
    label: 'Tab audio capture',
    detail: 'Lets ClaimCatcher listen to video players that block direct listening. It was granted from the Allow step in the panel.',
  },
};

/** Optional permissions and origins currently held, in manifest order. */
export async function optionalGrants(): Promise<Grant[]> {
  const manifest = browser.runtime.getManifest();
  const held = await browser.permissions.getAll();
  const permissions: string[] = (manifest.optional_permissions ?? []).filter((p) => held.permissions?.includes(p as Permission));
  const origins: string[] = (manifest.optional_host_permissions ?? []).filter((o: string) => held.origins?.includes(o));
  return [
    ...permissions.map((id): Grant => ({ kind: 'permission', id, ...(described[id] ?? { label: id, detail: '' }) })),
    ...origins.map(
      (id): Grant => ({
        kind: 'origin',
        id,
        label: `Direct access to ${hostOf(id)}`,
        detail: `Lets ClaimCatcher reach ${hostOf(id)} from this browser.`,
      }),
    ),
  ];
}

export async function revoke(grant: Grant): Promise<boolean> {
  const removal = grant.kind === 'permission' ? { permissions: [grant.id as Permission] } : { origins: [grant.id] };
  return await browser.permissions.remove(removal);
}

/** Calls `listener` whenever a permission is granted or removed, here or in chrome://extensions. */
export function onGrantsChanged(listener: () => void): () => void {
  browser.permissions.onAdded.addListener(listener);
  browser.permissions.onRemoved.addListener(listener);
  return () => {
    browser.permissions.onAdded.removeListener(listener);
    browser.permissions.onRemoved.removeListener(listener);
  };
}

function hostOf(pattern: string): string {
  return pattern.replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '');
}
