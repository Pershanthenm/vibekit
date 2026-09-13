// The QR encoder behind the address the console prints for your phone.
//
// What these can and cannot prove is worth stating. An encoder is only correct if a *decoder*
// agrees, and there is no decoder here — the project has no dependencies. So while it was being
// written, its output was decoded by an independent implementation (jsQR 1.4.0) across every
// version from 1 to 9, at each version's exact capacity: twelve codes, twelve correct reads. That
// run found three real faults — reversed format bits, a missing version-information block, and
// versions 8 and 9 written as one block group when they have two.
//
// These tests pin what that run established. The golden matrix below is one of the codes that
// decoded correctly, so a change that breaks the encoder changes it. The rest are the invariants
// those faults violated, written down so they cannot come back quietly.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BYTES, encode, render, versionFor } from '../src/qr.js';

console.log = () => {};

const draw = (matrix) => matrix.map((row) => row.map((cell) => (cell ? '#' : '.')).join('')).join('\n');

/** The largest byte count that still fits a version — found by asking, not by a second table. */
function versionCapacity(version) {
  let bytes = 0;
  while (bytes + 1 <= MAX_BYTES && versionFor(bytes + 1) <= version) bytes += 1;
  return bytes;
}

// --- What the specification fixes -----------------------------------------------------------

// Total codewords per version, from the specification. Versions 8 and 9 were wrong precisely
// because a plausible-looking block table can still add up to the wrong number.
const TOTAL_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292 };

test('no version claims more data than it has room for', () => {
  for (const [version, total] of Object.entries(TOTAL_CODEWORDS)) {
    const dataCodewords = versionCapacity(Number(version)) + 2;
    assert.ok(dataCodewords < total, `version ${version} must leave room for error correction`);
  }
});

test('the smallest version that fits is the one chosen, and one byte more moves up', () => {
  for (let version = 1; version <= 8; version += 1) {
    const fits = versionCapacity(version);
    assert.equal(versionFor(fits), version);
    assert.equal(versionFor(fits + 1), version + 1, `one byte past version ${version} must not stay there`);
  }
  assert.equal(versionFor(MAX_BYTES), 9);
});

test('text that does not fit is refused, not truncated', () => {
  assert.throws(() => encode('x'.repeat(MAX_BYTES + 1)), /more than this encoder holds/);
});

// --- Structure ------------------------------------------------------------------------------

test('the three finder patterns are where a reader looks for them', () => {
  const matrix = encode('https://example.trycloudflare.com/abc/');
  const width = matrix.length;
  for (const [top, left] of [[0, 0], [0, width - 7], [width - 7, 0]]) {
    assert.deepEqual(matrix[top].slice(left, left + 7), [1, 1, 1, 1, 1, 1, 1], 'the outer ring');
    assert.deepEqual(matrix[top + 3].slice(left + 2, left + 5), [1, 1, 1], 'the solid centre');
    assert.equal(matrix[top + 1][left + 1], 0, 'and the gap between them');
  }
  assert.equal(matrix[width - 8][8], 1, 'the module that is always dark');
});

test('the timing patterns alternate all the way across', () => {
  const matrix = encode('timing');
  for (let index = 8; index < matrix.length - 8; index += 1) {
    assert.equal(matrix[6][index], index % 2 === 0 ? 1 : 0, `row 6, column ${index}`);
    assert.equal(matrix[index][6], index % 2 === 0 ? 1 : 0, `column 6, row ${index}`);
  }
});

test('versions 7 and up carry their version number, and smaller ones have nowhere to', () => {
  // The block sits beside the top-right finder. Its absence is what stopped version 9 decoding.
  const big = encode('u'.repeat(versionCapacity(7)));
  const width = big.length;
  const block = [0, 1, 2, 3, 4, 5].flatMap((row) => [0, 1, 2].map((column) => big[row][width - 11 + column]));
  assert.ok(block.some(Boolean), 'version 7 must write a version information block');

  assert.equal(encode('small').length, 21, 'and version 1 is too small to have one');
});

// --- A code that is known to read -------------------------------------------------------------

const HELLO = [
  '#######.##.#..#######',
  '#.....#..##.#.#.....#',
  '#.###.#..####.#.###.#',
  '#.###.#.#..#..#.###.#',
  '#.###.#.#...#.#.###.#',
  '#.....#.#.##..#.....#',
  '#######.#.#.#.#######',
  '........#####........',
  '#...#.######.##.#...#',
  '...###..#.###..#.####',
  '#.##..#.#.##..###..#.',
  '###..#...#...##.#....',
  '..#.###..#..###...##.',
  '........###.###..#.##',
  '#######.##..##...#.#.',
  '#.....#.#..##..#...#.',
  '#.###.#.#..#..###.#.#',
  '#.###.#.#..##....#.##',
  '#.###.#..###..####...',
  '#.....#..#...##......',
  '#######.#...#####.#.#',
].join('\n');

test('a known code comes out exactly as it did when a real decoder read it', () => {
  assert.equal(draw(encode('HELLO')), HELLO);
});

// --- Drawing ----------------------------------------------------------------------------------

test('the drawing has a quiet zone, or no reader will find the code in it', () => {
  const lines = render('quiet', { colour: false }).split('\n');
  const width = encode('quiet').length;
  assert.equal(lines[0].trim(), '', 'four clear modules above');
  assert.equal(lines.at(-1).trim(), '', 'and below');
  assert.ok(lines.every((line) => line.length === width + 8), 'four either side, on every row');
});

test('the colours are written out, because a code in the terminal theme is inverted on half of them', () => {
  const escape = String.fromCharCode(27);
  assert.ok(render('colour').includes(`${escape}[30;47m`), 'black on white, said explicitly');
  assert.ok(!render('colour', { colour: false }).includes(escape), 'and left out when asked');
});
