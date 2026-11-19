// Which of the three caption readers a page gets. The service worker injects
// only that one, when listening starts.

import type { CaptionReaderId } from '../session/types';

export function pickCaptionReader(url: string | undefined): CaptionReaderId {
  let host: string;
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    return 'track';
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') return 'youtube';
  if (host === 'live.house.gov') return 'house';
  return 'track';
}
