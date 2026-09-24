import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path) {
  return (await exists(path)) ? readFile(path, 'utf8') : null;
}

export async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/**
 * Write a file that something else may be reading at the same moment.
 *
 * A plain write truncates first, so a reader that arrives in between sees an empty file — and an
 * empty file usually reads as "there isn't one". That is how a dispatch manifest briefly looked
 * absent while it was being updated, which is the difference between "lanes are running" and
 * "nothing is dispatched, go ahead and dispatch again".
 *
 * Writing to a neighbouring temp file and renaming closes the window: rename replaces the entry in
 * one step, so a reader sees either the old contents or the new ones and never nothing.
 */
// Windows refuses to rename over a file another handle has open, with EPERM. The handle is a
// reader that is about to close, so this is a wait rather than a failure — but only briefly, and
// only for that error.
const RENAME_ATTEMPTS = 12;
const RENAME_PAUSE_MS = 20;

export async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content);
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, path);
        return;
      } catch (error) {
        if (error?.code !== 'EPERM') throw error;
        if (attempt === RENAME_ATTEMPTS) {
          // Something has held the file open the whole time. Write in place rather than give up:
          // that is what this did before, and a brief window where a reader sees half a file is a
          // great deal better than a write that never lands at all.
          await writeFile(path, content);
          return;
        }
        await new Promise((waited) => setTimeout(waited, RENAME_PAUSE_MS));
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function writeMissing(root, files) {
  const created = [];
  for (const file of files) {
    const target = join(root, file.path);
    if (await exists(target)) continue;
    await writeText(target, file.content);
    created.push(file.path);
  }
  return created;
}


/**
 * A file only its owner may read.
 *
 * `chmod 0600` is a silent no-op on Windows, so the redaction mapping and the settings file — one
 * of which can hold a tunnel token — were world-readable there while the code that "protected"
 * them returned success. On Windows the equivalent is an ACL: strip inheritance, grant the current
 * user, nobody else. Returns what it did, so a caller can say so rather than assume.
 */
export async function ownerOnly(path) {
  if (process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process');
    const user = process.env.USERNAME ?? process.env.USER;
    if (!user) return { ok: false, by: 'icacls', why: 'no USERNAME in the environment to grant to' };
    try {
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
      return { ok: true, by: 'icacls' };
    } catch (error) {
      return { ok: false, by: 'icacls', why: String(error.message).split('\n')[0] };
    }
  }
  const { chmod } = await import('node:fs/promises');
  try {
    await chmod(path, 0o600);
    return { ok: true, by: 'chmod' };
  } catch (error) {
    return { ok: false, by: 'chmod', why: error.message };
  }
}
