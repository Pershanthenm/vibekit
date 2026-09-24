import { createHash } from 'node:crypto';
import { estimateCodeTokens } from '../tokens.js';

/**
 * The atomic retrievable thing: a line span within a file, usually one symbol.
 *
 * Granularity decides context quality more than ranking does. Serving whole files spends the
 * budget on imports and boilerplate; serving arbitrary windows serves half a function. A span
 * that lines up with a symbol is the unit a person would have pasted.
 */

export const UnitKind = Object.freeze({
  File: 'File',
  Type: 'Type',
  Method: 'Method',
  Function: 'Function',
  Property: 'Property',
  Interface: 'Interface',
  Component: 'Component',
  Endpoint: 'Endpoint',
  Entity: 'Entity',
  Migration: 'Migration',
  Configuration: 'Configuration',
  Test: 'Test',
  Document: 'Document',
  Fragment: 'Fragment',
});

export const sha256 = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/** Deliberately conservative; see src/tokens.js for why the two estimates differ. */
export const estimateTokens = estimateCodeTokens;

/**
 * Identity survives a move but not an edit.
 *
 * The path is deliberately left out, so a file that moves keeps its units — and with them any
 * ranking history and pins that refer to them. A File unit has no symbol to identify it by and
 * falls back to its path, so its id does change on a move; the index detects that case by content
 * hash and remaps it (see indexStore.reconcile).
 */
export function unitId(kind, symbolPath, repositoryPath) {
  const key = `${kind}\0${symbolPath || repositoryPath}`;
  return `u_${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 10)}`;
}

/**
 * A span is 1-based and inclusive at both ends, because that is what an editor shows and what an
 * agent cites. Converting to 0-based indices happens only at the point text is sliced.
 */
export const lineSpan = (start, end) => Object.freeze([start, end]);

export const spanText = (lines, [start, end]) => lines.slice(start - 1, end).join('\n');

export function makeUnit({ repositoryPath, kind, span, symbolPath = null, text, classification = null, indexedAtUtc = null }) {
  const content = text ?? '';
  return Object.freeze({
    id: unitId(kind, symbolPath, repositoryPath),
    repositoryPath,
    kind,
    span: lineSpan(span[0], span[1]),
    symbolPath,
    contentHash: sha256(content),
    tokenEstimate: estimateTokens(content),
    classification,
    indexedAtUtc: indexedAtUtc ?? new Date().toISOString(),
  });
}

/** A unit is renderable on its own, or it ships with the file header that makes it readable. */
export const needsHeader = (unit) => unit.kind !== UnitKind.File && unit.kind !== UnitKind.Document;
