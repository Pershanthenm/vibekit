import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { gitInit, isolateHome, restoreEnv, tempDir } from './helpers.js';

/**
 * The Claude Code helpers are pickers: they list what a person can choose and call one command
 * with the choice. Two things the CLI had to grow for that: an ask can carry the options the
 * person picks from, and the gate the inbox lists can be approved from the inbox.
 */

async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; }
  return lines.join('\n');
}

async function fresh() {
  const root = tempDir('vibekit-inbox-');
  await capture(() => run(['new', 'project', 'Stock', '--yes', '--describe', 'Staff count stock.', '--platform', 'web', '--dir', root]));
  gitInit(root);
  return root;
}

test('vibekit ask --option records the choices a person picks from, and the inbox shows them', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = await fresh();
    await capture(() => run(['ask', 'Which currency are variances in?', '--plain', 'The money unit supervisors see', '--option', 'ZAR', '--option', 'USD', '--dir', root]));
    const shown = await capture(() => run(['ask', 'show', 'Q-001', '--dir', root]));
    assert.match(shown, /## Options the agent can see\n\n1\. ZAR\n2\. USD/);
    const queue = JSON.parse(await capture(() => run(['show', 'status', '--json', '--dir', root])));
    const ask = queue.find((item) => item.kind === 'ask' && item.id === 'Q-001');
    assert.ok(ask, 'the ask is in the queue');
    await capture(() => run(['ask', 'answer', 'Q-001', 'ZAR', '--dir', root]));
    assert.match(await capture(() => run(['ask', 'show', 'Q-001', '--dir', root])), /## Answer\n\n[^\n]*ZAR/);
  } finally {
    restoreEnv(original);
  }
});

test('vibekit action approve <stage> --by writes the approval the gate reads, and the queue drops the gate', async () => {
  const original = { ...process.env };
  isolateHome();
  process.env.VIBEKIT_HOME = tempDir('vibekit-home-');
  try {
    const root = await fresh();
    let queue = JSON.parse(await capture(() => run(['show', 'status', '--json', '--dir', root])));
    const gate = queue.find((item) => item.kind === 'gate');
    assert.equal(gate.id, 'stage 1');
    assert.equal(gate.command, 'vibekit action approve 1 --by "<name>"', 'the queue names the command that approves it');

    await assert.rejects(run(['action', 'approve', '1', '--dir', root]), /carries a name/);
    const out = await capture(() => run(['action', 'approve', '1', '--by', 'Sam', '--dir', root]));
    assert.match(out, /Assumptions reviewed by Sam/);
    assert.match(await readFile(join(root, 'vibekit/workflow/assumptions.md'), 'utf8'), /reviewed: \d{4}-\d{2}-\d{2} by Sam/);

    queue = JSON.parse(await capture(() => run(['show', 'status', '--json', '--dir', root])));
    assert.ok(!queue.some((item) => item.kind === 'gate' && item.id === 'stage 1'), 'stage 1 no longer waits');
    await assert.rejects(run(['action', 'approve', '1', '--by', 'Sam', '--dir', root]), /already reviewed/);
    assert.match(await capture(() => run(['action', 'approve', '2', '--by', 'Sam', '--dir', root])), /✔/);
    assert.match(await readFile(join(root, 'vibekit/workflow/architecture.md'), 'utf8'), /approved: \d{4}-\d{2}-\d{2} by Sam/);
  } finally {
    restoreEnv(original);
  }
});
