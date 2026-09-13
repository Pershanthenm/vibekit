// A tunnel puts this machine on the public internet, so the failures matter as much as the happy
// path: a missing cloudflared, one that dies on startup, and one that says nothing at all must
// each end with a clear message rather than a command that appears to hang.
//
// cloudflared itself is not required to run these. Every case is driven by a stand-in process,
// which is what lets them assert on the parsing and the timeouts rather than on Cloudflare.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TUNNEL_URL, installHint, openTunnel } from '../src/tunnel.js';

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
