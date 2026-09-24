import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { readFrontMatter } from '../frontmatter.js';
import { DEFAULT_FOLDER } from '../folder/layout.js';
import { parseGuardrails } from '../folder/checks.js';

/**
 * The loads manifest, enforced. Specification §55 and §60.
 *
 * "`vibekit serve` refuses file reads outside the stage's `loads:` plus explicitly cited files,
 * and logs the attempt. An agent that wants to read more asks."
 *
 * This is the difference between a manifest and a comment. Every stage prompt already declares
 * what it may load; without something refusing the read, that declaration is a suggestion, and
 * the loading budget the whole format is built on is a number nobody keeps to.
 */

/**
 * Why a path may not be touched at all, whatever the manifest says, or null when it stays
 * inside the repository.
 *
 * This runs before any manifest check, because the manifest reasons about paths *inside* the
 * repository and `../../etc/passwd` is not one of them. Without it the loads manifest was a lock
 * on the front door of a house with no walls: an agent could read any file on the machine by
 * asking for it relative to the root.
 */
export function refuseOutside(root, path) {
  const raw = String(path ?? '');
  if (!raw.trim()) return 'No path given.';
  if (raw.includes('\0')) return 'That path contains a null byte, which no file has.';
  if (isAbsolute(raw)) return `${raw} is an absolute path. Everything an agent may touch is inside the repository, and is named relative to it.`;

  const target = resolve(root, raw);
  const inside = relative(resolve(root), target);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return `${raw} resolves outside the repository. Nothing outside it is readable or writable through this server.`;
  }
  // .git is inside the repository and is still not an agent's to read or write: its objects are
  // how every rule here is enforced, and a write into it is a rewrite of the history.
  if (normalize(inside).split(sep)[0] === '.git') return `${raw} is inside .git, which is not a file an agent reads or writes.`;
  return null;
}

/**
 * `[src/** per map.md, the requirement's Approach, memory/sessions/<today>.md]` → the patterns.
 *
 * The manifests were written to be read by a person as well as a program, so an entry is a path
 * with a clause after it, or a clause with no path at all. Taking the entry whole meant
 * `src/** per map.md` matched nothing — and through the server an implementer could not write a
 * line of application code, while `vibekit/** otherwise` protected nothing. Each entry is reduced
 * to the one token that looks like a path; entries with none are dropped.
 */
export function parseLoads(value) {
  return String(value ?? '')
    .replace(/^\[|\]$/g, '')
    // `memory:[a, b]` is a topic list, not a path, and splitting on its commas would produce
    // patterns like `memory:[domain` that match nothing and silently deny the read.
    .replace(/(\w+):\[[^\]]*\]/g, (whole) => whole.replace(/,/g, ';'))
    .split(',')
    .map((item) => item.replace(/\(.*?\)/g, '').trim())
    .map(pathToken)
    .filter(Boolean);
}

/** The one token in an entry that is a path, a glob or a topic list; null when there is none. */
export function pathToken(entry) {
  const text = String(entry ?? '').trim();
  if (!text) return null;
  if (/^\w+:\[/.test(text)) return text;
  const token = text.split(/\s+/).find((word) => /[/*]/.test(word) || /^[\w.-]+\.\w+$/.test(word));
  if (!token) return null;
  return token
    .replace(/#.*$/, '')
    // `<today>` and `<REQ>` stand for a name nobody knows yet, which is what a glob says.
    .replace(/<[^>]*>/g, '*')
    .replace(/^`|`$/g, '');
}

const toRegExp = (pattern) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
};

/**
 * Whether a path is inside this stage's manifest.
 *
 * A pattern naming a directory covers what is under it: `standards/*` means the standards, and an
 * agent told it may load them should not have to name each file.
 */
export function allowsPath(patterns, path) {
  const clean = String(path ?? '').replace(/^\.\//, '');
  return patterns.some((pattern) => {
    if (pattern.includes(':')) return false;
    if (toRegExp(pattern).test(clean)) return true;
    // A bare file name in a manifest — `plan.md`, `architecture.md` — names that file wherever it
    // is. The prompts write them that way because a person knows where plan.md lives.
    if (!pattern.includes('/') && !pattern.includes('*') && clean.endsWith(`/${pattern}`)) return true;
    // A directory covers what is under it, written either way: the stage prompts use both
    // `standards/*` and `product/sources/`, and a pattern that only matched one of those
    // silently denied half of what a stage was told it may write.
    const dir = pattern.replace(/\/\*+$/, '').replace(/\/$/, '');
    return dir !== pattern.replace(/\/$/, '') || pattern.endsWith('/')
      ? (clean === dir || clean.startsWith(`${dir}/`))
      : false;
  });
}

/**
 * Why this read is refused, or null when it is allowed.
 *
 * `cited` is the escape hatch the specification names: a file the requirement explicitly cites is
 * readable even when the manifest does not list it, because the citation is the agent being told
 * to go there. Everything else is an ask.
 */
export function refuseLoad(path, { patterns, cited = [], folder = DEFAULT_FOLDER, root = null }) {
  if (root) {
    const outside = refuseOutside(root, path);
    if (outside) return outside;
  }
  const clean = String(path ?? '').replace(/^\.\//, '');

  // Only the folder is governed. Application code and tests are the work, not the rules.
  if (!clean.startsWith(`${folder}/`) && !clean.startsWith('product/') && !clean.startsWith('workflow/') && !clean.startsWith('standards/')) return null;
  const inside = clean.startsWith(`${folder}/`) ? clean.slice(folder.length + 1) : clean;

  if (cited.some((citation) => inside === citation || clean === citation)) return null;
  if (allowsPath(patterns, inside)) return null;

  return `${clean} is outside this stage's loads manifest. The manifest is what the loading budget rests on, so this read is refused rather than counted. If you need it, write an ask: \`vibekit ask "<question>" --plain "<plain terms>"\`.`;
}

/** The manifest for a stage, taken from the prompt's own front matter. */
export function loadsFor(promptText) {
  const meta = readFrontMatter(String(promptText ?? ''));
  return {
    stage: meta.stage ?? null,
    role: meta.role ?? null,
    patterns: parseLoads(meta.loads),
    writes: parseLoads(meta.writes),
    never: parseLoads(meta.never),
    budget: meta.budget ?? null,
    gate: meta.gate ?? null,
  };
}

/**
 * Why this write is refused, or null when it is allowed.
 *
 * `never:` wins over `writes:`, because it is the narrower statement and the one a human wrote to
 * stop something specific. A denied guardrail path wins over both.
 */
export function refuseWrite(path, { writes = [], never = [], denied = [], folder = DEFAULT_FOLDER, root = null }) {
  if (root) {
    const outside = refuseOutside(root, path);
    if (outside) return outside;
  }
  const clean = String(path ?? '').replace(/^\.\//, '');

  for (const pattern of denied) {
    const prefix = String(pattern).replace(/\*+$/, '');
    if (prefix && !/^TODO/i.test(prefix) && clean.startsWith(prefix)) {
      return `${clean} is a denied path in standards/guardrails.md. That is not a judgement call: the write is refused.`;
    }
  }

  // The stage prompts write `never:` as `vibekit/** otherwise` — everything in the folder except
  // what `writes:` names. So the order is: a specific never entry (plan.md, architecture.md, a
  // named file) beats everything; an explicit writes entry beats the broad `vibekit/**`; and the
  // broad entry catches the rest. Checking the broad entry first refused the implementer's one
  // memory write and its proposals, which are the two ways it is allowed to ask for more.
  const inside = clean.startsWith(`${folder}/`) ? clean.slice(folder.length + 1) : clean;
  const matches = (patterns) => allowsPath(patterns, inside) || allowsPath(patterns, clean);
  const specific = never.filter((pattern) => !/\*\*/.test(pattern));
  const broad = never.filter((pattern) => /\*\*/.test(pattern));

  if (specific.length && matches(specific)) {
    return `${clean} is in this stage's \`never:\` list. If it needs to change, that is a proposal, not an edit.`;
  }
  if (writes.length && matches(writes)) return null;
  if (broad.length && matches(broad)) {
    return `${clean} is in this stage's \`never:\` list. If it needs to change, that is a proposal, not an edit.`;
  }
  if (writes.length) {
    return `${clean} is outside this stage's \`writes:\` list. An agent that writes where its role does not reach is how two sessions end up disagreeing about the same file.`;
  }
  return null;
}

/**
 * §22 — the allowed-command list, enforced when `serve` runs the agent.
 *
 * File-only runners get the same list as an instruction in the pointer file, and `vibekit check`
 * flags a log that mentions a denied command. Here it can simply be refused.
 */
/**
 * Characters that turn one command into two. Refused outright rather than parsed around: on a
 * platform where the runner needs a shell (a .cmd shim on Windows), `dotnet test; rm -rf /` is
 * two commands, and the allow-list has approved exactly one of them.
 */
const SHELL_METACHARACTERS = /[;&|`$<>(){}\n\r]|\$\(|\|\|/;

/** An allowed entry matches as whole words from the start, so `dotnet test` does not approve `dotnet testx`. */
const matchesEntry = (text, entry) => {
  const words = String(entry).split(/\s+/).filter(Boolean);
  const given = String(text).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word, index) => given[index] === word);
};

export function refuseCommand(command, guardrailsText) {
  const { allowedCommands, deniedCommands } = parseGuardrails(guardrailsText);
  const text = String(command ?? '').trim();
  if (!text) return 'No command given.';

  if (SHELL_METACHARACTERS.test(text)) {
    return 'That command contains a shell operator. One allowed command is one command; chaining, piping or substitution is refused before the allow-list is even consulted.';
  }

  const head = text.split(/\s+/)[0];
  for (const denied of deniedCommands) {
    const name = String(denied).split(/\s{2,}|\s+—\s+/)[0].trim();
    if (name && !/^TODO/i.test(name) && matchesEntry(text, name)) {
      return `\`${name}\` is on the denied list in standards/guardrails.md.`;
    }
  }

  const real = allowedCommands.map((entry) => String(entry).split(/\s{2,}|\s+—\s+/)[0].trim()).filter((name) => name && !/^TODO/i.test(name));
  if (!real.length) return null;
  // The prefix match this replaced approved `dotnet testx` on the strength of `dotnet test`.
  if (real.some((name) => matchesEntry(text, name))) return null;

  return `\`${head}\` is not on the allowed list in standards/guardrails.md. Allowed: ${real.join(', ')}. A command nobody listed is a command nobody agreed to run on this repository.`;
}
