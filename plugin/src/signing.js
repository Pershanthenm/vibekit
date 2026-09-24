import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists, ownerOnly, readText, writeText } from './fsutil.js';

/**
 * Signed extension releases. Extensions and Integration Spec §5.1.
 *
 * "For internal publication, signed releases and a known key. Not needed for a team's own kit on
 * day one; required before anything is published to people outside the organisation."
 *
 * Ed25519 over a canonical digest of every file in the extension, with the public key beside the
 * signature so the installer can name the signer, and a trust store on the machine so "known key"
 * means a key somebody on this machine decided to trust. Nothing here reaches the network: a key is
 * a file a person hands over, which is the whole point.
 */

export const SIGNATURE_FILE = 'extension.sig';
export const trustStorePath = () => join(process.env.VIBEKIT_HOME || join(homedir(), '.vibekit'), 'trusted-keys.json');

/** A fresh Ed25519 pair, PEM-encoded. The private half is the publisher's to keep. */
export function keygen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: fingerprintOf(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
  };
}

export const fingerprintOf = (publicKeyPem) => createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else if (rel !== SIGNATURE_FILE) out.push(rel);
  }
  return out;
}

/** One digest over every file, sorted by path, name and content both counted. */
export async function digestOf(dir) {
  const hash = createHash('sha256');
  for (const file of await walk(dir)) {
    hash.update(`${file}\n`);
    hash.update((await readText(join(dir, file))) ?? '');
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** Write `extension.sig`: the digest, its signature and the signer's public key. */
export async function signExtension(dir, privateKeyPem, { now = () => new Date() } = {}) {
  const key = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  const digest = await digestOf(dir);
  const signature = cryptoSign(null, Buffer.from(digest), key).toString('base64');
  const record = { alg: 'ed25519', digest, signature, signer: fingerprintOf(publicKey), publicKey, signedAt: now().toISOString() };
  await writeText(join(dir, SIGNATURE_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function readTrusted() {
  try {
    return JSON.parse((await readText(trustStorePath())) ?? '{}');
  } catch {
    return {};
  }
}

/** Trust a publisher's public key under a name. Refuses a private key handed over by mistake. */
export async function trustKey(name, publicKeyPem) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(name))) throw new Error('a trusted key needs a lowercase name: acme, platform-team');
  if (/PRIVATE KEY/.test(String(publicKeyPem))) throw new Error('that is a private key. Only the public half is trusted here; keep the private one where it was.');
  const fingerprint = fingerprintOf(publicKeyPem);
  const trusted = await readTrusted();
  trusted[name] = { publicKey: String(publicKeyPem).trim(), fingerprint, added: new Date().toISOString() };
  await writeText(trustStorePath(), `${JSON.stringify(trusted, null, 2)}\n`);
  await ownerOnly(trustStorePath()).catch(() => {});
  return { name, fingerprint };
}

export async function untrustKey(name) {
  const trusted = await readTrusted();
  const was = Boolean(trusted[name]);
  delete trusted[name];
  await writeText(trustStorePath(), `${JSON.stringify(trusted, null, 2)}\n`);
  return was;
}

/**
 * The signature's standing: absent, invalid, or valid — and, when valid, whether the signer's key
 * is one this machine trusts. Each is a different fact, and the installer treats them differently.
 */
export async function verifySignature(dir) {
  const path = join(dir, SIGNATURE_FILE);
  if (!(await exists(path))) return { signed: false, valid: false, trusted: false, signer: null, why: 'unsigned' };
  let record;
  try {
    record = JSON.parse((await readText(path)) ?? '');
  } catch {
    return { signed: true, valid: false, trusted: false, signer: null, why: `${SIGNATURE_FILE} is not readable` };
  }
  if (record.alg !== 'ed25519' || !record.publicKey || !record.signature || !record.digest) return { signed: true, valid: false, trusted: false, signer: null, why: `${SIGNATURE_FILE} is not a signature this build understands` };
  const digest = await digestOf(dir);
  if (digest !== record.digest) return { signed: true, valid: false, trusted: false, signer: record.signer ?? null, why: 'the contents changed after they were signed' };
  let valid = false;
  try {
    valid = cryptoVerify(null, Buffer.from(digest), createPublicKey(record.publicKey), Buffer.from(record.signature, 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) return { signed: true, valid: false, trusted: false, signer: record.signer ?? null, why: 'the signature does not verify against the key beside it' };
  const signer = fingerprintOf(record.publicKey);
  const trusted = Object.entries(await readTrusted()).find(([, entry]) => entry.fingerprint === signer);
  return { signed: true, valid: true, trusted: Boolean(trusted), signer, trustedAs: trusted?.[0] ?? null, signedAt: record.signedAt ?? null, why: trusted ? `signed by ${trusted[0]} (${signer.slice(0, 12)}…)` : `signed by an unknown key ${signer.slice(0, 12)}… — vibekit settings trust <name> <public-key-file> to trust it` };
}
