import { join } from 'node:path';
import { DEFAULT_FOLDER } from './folder/layout.js';
import { readText } from './fsutil.js';

/**
 * Who may approve what. Specification §57 and §51.
 *
 * `agents/humans.md` is the only place a person's authority is recorded, and this is the only
 * thing that reads it. That matters because the same file answers three separate questions —
 * which email is which person, what that person may approve, and whose name goes in a commit
 * trailer — and three different readers would eventually disagree about one of them.
 *
 * An email that is not in the file is not an error. §57: it "sees a read-only page or nothing,
 * per a setting". Guessing a role from a domain would be the obvious shortcut and is exactly the
 * wrong one: authority is a thing a person wrote down, not a thing inferred from an address.
 */

export const ROLES = Object.freeze(['product owner', 'tech lead', 'security']);

/** §57's action table: which role may do each thing the tracker offers. */
export const ACTION_ROLES = Object.freeze({
  answer: ['product owner', 'tech lead', 'security'],
  approve: ['product owner', 'tech lead', 'security'],
  reject: ['product owner', 'tech lead', 'security'],
  reorder: ['product owner', 'tech lead'],
  defer: ['product owner', 'tech lead'],
  size: ['tech lead'],
  review: ['tech lead'],
  add: ['product owner'],
  quick: ['tech lead'],
  note: ['product owner', 'tech lead', 'security'],
  memory: ['tech lead'],
  unhold: ['tech lead'],
  done: ['product owner', 'tech lead'],
  release: ['tech lead'],
});

/** Nothing on the page may touch these, whoever is asking. §57: those are pull requests. */
export const NEVER_FROM_TRACKER = Object.freeze(['standards/', 'guardrails.md', 'architecture.md', 'src/', 'tests/']);

export const humansPath = (root, folder = DEFAULT_FOLDER) => join(root, folder, 'agents/humans.md');

const section = (text, heading) => String(text ?? '').replace(/\r\n/g, '\n')
  .match(new RegExp(`^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|(?![\\s\\S]))`, 'im'))?.[1] ?? '';

const EMAIL = /<([^>@\s]+@[^>\s]+)>|\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/;

/**
 * The `## Approvers` table: role, name, and what they may approve.
 *
 * An email is taken from the name cell, written either as `Ada Lovelace <ada@example.com>` or as
 * the bare address. A cell still reading TODO is a role nobody has filled, which is reported
 * rather than treated as a person.
 */
export function parseApprovers(text) {
  const rows = section(text, 'Approvers')
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && !/^-+$/.test(cells[0]) && !/^role$/i.test(cells[0]));

  return rows.map(([role, name, mayApprove]) => {
    const matched = String(name ?? '').match(EMAIL);
    const email = (matched?.[1] ?? matched?.[2] ?? null)?.toLowerCase() ?? null;
    return {
      role: String(role ?? '').toLowerCase(),
      name: String(name ?? '').replace(EMAIL, '').replace(/[<>]/g, '').trim() || null,
      email,
      mayApprove: String(mayApprove ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      unfilled: /^TODO/i.test(String(name ?? '').trim()) || !email,
    };
  });
}

/**
 * §57 — "Without a named security approver the tech lead holds the role, and the security report
 * says so." The fallback is recorded on the result rather than applied silently.
 */
export function resolveRoles(approvers) {
  const filled = approvers.filter((approver) => !approver.unfilled);
  const security = filled.find((approver) => approver.role === 'security');
  const techLead = filled.find((approver) => approver.role === 'tech lead');
  return {
    approvers: filled,
    unfilled: approvers.filter((approver) => approver.unfilled).map((approver) => approver.role),
    securityHeldByTechLead: !security && Boolean(techLead),
  };
}

export async function loadHumans(root, folder = DEFAULT_FOLDER) {
  const text = await readText(humansPath(root, folder));
  const approvers = parseApprovers(text ?? '');
  return { ...resolveRoles(approvers), text: text ?? '', declared: approvers.length > 0 };
}

/**
 * The person behind an email, or null.
 *
 * Case-insensitive, because an identity provider may hand back an address in any case and a
 * person locked out of their own tracker by capitalisation would reasonably conclude the tool is
 * broken.
 */
export function identify(humans, email) {
  const wanted = String(email ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const approver = humans.approvers.find((entry) => entry.email === wanted);
  if (!approver) return null;

  const roles = [approver.role];
  // The stand-in role is granted here, once, so every caller sees the same authority.
  if (approver.role === 'tech lead' && humans.securityHeldByTechLead) roles.push('security');
  return { ...approver, roles };
}

/** Why this person may not do this, or null when they may. */
export function refuseAction(person, action) {
  if (!person) return 'Your email is not in agents/humans.md, so this page is read-only for you. Someone named there can add you.';

  const allowed = ACTION_ROLES[action];
  if (!allowed) return `"${action}" is not an action the tracker offers.`;
  if (person.roles.some((role) => allowed.includes(role))) return null;

  return `${action} needs the ${allowed.join(' or ')} role. agents/humans.md gives you ${person.roles.join(' and ')}.`;
}

/** §57 — nothing on the page can edit code, standards, guardrails or architecture content. */
export const refusePath = (path) => (NEVER_FROM_TRACKER.some((prefix) => String(path ?? '').includes(prefix))
  ? `${path} cannot be changed from the tracker. That is a pull request: a rule or a piece of code changed from a phone is a rule nobody reviewed.`
  : null);
