import { createHash, randomBytes } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FOLDER_NAMES } from './folder/layout.js';

/**
 * 192 bits, url-safe. Used for the path the console is served under and, separately, for the
 * token that authorises an action. A guessable hostname is therefore not enough to find the page,
 * and finding the page is not enough to drive it.
 *
 * This is defence in depth, never the lock: a URL leaks through history, screenshots and link
 * previews, so it is not a credential and is not treated as one.
 */
export const secret = () => randomBytes(24).toString('base64url');

/** How often the server re-reads the project while someone is watching. */
export const POLL_MS = 1000;

// A first read shows the end of a log that may already be long; after that only what is new.
const TAIL_BYTES = 8192;

// Told to the browser once: how long to wait before reconnecting if the stream drops.
export const RETRY = 'retry: 2000\n\n';

/**
 * Two kilobytes of nothing, sent before anything real.
 *
 * A proxy between the console and a phone buffers small writes: Cloudflare forwards the headers
 * immediately and then holds the body until enough of it has arrived, so a stream whose first
 * event is fifteen bytes appears to connect and then says nothing — for as long as the build runs.
 * Padding the opening past that buffer forces it through, at the cost of one comment line, which
 * EventSource ignores by definition.
 *
 * Checked against a real quick tunnel: without this the stream stays silent; with it the first
 * event arrives immediately.
 */
export const PREAMBLE = `:${' '.repeat(2048)}\n\n`;

// An SSE comment. Carries nothing, and stops an idle connection being closed under us.
export const PING = ':\n\n';

export const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * What the page shows, with the timestamp taken out. The rendered page carries the time it was
 * generated, so hashing the page itself would report a change on every tick and the console would
 * redraw once a second forever.
 */
export function fingerprint(state) {
  const { generatedAt, ...project } = state.project;
  return createHash('sha1').update(JSON.stringify({ ...state, project })).digest('hex');
}

/**
 * Every log the console follows.
 *
 * Parallel lanes and the build queue are gone (spec §12: one requirement, one holder, one
 * branch), so what remains is the transcript of anything the page itself ran. Session output
 * lands in .state/sessions/<id>/ and is picked up from there once serve writes it.
 */
export async function laneLogs(root) {
  const folder = (await Promise.all(FOLDER_NAMES.map(async (name) => ((await readdir(join(root, name)).catch(() => null)) ? name : null)))).find(Boolean);
  if (!folder) return [];
  const dir = join(root, folder, '.state/sessions');
  const ids = (await readdir(dir).catch(() => [])).sort();
  const logs = [];
  for (const id of ids) {
    for (const file of (await readdir(join(dir, id)).catch(() => [])).filter((name) => /\.(?:log|txt)$/.test(name))) {
      logs.push({ id: `${id}/${file}`, lane: id, feature: file.replace(/\.(?:log|txt)$/, ''), path: join(dir, id, file) });
    }
  }
  return logs;
}

/**
 * The bytes written to a log since `offset`. A file shorter than the offset was replaced — a lane
 * redispatched over the same worktree — so it starts again rather than reporting nonsense.
 */
export async function readSince(path, offset = 0) {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  const from = offset > info.size ? 0 : offset;
  if (from === info.size) return { offset: info.size, text: '' };
  const start = from === 0 ? Math.max(0, info.size - TAIL_BYTES) : from;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(info.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return { offset: info.size, text: buffer.toString('utf8') };
  } finally {
    await handle.close();
  }
}
