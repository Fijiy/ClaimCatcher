// The MBFC snapshot bundled with the extension (written by
// scripts/mbfc-snapshot.ts on install and before every build).

import snapshot from './mbfc-snapshot.json';
import type { RatingsSnapshot } from './ratings';

export const bundledRatings = snapshot as RatingsSnapshot;
