// A QR code, drawn in the terminal, so a tunnel address gets to your phone without being typed.
//
// The address is a random 32-character path on a random Cloudflare hostname. Reading that off a
// screen and typing it into a phone is exactly the kind of thing nobody does twice, so the console
// prints it as something you point a camera at instead.
//
// This encodes QR itself rather than taking a dependency, which is worth saying plainly: it is a
// specified format, not a guess. Byte mode, error correction level M, versions 1 to 9 — enough for
// 122 bytes, where the longest address this prints is about eighty. Stopping at 9 is deliberate:
// version 10 onwards needs a 16-bit character count, and not needing one keeps this small enough
// to read.
//
// Verified by decoding what it produces with a decoder that is not this one.

// --- GF(256), the field Reed-Solomon works in ---------------------------------------------------
// Multiplication is done as addition of logarithms, so both tables are built once from the
// primitive polynomial the QR specification names (0x11d).

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let index = 0, value = 1; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];

const multiply = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `count` error-correction codewords. */
function generator(count) {
  let poly = [1];
  for (let index = 0; index < count; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let term = 0; term < poly.length; term += 1) {
      next[term] ^= poly[term];
      next[term + 1] ^= multiply(poly[term], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

/** The remainder of the data divided by the generator — the error-correction codewords. */
function remainder(data, count) {
  const poly = generator(count);
  const result = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    if (factor !== 0) {
      for (let index = 0; index < count; index += 1) result[index] ^= multiply(poly[index + 1], factor);
    }
  }
  return result;
}

// --- What each version holds --------------------------------------------------------------------
//
// Error correction level M, versions 1-9, from the specification's block tables. Each entry is
// [error-correction codewords per block, then one or two [blocks, data codewords per block] groups].
//
// Versions 8 and 9 really do use two groups whose blocks differ in length by one codeword; writing
// them as one group gives a code of the right size made of the wrong pieces, which is the kind of
// wrong that still draws a plausible-looking square. Each row is checked against the version's
// total codeword count by the tests.
const VERSIONS = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
];

/** Every block of a version, in order, as their data-codeword lengths. */
const blockSizes = (version) => VERSIONS[version]
  .slice(1)
  .flatMap(([blocks, perBlock]) => new Array(blocks).fill(perBlock));

// Where the alignment patterns sit, by version. Version 1 has none.
const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
];

const size = (version) => version * 4 + 17;

// Four bits of mode and eight of character count come off the front of the data.
const capacity = (version) => blockSizes(version).reduce((total, block) => total + block, 0) - 2;

export const MAX_BYTES = capacity(9);

/** The smallest version that fits, or null when nothing here does. */
export function versionFor(byteLength) {
  for (let version = 1; version <= 9; version += 1) if (byteLength <= capacity(version)) return version;
  return null;
}

// --- The bit stream -----------------------------------------------------------------------------

function codewordsFor(bytes, version) {
  const [ecCount] = VERSIONS[version];
  const sizes = blockSizes(version);
  const total = sizes.reduce((sum, block) => sum + block, 0);
  const bits = [];
  const push = (value, width) => {
    for (let index = width - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
  };

  push(0b0100, 4);          // byte mode
  push(bytes.length, 8);    // character count, 8 bits for versions 1-9
  for (const byte of bytes) push(byte, 8);
  // Terminator, then out to a whole codeword, then the specification's alternating pad bytes.
  for (let index = 0; index < 4 && bits.length < total * 8; index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let index = 0; data.length < total; index += 1) data.push(index % 2 ? 0x11 : 0xec);

  // Split into blocks, compute each block's error correction, then interleave both: one data
  // codeword from each block in turn, then one error-correction codeword from each in turn.
  // Where blocks differ in length, the shorter ones simply have nothing to give on the last pass.
  const dataBlocks = [];
  const ecBlocks = [];
  let taken = 0;
  for (const length of sizes) {
    const block = data.slice(taken, taken + length);
    taken += length;
    dataBlocks.push(block);
    ecBlocks.push(remainder(block, ecCount));
  }
  const out = [];
  const longest = Math.max(...sizes);
  for (let index = 0; index < longest; index += 1) {
    for (const block of dataBlocks) if (index < block.length) out.push(block[index]);
  }
  for (let index = 0; index < ecCount; index += 1) for (const block of ecBlocks) out.push(block[index]);
  return out;
}

// --- The matrix ---------------------------------------------------------------------------------

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const MASKS = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

/**
 * The 18 version bits: the version number, then a 12-bit BCH remainder over the spec's polynomial.
 * Unlike the format bits these are not masked afterwards.
 */
function versionBits(version) {
  let value = version << 12;
  for (let index = 5; index >= 0; index -= 1) {
    if (value & (1 << (index + 12))) value ^= 0b1111100100100 << index;
  }
  return (version << 12) | value;
}

/** The fixed patterns, and a map of which cells they claim so data never lands on them. */
function skeleton(version) {
  const width = size(version);
  const modules = Array.from({ length: width }, () => new Array(width).fill(0));
  const reserved = Array.from({ length: width }, () => new Array(width).fill(false));
  const put = (row, column, value) => {
    modules[row][column] = value;
    reserved[row][column] = true;
  };

  // Three finder patterns, each with its separator.
  for (const [top, left] of [[0, 0], [0, width - 7], [width - 7, 0]]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const y = top + row;
        const x = left + column;
        if (y < 0 || x < 0 || y >= width || x >= width) continue;
        const inside = row >= 0 && row < 7 && column >= 0 && column < 7;
        put(y, x, inside ? FINDER[row][column] : 0);
      }
    }
  }

  // Alignment patterns, wherever two centres meet — except where a finder already is.
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const column of centres) {
      if (reserved[row][column]) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          put(row + dy, column + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1 ? 1 : 0);
        }
      }
    }
  }

  // Timing patterns, and the one module that is always dark.
  for (let index = 8; index < width - 8; index += 1) {
    put(6, index, index % 2 === 0 ? 1 : 0);
    put(index, 6, index % 2 === 0 ? 1 : 0);
  }
  put(width - 8, 8, 1);

  // Reserve the format information without writing it: the mask is not chosen yet.
  for (let index = 0; index < 9; index += 1) {
    reserved[8][index] = true;
    reserved[index][8] = true;
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][width - 1 - index] = true;
    reserved[width - 1 - index][8] = true;
  }

  // From version 7 the version number is written into the code itself, in two 3x6 blocks beside
  // the top-right and bottom-left finders. It does not depend on the mask, so unlike the format
  // information it can be written here and now.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const bit = (bits >> index) & 1;
      put(Math.floor(index / 3), width - 11 + (index % 3), bit);
      put(width - 11 + (index % 3), Math.floor(index / 3), bit);
    }
  }
  return { modules, reserved, width };
}

/** Lay the codewords in, two columns at a time, bottom to top and back again. */
function place(modules, reserved, width, codewords) {
  const bits = codewords.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1));
  let index = 0;
  let upward = true;
  for (let right = width - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern and is stepped over entirely.
    if (right === 6) right -= 1;
    for (let step = 0; step < width; step += 1) {
      const row = upward ? width - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (reserved[row][column]) continue;
        modules[row][column] = bits[index] ?? 0;
        index += 1;
      }
    }
    upward = !upward;
  }
}

/** The 15 format bits: level M with the chosen mask, BCH-protected and masked, per the spec. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let value = data << 10;
  for (let index = 4; index >= 0; index -= 1) {
    if (value & (1 << (index + 10))) value ^= 0b10100110111 << index;
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/**
 * The format information, written twice so either copy can be read.
 *
 * The two copies run in opposite directions, which is the part that is easy to get wrong and was:
 * around the top-left finder the fifteen bits go up column 8 and *leftwards* along row 8, while
 * the second copy goes up column 8 from the bottom and rightwards along row 8 to the edge. Each
 * position below is the one the specification gives for that bit.
 */
function writeFormat(modules, width, mask) {
  const bits = formatBits(mask);
  const bit = (index) => (bits >> index) & 1;

  // Around the top-left finder.
  for (let index = 0; index <= 5; index += 1) {
    modules[index][8] = bit(index);
    modules[8][index] = bit(14 - index);
  }
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);

  // The second copy: up from the bottom-left, and out to the right-hand edge.
  for (let index = 0; index <= 6; index += 1) modules[width - 1 - index][8] = bit(index);
  for (let index = 7; index <= 14; index += 1) modules[8][width - 15 + index] = bit(index);

  // The one module that is always dark, whatever the format says.
  modules[width - 8][8] = 1;
}

/** The specification's four penalty rules, used only to choose between the eight masks. */
function penalty(modules, width) {
  let score = 0;
  const at = (row, column) => modules[row][column];

  for (let line = 0; line < width; line += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let index = 1; index < width; index += 1) {
        const current = horizontal ? at(line, index) : at(index, line);
        const previous = horizontal ? at(line, index - 1) : at(index - 1, line);
        if (current === previous) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  for (let row = 0; row < width - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const first = at(row, column);
      if (first === at(row, column + 1) && first === at(row + 1, column) && first === at(row + 1, column + 1)) score += 3;
    }
  }

  const PATTERNS = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];
  for (let line = 0; line < width; line += 1) {
    for (let start = 0; start + 11 <= width; start += 1) {
      for (const pattern of PATTERNS) {
        if (pattern.every((value, offset) => at(line, start + offset) === value)) score += 40;
        if (pattern.every((value, offset) => at(start + offset, line) === value)) score += 40;
      }
    }
  }

  const dark = modules.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (width * width) - 50) / 5) * 10;
  return score;
}

/**
 * The QR matrix for `text`, as rows of 0 and 1.
 *
 * Throws rather than truncating when the text is too long: half an address is worse than none,
 * because it looks like it worked.
 */
export function encode(text, { mask: forced = null } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = versionFor(bytes.length);
  if (!version) throw new Error(`${bytes.length} bytes is more than this encoder holds (${MAX_BYTES}).`);
  const codewords = codewordsFor(bytes, version);

  let best = null;
  for (const mask of forced === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forced]) {
    const { modules, reserved, width } = skeleton(version);
    place(modules, reserved, width, codewords);
    for (let row = 0; row < width; row += 1) {
      for (let column = 0; column < width; column += 1) {
        if (!reserved[row][column] && MASKS[mask](row, column)) modules[row][column] ^= 1;
      }
    }
    writeFormat(modules, width, mask);
    const score = penalty(modules, width);
    if (!best || score < best.score) best = { score, modules, mask };
  }
  return best.modules;
}



// --- Drawing it ---------------------------------------------------------------------------------

// Written as a character code on purpose: a literal escape byte in source is invisible, and
// invisible characters are the ones that get mangled by an editor and noticed months later.
const ESC = String.fromCharCode(27);

const QUIET = 4;
// Half-block characters put two rows of modules in one character cell, so the code comes out
// roughly square in a terminal, where cells are about twice as tall as they are wide.
const BLOCKS = { 11: '█', 10: '▀', '01': '▄', '00': ' ' };

/**
 * The code as text, black on white.
 *
 * The colours are set explicitly rather than left to the terminal: a code drawn in the terminal's
 * own foreground on its own background comes out inverted on roughly half of them, and while many
 * readers cope with an inverted code, "many" is not the same as "yours".
 */
export function render(text, { colour = true } = {}) {
  const modules = encode(text);
  const width = modules.length;
  const padded = width + QUIET * 2;
  const at = (row, column) => {
    const y = row - QUIET;
    const x = column - QUIET;
    return y >= 0 && y < width && x >= 0 && x < width ? modules[y][x] : 0;
  };

  const lines = [];
  for (let row = 0; row < padded; row += 2) {
    let line = '';
    for (let column = 0; column < padded; column += 1) {
      line += BLOCKS[`${at(row, column)}${row + 1 < padded ? at(row + 1, column) : 0}`];
    }
    lines.push(colour ? `${ESC}[30;47m${line}${ESC}[0m` : line);
  }
  return lines.join('\n');
}
