// Test-only: starts a profile with optional permissions already granted, as
// if the viewer had accepted Chrome's permission dialog. Chrome's dialog
// can't be clicked from a test (it's browser UI, not a page), and Chrome has
// no switch to accept it, so this writes the grant into the profile instead.
//
// Chrome keeps each extension's granted permissions in
// `<profile>/Default/Secure Preferences`, protected by an HMAC-SHA256 so that
// a tampered entry is reset at startup. Chromium builds (Chrome for Testing
// included) use an empty HMAC seed, and the message is
// `deviceId + path + value`, where the value is Chrome's JSON with empty
// dicts and lists removed (services/preferences/tracked/pref_hash_calculator.cc).
// The device id is the IOPlatformUUID on macOS (device_id_mac.cc) and empty
// where Chromium has none. The OS-encrypted copy of the hash is dropped;
// Chrome accepts the plain HMAC alone.

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export async function grantInProfile(profileDir: string, extensionId: string, permissions: string[]): Promise<void> {
  const file = join(profileDir, 'Default', 'Secure Preferences');
  const prefs = JSON.parse(await readFile(file, 'utf8'));
  const settings = prefs.extensions.settings[extensionId];
  if (!settings) throw new Error(`no settings for ${extensionId} in Secure Preferences`);
  for (const key of ['granted_permissions', 'active_permissions']) {
    settings[key] ??= {};
    const api: string[] = (settings[key].api ??= []);
    for (const permission of permissions) if (!api.includes(permission)) api.push(permission);
  }
  const path = `extensions.settings.${extensionId}`;
  const macs = prefs.protection.macs.extensions;
  macs.settings[extensionId] = createHmac('sha256', '')
    .update(deviceId() + path + chromeJson(settings))
    .digest('hex')
    .toUpperCase();
  delete macs.settings_encrypted_hash?.[extensionId];
  await writeFile(file, JSON.stringify(prefs));
}

function deviceId(): string {
  if (process.platform === 'darwin') {
    const io = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
    const uuid = /"IOPlatformUUID" = "([^"]+)"/.exec(io)?.[1];
    if (!uuid) throw new Error('no IOPlatformUUID');
    return uuid;
  }
  if (process.platform === 'linux') return '';
  throw new Error(`granting permissions in a test profile isn't supported on ${process.platform}`);
}

/** Chrome's JSON for a pref hash: sorted keys, no empty dicts or lists, `<` escaped. */
function chromeJson(value: Json): string {
  return JSON.stringify(prune(value))
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function prune(value: Json): Json {
  const empty = (v: Json) => (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0);
  if (Array.isArray(value)) return value.map(prune).filter((v) => !empty(v));
  if (typeof value === 'object' && value !== null) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const v = prune(value[key]!);
      if (!empty(v)) out[key] = v;
    }
    return out;
  }
  return value;
}
