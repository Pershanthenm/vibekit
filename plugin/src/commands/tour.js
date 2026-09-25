import {
  BROWNFIELD_STOPS, CLOSING, PITCH, STOPS, framings, readSettings, renderStop, shouldGreet, writeSettings,
} from '../tour.js';

/**
 * `vibekit tour`. Specification §65.
 *
 * The tour is not a demo: each stop explains a step and then names the command that performs it
 * on the user's own repository. Nothing here writes to the project — where somebody got to is a
 * property of the person, not of the repo, so it lives in machine settings.
 */

export async function tour({ args, json, 'no-tour': noTour }) {
  const [action] = args;
  const settings = await readSettings();
  const stops = action === 'brownfield' ? BROWNFIELD_STOPS : STOPS;

  if (action === 'reset') {
    await writeSettings({ tourDone: false, tourStop: 0, pitchShown: false });
    console.log('✔ Tour reset. `vibekit tour` starts again from step 1.');
    return;
  }

  if (json) {
    return void console.log(JSON.stringify({ settings, stops, closing: CLOSING }, null, 2));
  }

  if (action === 'pitch') {
    console.log(PITCH);
    return;
  }

  if (action === 'all' || action === 'brownfield') {
    console.log(stops.map((stop, index) => renderStop(stop, index, stops.length)).join('\n\n  ───\n\n'));
    return;
  }

  const asked = Number.parseInt(action ?? '', 10);
  const index = Number.isFinite(asked) ? asked - 1 : settings.tourStop;

  if (index >= stops.length) {
    console.log(CLOSING);
    await writeSettings({ tourDone: true });
    return;
  }

  // The pitch is the first thing somebody sees, and only ever once (§65).
  if (!settings.pitchShown && !Number.isFinite(asked)) {
    console.log(PITCH);
    console.log('');
    await writeSettings({ pitchShown: true });
  }

  const stop = stops[Math.max(0, index)];
  console.log(renderStop(stop, Math.max(0, index), stops.length));
  console.log('');
  console.log(index + 1 < stops.length
    ? `  Next: vibekit tour   (step ${index + 2} of ${stops.length})`
    : '  That is the last step. `vibekit tour` once more for what to do from here.');

  // Only walking forward moves the marker: jumping back to re-read step 2 should not undo the
  // five steps somebody already got through.
  if (!Number.isFinite(asked)) await writeSettings({ tourStop: Math.max(0, index) + 1 });
}

/**
 * The first-run greeting, printed before anything else on a machine that has not seen it.
 *
 * Returns whether it was shown, so a caller can decide whether to go straight on. It never
 * prompts: a question nobody can answer is a hang, and §65 requires CI and non-interactive
 * terminals to pass straight through.
 */
export async function greet({ noTour = false } = {}) {
  const settings = await readSettings();
  if (!shouldGreet({ settings, noTour })) return false;

  console.log(PITCH);
  console.log('');
  console.log('  The seven steps:');
  console.log(framings().join('\n'));
  console.log('');
  console.log('  Take the tour?  `vibekit tour`   ·   or carry on: `vibekit run`');
  console.log('  It will not ask again.');
  await writeSettings({ pitchShown: true });
  return true;
}
