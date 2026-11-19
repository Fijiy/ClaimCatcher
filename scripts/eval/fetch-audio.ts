// `pnpm eval:fetch`: fetches the audio the on-device model gates run on, into
// eval/media/ (git-ignored; clip media is never committed):
//
//   eval/media/clips/<clip id>.wav   each evaluation clip's window (eval/clips.json)
//   eval/media/full/<id>.wav         the whole debate the voice gate plays (eval/voices/sessions.json)
//
// 48 kHz mono 16-bit WAV, cut to exactly the window, so sample 0 is the
// window's start on the video's timeline. Files already there are kept.
//
//   pnpm eval:fetch                  every clip and the whole debate
//   pnpm eval:fetch --clips          only the clips (about 25 minutes of audio)
//   pnpm eval:fetch --only <id,...>  only these clips (or the debate's id)
//   --force                          fetch again even if the file is there
//
// Needs yt-dlp and ffmpeg on PATH. YouTube, X, TikTok and parliamentlive.tv
// go through yt-dlp (audio only, just the window); live.house.gov has no
// yt-dlp extractor, so its archive's HLS manifest is found through the House
// player's own API and cut with ffmpeg. Fetching YouTube with a tool is
// against YouTube's terms (eval/README.md, "Terms"): it's done once, for this
// private measurement, and nothing is redistributed.
//
// Exit code: 0 when every file is there, 1 if any failed, 2 if a tool is missing.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { flag, option, ROOT } from './cli';
import { clipAudio, fullAudio, MEDIA, MEDIA_RATE, wavInfo } from './media';

interface Window {
  id: string;
  url: string;
  start: number;
  end: number;
  out: string;
}

interface ClipFile {
  id: string;
  video: { url: string; start_s: number; end_s: number };
}

interface SessionsFile {
  fullDebate: { id: string; url: string; start_s: number; end_s: number };
}

/** The House player's API (live.house.gov): a day's broadcast, with its archive's manifests. */
const HOUSE_API = 'https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/broadcastevents/';
/** Windows longer than this are cut from the whole downloaded file. */
const WHOLE_FILE_ABOVE_S = 20 * 60;

function windows(): Window[] {
  const json = <T>(path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;
  const clips = json<ClipFile[]>('eval/clips.json').map(
    (c): Window => ({ id: c.id, url: c.video.url, start: c.video.start_s, end: c.video.end_s, out: clipAudio(c.id) }),
  );
  const { fullDebate: d } = json<SessionsFile>('eval/voices/sessions.json');
  const all = flag('clips') ? clips : [...clips, { id: d.id, url: d.url, start: d.start_s, end: d.end_s, out: fullAudio(d.id) }];
  const only = option('only')?.split(',');
  return only ? all.filter((w) => only.includes(w.id)) : all;
}

function tool(name: string): boolean {
  return spawnSync(name, ['-version'], { stdio: 'ignore' }).error === undefined || spawnSync(name, ['--version'], { stdio: 'ignore' }).error === undefined;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

/** ffmpeg: any input → the window as 48 kHz mono 16-bit WAV. `seek` is where the window starts in the input. */
function toWav(input: string, seek: number, seconds: number, out: string): void {
  const partial = `${out}.partial.wav`;
  run('ffmpeg', ['-v', 'error', '-y', ...(seek > 0 ? ['-ss', seek.toFixed(3)] : []), '-i', input, '-t', seconds.toFixed(3), '-vn', '-ac', '1', '-ar', String(MEDIA_RATE), '-c:a', 'pcm_s16le', partial]);
  renameSync(partial, out);
}

async function houseManifest(url: string): Promise<string> {
  const date = new URL(url).searchParams.get('date');
  if (!date) throw new Error(`no ?date= in ${url}`);
  const response = await fetch(`${HOUSE_API}${date.replaceAll('-', '')}`);
  if (!response.ok) throw new Error(`the House API said ${response.status}`);
  const [day] = (await response.json()) as Array<{ asset?: { files?: Array<{ type: string; url: string }> } }>;
  const hls = day?.asset?.files?.find((f) => f.type === 'HLS')?.url;
  if (!hls) throw new Error(`the House API lists no HLS archive for ${date}`);
  // `#t=…` is where the player opens; the clip times are on the manifest's own timeline.
  return hls.replace(/#.*$/, '');
}

async function fetchWindow(w: Window): Promise<void> {
  mkdirSync(dirname(w.out), { recursive: true });
  const seconds = w.end - w.start;
  if (new URL(w.url).host === 'live.house.gov') return toWav(await houseManifest(w.url), w.start, seconds, w.out);

  // yt-dlp: the best audio-only format. A short window is fetched alone (re-cut
  // at its exact times), which runs at about real time; a long one (the whole
  // debate) comes faster as the whole file, cut here.
  const whole = seconds > WHOLE_FILE_ABOVE_S;
  const scratch = join(MEDIA, '.download', w.id);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    run('yt-dlp', [
      '--quiet', '--no-warnings', '--no-playlist', '--no-progress',
      '-f', 'ba/b',
      ...(whole ? [] : ['--download-sections', `*${w.start}-${w.end}`, '--force-keyframes-at-cuts']),
      '-o', join(scratch, 'audio.%(ext)s'),
      '--', w.url,
    ]);
    const [file] = readdirSync(scratch).filter((f) => f.startsWith('audio.'));
    if (!file) throw new Error('yt-dlp saved nothing');
    toWav(join(scratch, file), whole ? w.start : 0, seconds, w.out);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const missing = ['yt-dlp', 'ffmpeg'].filter((t) => !tool(t));
  if (missing.length > 0) {
    console.error(`pnpm eval:fetch needs ${missing.join(' and ')} on PATH (e.g. brew install yt-dlp ffmpeg).`);
    return 2;
  }
  let failed = 0;
  for (const w of windows()) {
    const name = `${w.id} (${(w.end - w.start).toFixed(0)} s)`;
    if (existsSync(w.out) && !flag('force')) {
      console.log(`  have     ${name}`);
      continue;
    }
    console.log(`  fetching ${name}…`);
    try {
      await fetchWindow(w);
      const { length } = wavInfo(w.out);
      const got = length / MEDIA_RATE;
      // A window cut short (the source ended early, or the cut missed) makes every gate on it wrong.
      if (Math.abs(got - (w.end - w.start)) > 1) throw new Error(`got ${got.toFixed(1)} s of audio, expected ${(w.end - w.start).toFixed(1)} s`);
    } catch (error) {
      failed++;
      rmSync(w.out, { force: true });
      console.error(`  FAILED   ${w.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failed === 0 ? `\nThe gates' audio is in ${MEDIA.slice(ROOT.length)}/.` : `\n${failed} failed; rerun to retry them.`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
