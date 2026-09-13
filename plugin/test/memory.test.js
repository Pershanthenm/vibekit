// Managing what the agents remember.
//
// These run against a stand-in agentmemory, but the shapes it answers with are not invented: every
// one was observed against a running agentmemory 0.9.29, and the whole client was round-tripped
// against it — save, list, search, delete, and delete an id that was already gone.
//
// That run corrected something these tests had been asserting happily for days. `smart-search`
// searches *session observations*, which carry an obsId and cannot be deleted; memories live
// behind `search`, wrapped in `observation`, with the `mem_…` id that governance accepts. The
// stand-in had been answering smart-search with memory-shaped rows, so the tests passed against a
// server that does not exist.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { run } from '../src/cli.js';
import { CAPTURE_KINDS, forgetMemories, isCaptured, listMemories, remember, searchMemories } from '../src/memory.js';
import { loadProject } from '../src/project.js';
import { EXAMPLE, newProject } from './helpers.js';

console.log = () => {};

const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((closed) => server.close(closed)))));

/**
 * A stand-in for agentmemory, recording what it was asked for. It answers in the shapes the real
 * handlers answer in, and nothing more.
 */
async function fakeMemory({ memories = [], deleted = null } = {}) {
  const seen = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, 'http://localhost');
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      seen.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      response.setHeader('content-type', 'application/json');
      if (url.pathname === '/agentmemory/memories') {
        return response.end(JSON.stringify({ memories, total: memories.length, offset: 0, limit: null }));
      }
      if (url.pathname === '/agentmemory/governance/memories') {
        const asked = body?.memoryIds ?? [];
        return response.end(JSON.stringify({ success: true, deleted: deleted ?? asked.length, total: asked.length }));
      }
      // The shape a real agentmemory returns: memories come back from `search`, each wrapped in
      // `observation`. `smart-search` is a different thing entirely — session observations, with
      // an obsId and no memory to delete — so it answers that way here too.
      if (url.pathname === '/agentmemory/search') {
        return response.end(JSON.stringify({ results: memories.map((memory) => ({ observation: memory, score: 1 })) }));
      }
      if (url.pathname === '/agentmemory/smart-search') {
        return response.end(JSON.stringify({ results: [{ obsId: 'obs_something', title: 'Bash', type: 'command_run' }] }));
      }
      return response.end(JSON.stringify({ success: true }));
    });
  });
  servers.push(server);
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return { seen, url: `http://127.0.0.1:${server.address().port}` };
}

const projectWith = (url, extra = {}) => ({
  project: { name: 'shopping' },
  memory: { provider: 'agentmemory', url, recallLimit: 5, capture: [...CAPTURE_KINDS], ...extra },
});

const stored = (id, content, extra = {}) => ({
  id,
  title: content.slice(0, 80),
  content,
  type: 'fact',
  createdAt: '2026-09-01T10:00:00.000Z',
  version: 1,
  isLatest: true,
  concepts: ['vibekit', 'project:shopping'],
  ...extra,
});

// --- Seeing what it holds ---

test('every row carries its id, because the text alone is only a complaint', async () => {
  const fake = await fakeMemory({ memories: [stored('mem_a', 'The revoke endpoint is DELETE /devices/:id')] });

  const [memory] = await listMemories(projectWith(fake.url));

  assert.equal(memory.id, 'mem_a');
  assert.equal(memory.content, 'The revoke endpoint is DELETE /devices/:id');
});

test('only current versions are listed, so a fact and its own retraction are not shown as two beliefs', async () => {
  const fake = await fakeMemory({ memories: [stored('mem_a', 'anything')] });

  await listMemories(projectWith(fake.url), { limit: 10 });

  assert.equal(fake.seen[0].query.latest, 'true');
  assert.equal(fake.seen[0].query.limit, '10');
});

test('memories belonging to another project are not shown as this one has them', async () => {
  const fake = await fakeMemory({ memories: [
    stored('mem_mine', 'ours', { project: 'shopping' }),
    stored('mem_theirs', 'theirs', { project: 'banking', concepts: ['vibekit', 'project:banking'] }),
  ] });

  const memories = await listMemories(projectWith(fake.url));

  assert.deepEqual(memories.map((memory) => memory.id), ['mem_mine']);
});

test('newest first, because the last thing it learned is the thing most likely to be wrong', async () => {
  const fake = await fakeMemory({ memories: [
    stored('mem_old', 'old', { createdAt: '2026-01-01T00:00:00.000Z' }),
    stored('mem_new', 'new', { createdAt: '2026-09-01T00:00:00.000Z' }),
  ] });

  assert.deepEqual((await listMemories(projectWith(fake.url))).map((memory) => memory.id), ['mem_new', 'mem_old']);
});

test('a search keeps the ids that a recall throws away', async () => {
  const fake = await fakeMemory({ memories: [stored('mem_found', 'sessions expire after 30 days')] });

  const [found] = await searchMemories(projectWith(fake.url), 'sessions');

  assert.equal(found.id, 'mem_found');
  assert.equal(fake.seen.at(-1).path, '/agentmemory/search', 'memories live behind search, not smart-search');
  assert.equal(fake.seen.at(-1).body.query, 'sessions');
});

test('a session observation is never offered as a memory you can correct', async () => {
  // smart-search returns what happened in past sessions: an obsId, and nothing governance can
  // delete. Offering one as a memory would give you an id that no delete will ever accept.
  const fake = await fakeMemory({ memories: [{ obsId: 'obs_1', title: 'Bash', type: 'command_run' }] });

  assert.deepEqual(await searchMemories(projectWith(fake.url), 'bash'), []);
});

// --- Taking it back ---

test('forgetting sends the ids as agentmemory expects them, and deletes nothing else', async () => {
  const fake = await fakeMemory();

  const result = await forgetMemories(projectWith(fake.url), ['mem_a', 'mem_b'], 'because it was wrong');

  const call = fake.seen.at(-1);
  assert.equal(call.method, 'DELETE');
  assert.equal(call.path, '/agentmemory/governance/memories');
  assert.deepEqual(call.body.memoryIds, ['mem_a', 'mem_b']);
  assert.equal(call.body.reason, 'because it was wrong');
  assert.deepEqual(result, { deleted: 2, asked: 2 });
});

test('an id that was already gone is not reported as a deletion', async () => {
  const fake = await fakeMemory({ deleted: 1 });

  assert.deepEqual(await forgetMemories(projectWith(fake.url), ['mem_here', 'mem_gone']), { deleted: 1, asked: 2 });
});

test('forgetting nothing is refused rather than sent', async () => {
  const fake = await fakeMemory();

  await assert.rejects(() => forgetMemories(projectWith(fake.url), []), /Which memories/);
  assert.equal(fake.seen.length, 0);
});

// --- Choosing what it records by itself ---

test('a kind that is switched off is never written', async () => {
  const fake = await fakeMemory();
  const project = projectWith(fake.url, { capture: ['spec'] });

  assert.equal(await remember(project, 'a feature was finished', ['feature:001', 'done']), false);
  assert.equal(await remember(project, 'a spec was written', ['feature:001', 'spec']), true);
  assert.deepEqual(fake.seen.map((call) => call.body.content), ['a spec was written']);
});

test('what you save yourself is always kept, whatever capture says', () => {
  const project = projectWith('http://localhost:1', { capture: [] });

  assert.equal(isCaptured(project, ['note']), true, 'capture governs what it records unasked, not what you tell it');
  assert.equal(isCaptured(project, ['feature:001', 'done']), false);
});

test('the project file records the choice, and refuses a kind that does not exist', async () => {
  const root = await newProject('--from', EXAMPLE);

  await run(['memory', '--dir', root, 'capture', 'spec', 'security']);
  assert.deepEqual((await loadProject(root)).memory.capture, ['spec', 'security']);

  await assert.rejects(() => run(['memory', '--dir', root, 'capture', 'gossip']), /nothing called gossip/);
  assert.deepEqual((await loadProject(root)).memory.capture, ['spec', 'security'], 'and a refused change changes nothing');

  await run(['memory', '--dir', root, 'capture', 'none']);
  assert.deepEqual((await loadProject(root)).memory.capture, []);
});
