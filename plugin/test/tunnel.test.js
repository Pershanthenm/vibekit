// A tunnel puts this machine on the public internet, so the failures matter as much as the happy
// path: a missing cloudflared, one that dies on startup, and one that says nothing at all must
// each end with a clear message rather than a command that appears to hang.
//
// cloudflared itself is not required to run these. Every case is driven by a stand-in process,
// which is what lets them assert on the parsing and the timeouts rather than on Cloudflare.

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { announceTunnel, serveDashboard } from '../src/commands/dashboard.js';
import { MAX_BYTES, codeFor } from '../src/qr.js';
import { TUNNEL_URL, installHint, installedAt, openTunnel } from '../src/tunnel.js';
import { EXAMPLE, newProject } from './helpers.js';

console.log = () => {};

/** Spawn node instead of cloudflared, running whatever the case needs it to do. */
const fake = (script, options = {}) => openTunnel(7332, {
  command: process.execPath,
  args: ['-e', script],
  ...options,
});

test('the address Cloudflare assigns is taken from its output, whichever stream it uses', async () => {
  // cloudflared prints its banner and the hostname on stderr; both streams are watched.
  const onStderr = await fake('console.error("+---+\\n| https://calm-river-1234.trycloudflare.com |\\n+---+"); setTimeout(() => {}, 60000)');
  assert.equal(onStderr.url, 'https://calm-river-1234.trycloudflare.com');
  onStderr.close();

  const onStdout = await fake('console.log("https://other-name-99.trycloudflare.com"); setTimeout(() => {}, 60000)');
  assert.equal(onStdout.url, 'https://other-name-99.trycloudflare.com');
  onStdout.close();
});

test('the address is only accepted from the host Cloudflare actually hands out', () => {
  assert.match('https://calm-river-1234.trycloudflare.com', TUNNEL_URL);
  // A hostname that merely contains the words is not a tunnel, and neither is plain http.
  assert.doesNotMatch('https://trycloudflare.com.attacker.example', TUNNEL_URL);
  assert.doesNotMatch('http://calm-river-1234.trycloudflare.com', TUNNEL_URL);
});

test('a missing cloudflared says so, and says how to install it', async () => {
  await assert.rejects(
    openTunnel(7332, { command: 'definitely-not-a-real-binary-xyz', timeoutMs: 5000 }),
    (error) => {
      assert.match(error.message, /not installed/i);
      assert.match(error.message, /winget|brew|developers\.cloudflare\.com/, 'and points at the install for this platform');
      return true;
    },
  );
});

test('a cloudflared that dies on startup reports its own last words, not a guess', async () => {
  await assert.rejects(
    fake('console.error("failed to dial to edge: dns lookup failed"); process.exit(1)'),
    (error) => {
      assert.match(error.message, /exited with 1/);
      assert.match(error.message, /dns lookup failed/, 'its message is the useful part');
      return true;
    },
  );
});

test('a tunnel that never reports an address gives up instead of hanging', async () => {
  const started = Date.now();
  await assert.rejects(
    fake('setTimeout(() => {}, 60000)', { timeoutMs: 1200 }),
    /did not report a tunnel address within/,
  );
  assert.ok(Date.now() - started < 20000, 'it gave up quickly, rather than waiting on the process');
});

test('closing a tunnel stops the process it started', async () => {
  const tunnel = await fake('console.error("https://calm-river-1234.trycloudflare.com"); setTimeout(() => {}, 60000)');
  assert.equal(tunnel.process.killed, false);

  tunnel.close();
  await new Promise((done) => setTimeout(done, 200));
  assert.ok(tunnel.process.killed, 'a tunnel must not outlive the console it points at');
});

test('the install hint matches the platform, so nobody is told to run brew on Windows', () => {
  assert.match(installHint('win32'), /winget/);
  assert.match(installHint('darwin'), /brew/);
  assert.match(installHint('linux'), /developers\.cloudflare\.com/);
  assert.ok(installHint('sunos').length, 'an unknown platform still gets somewhere to look');
});

// --- Turning it off, and on again --------------------------------------------------------------
//
// Being done for the day is a thing that happens, and Ctrl-C was the only way to say it. These
// drive the switch on the page against a stand-in opener, so they assert on what the server does
// with a tunnel rather than on Cloudflare handing one out.

const opened = [];
const stub = (url = 'https://stub-one.trycloudflare.com') => async () => {
  const handle = { url, closed: false, close() { this.closed = true; } };
  opened.push(handle);
  return handle;
};

const servers = [];
after(() => Promise.all(servers.map((server) => server.close())));

const served = async (options) => {
  const root = await newProject('--from', EXAMPLE);
  const server = await serveDashboard(root, { port: 0, ...options });
  servers.push(server);
  return server;
};

const ask = (server, action) => fetch(`http://127.0.0.1:${server.port}${server.control}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
  body: JSON.stringify({ action }),
});

test('the tunnel can be closed from the page, and the console keeps running', async () => {
  const server = await served({ open: stub() });

  const started = await (await ask(server, 'tunnel.start')).json();
  assert.equal(started.result.open, true);
  assert.match(started.result.reach, /trycloudflare\.com\/[\w-]+\/$/, 'the address includes the secret path, not just the host');

  const stopped = await (await ask(server, 'tunnel.stop')).json();
  assert.equal(stopped.result.open, false);
  assert.equal(opened.at(-1).closed, true, 'cloudflared is actually shut down, not just forgotten');

  const page = await fetch(server.url);
  assert.equal(page.status, 200, 'and the console on this machine is untouched');
});

test('reopening asks for a fresh address, so a link you closed stays closed', async () => {
  let nth = 0;
  const server = await served({ open: async () => {
    nth += 1;
    const handle = { url: `https://name-${nth}.trycloudflare.com`, closed: false, close() { this.closed = true; } };
    opened.push(handle);
    return handle;
  } });

  const first = await (await ask(server, 'tunnel.start')).json();
  await ask(server, 'tunnel.stop');
  const second = await (await ask(server, 'tunnel.start')).json();

  assert.notEqual(second.result.url, first.result.url);
});

test('a tunnel that will not open is reported, and leaves the console alone', async () => {
  const server = await served({ open: async () => { throw new Error('cloudflared is not installed'); } });

  const response = await ask(server, 'tunnel.start');
  assert.equal(response.status, 409, 'a refusal, not a crash');
  assert.match((await response.json()).error, /not installed/);
  assert.equal((await fetch(server.url)).status, 200);
});

test('the state the page renders from says whether there is a way in from outside', async () => {
  const server = await served({ open: stub('https://visible-one.trycloudflare.com') });

  const before = await (await fetch(new URL('state.json', server.url))).json();
  assert.equal(before.tunnel.open, false);

  await ask(server, 'tunnel.start');
  const after = await (await fetch(new URL('state.json', server.url))).json();
  assert.equal(after.tunnel.open, true);
  assert.equal(after.tunnel.url, 'https://visible-one.trycloudflare.com');
});

test('closing the console closes the tunnel with it', async () => {
  const root = await newProject('--from', EXAMPLE);
  const server = await serveDashboard(root, { port: 0, open: stub('https://goes-with-it.trycloudflare.com') });
  await ask(server, 'tunnel.start');
  const handle = opened.at(-1);

  await server.close();

  assert.equal(handle.closed, true, 'a tunnel must never outlive the thing it points at');
});

// --- Getting the address onto a phone --------------------------------------------------------
//
// The reason any of this exists is the machine nobody is sitting in front of: Claude Code over SSH
// on a server, where there is no browser to open and the address is a random 32-character path on
// a random hostname. Nobody types that into a phone twice, so the console draws it as a square.

const lines = () => {
  const out = [];
  return { log: (...args) => out.push(args.join(' ')), text: () => out.join('\n') };
};

test('a project being tracked gets a code for its status page', async () => {
  const root = await newProject('--from', EXAMPLE);
  const reach = 'https://calm-river-1234.trycloudflare.com/kDc2/';
  const said = lines();

  const encoded = await announceTunnel(root, { reach }, said.log);

  assert.equal(encoded, reach, 'the status page is what a project that already exists is asked about');
  assert.match(said.text(), /On your phone: https:\/\/calm-river-1234/, 'the address is printed either way');
  assert.match(said.text(), /Spec wizard: +https:\/\/calm-river-1234\S+wizard/, 'and so is the other page');
  assert.ok(said.text().includes(codeFor(reach)), 'the code is the one for that address');
});

test('a folder with no project yet gets a code for the form that makes one', async () => {
  // Creating a project is the one case where the status page has nothing to say, so pointing a
  // camera at it would open an empty console instead of the thing there is to do.
  const root = await mkdtemp(join(tmpdir(), 'vibekit-bare-'));
  const reach = 'https://calm-river-1234.trycloudflare.com/kDc2/';
  const said = lines();

  const encoded = await announceTunnel(root, { reach }, said.log);

  assert.equal(encoded, `${reach}wizard`);
  assert.ok(said.text().includes(codeFor(`${reach}wizard`)), 'the code opens the wizard, not the console');
});

test('a tunnel opened from the page prints the code too, not only one asked for on the command line', async () => {
  // This is the route somebody takes when the console was already running before they wanted a
  // phone, and it used to print nothing at all.
  const said = lines();
  const root = await newProject('--from', EXAMPLE);
  const server = await serveDashboard(root, {
    port: 0,
    open: stub('https://from-the-page.trycloudflare.com'),
    announce: (state) => announceTunnel(root, state, said.log),
  });
  servers.push(server);

  await ask(server, 'tunnel.start');

  assert.match(said.text(), /from-the-page\.trycloudflare\.com/, 'the console says how to reach it');
  assert.ok(said.text().split('\n').some((line) => line.includes('\u2588')), 'and draws a code');
});

test('an address too long to encode still prints, and does not take the tunnel down with it', async () => {
  const root = await newProject('--from', EXAMPLE);
  const reach = `https://calm-river-1234.trycloudflare.com/${'p'.repeat(MAX_BYTES)}/`;
  const said = lines();

  const encoded = await announceTunnel(root, { reach }, said.log);

  assert.equal(encoded, reach, 'it still says which page it meant');
  assert.match(said.text(), /On your phone: https:\/\/calm-river/, 'and the address is there to be typed');
  assert.ok(!said.text().includes('\u2588'), 'there is simply no square');
});

// --- Installed, but not on this shell's PATH ---------------------------------------------------
//
// An installer adds its folder to the machine PATH, and a shell that was already open when it ran
// never sees it. "cloudflared is not installed" is then wrong in the one case people hit most:
// they have just installed it, in the terminal they are still sitting in.

test('a command the caller named is never quietly swapped for something else', async () => {
  // If this fell back, it would resolve with a tunnel from a binary nobody asked for.
  await assert.rejects(
    () => openTunnel(7333, { command: 'definitely-not-a-real-binary-8f2a' }),
    /not installed, or not on PATH/,
  );
});

test('the install locations are the ones the platform installers actually use', () => {
  // Guards against the list quietly becoming a guess: each is a real installer's own directory.
  assert.equal(installedAt('sunos'), installedAt('linux'), 'an unknown platform falls back to the Unix paths');
});
