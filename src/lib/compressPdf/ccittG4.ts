/**
 * Pure-TypeScript ITU-T T.6 (CCITT Group 4) 2D lossless bilevel encoder.
 * Encodes 1-bit black/white bitmaps into raw PDF /CCITTFaxDecode (/K -1) byte streams.
 * Convention: pixel value 0 = white, 1 = black (matches /BlackIs1 false).
 */

interface HuffmanCode {
  code: number;
  bits: number;
}

const WHITE_TERMINATING: readonly HuffmanCode[] = [
  { code: 0b00110101, bits: 8 }, // 0
  { code: 0b000111, bits: 6 },   // 1
  { code: 0b0111, bits: 4 },     // 2
  { code: 0b1000, bits: 4 },     // 3
  { code: 0b1011, bits: 4 },     // 4
  { code: 0b1100, bits: 4 },     // 5
  { code: 0b1110, bits: 4 },     // 6
  { code: 0b1111, bits: 4 },     // 7
  { code: 0b10011, bits: 5 },    // 8
  { code: 0b10100, bits: 5 },    // 9
  { code: 0b00111, bits: 5 },    // 10
  { code: 0b01000, bits: 5 },    // 11
  { code: 0b001000, bits: 6 },   // 12
  { code: 0b000011, bits: 6 },   // 13
  { code: 0b110100, bits: 6 },   // 14
  { code: 0b110101, bits: 6 },   // 15
  { code: 0b101010, bits: 6 },   // 16
  { code: 0b101011, bits: 6 },   // 17
  { code: 0b0100111, bits: 7 },  // 18
  { code: 0b0001100, bits: 7 },  // 19
  { code: 0b0001000, bits: 7 },  // 20
  { code: 0b0010111, bits: 7 },  // 21
  { code: 0b0000011, bits: 7 },  // 22
  { code: 0b0000100, bits: 7 },  // 23
  { code: 0b0101000, bits: 7 },  // 24
  { code: 0b0101011, bits: 7 },  // 25
  { code: 0b0010011, bits: 7 },  // 26
  { code: 0b0100100, bits: 7 },  // 27
  { code: 0b0011000, bits: 7 },  // 28
  { code: 0b00000010, bits: 8 }, // 29
  { code: 0b00000011, bits: 8 }, // 30
  { code: 0b00011010, bits: 8 }, // 31
  { code: 0b00011011, bits: 8 }, // 32
  { code: 0b00010010, bits: 8 }, // 33
  { code: 0b00010011, bits: 8 }, // 34
  { code: 0b00010100, bits: 8 }, // 35
  { code: 0b00010101, bits: 8 }, // 36
  { code: 0b00010110, bits: 8 }, // 37
  { code: 0b00010111, bits: 8 }, // 38
  { code: 0b00101000, bits: 8 }, // 39
  { code: 0b00101001, bits: 8 }, // 40
  { code: 0b00101010, bits: 8 }, // 41
  { code: 0b00101011, bits: 8 }, // 42
  { code: 0b00101100, bits: 8 }, // 43
  { code: 0b00101101, bits: 8 }, // 44
  { code: 0b00000100, bits: 8 }, // 45
  { code: 0b00000101, bits: 8 }, // 46
  { code: 0b00001010, bits: 8 }, // 47
  { code: 0b00001011, bits: 8 }, // 48
  { code: 0b01010010, bits: 8 }, // 49
  { code: 0b01010011, bits: 8 }, // 50
  { code: 0b01010100, bits: 8 }, // 51
  { code: 0b01010101, bits: 8 }, // 52
  { code: 0b00100100, bits: 8 }, // 53
  { code: 0b00100101, bits: 8 }, // 54
  { code: 0b01011000, bits: 8 }, // 55
  { code: 0b01011001, bits: 8 }, // 56
  { code: 0b01011010, bits: 8 }, // 57
  { code: 0b01011011, bits: 8 }, // 58
  { code: 0b01001010, bits: 8 }, // 59
  { code: 0b01001011, bits: 8 }, // 60
  { code: 0b00110010, bits: 8 }, // 61
  { code: 0b00110011, bits: 8 }, // 62
  { code: 0b00110100, bits: 8 }, // 63
];

const WHITE_MAKEUP: readonly HuffmanCode[] = [
  { code: 0b11011, bits: 5 },      // 64
  { code: 0b10010, bits: 5 },      // 128
  { code: 0b010111, bits: 6 },     // 192
  { code: 0b0110111, bits: 7 },    // 256
  { code: 0b00110110, bits: 8 },   // 320
  { code: 0b00110111, bits: 8 },   // 384
  { code: 0b01100100, bits: 8 },   // 448
  { code: 0b01100101, bits: 8 },   // 512
  { code: 0b01101000, bits: 8 },   // 576
  { code: 0b01100111, bits: 8 },   // 640
  { code: 0b011001100, bits: 9 },  // 704
  { code: 0b011001101, bits: 9 },  // 768
  { code: 0b011010010, bits: 9 },  // 832
  { code: 0b011010011, bits: 9 },  // 896
  { code: 0b011010100, bits: 9 },  // 960
  { code: 0b011010101, bits: 9 },  // 1024
  { code: 0b011010110, bits: 9 },  // 1088
  { code: 0b011010111, bits: 9 },  // 1152
  { code: 0b011011000, bits: 9 },  // 1216
  { code: 0b011011001, bits: 9 },  // 1280
  { code: 0b011011010, bits: 9 },  // 1344
  { code: 0b011011011, bits: 9 },  // 1408
  { code: 0b010011000, bits: 9 },  // 1472
  { code: 0b010011001, bits: 9 },  // 1536
  { code: 0b010011010, bits: 9 },  // 1600
  { code: 0b011000, bits: 6 },     // 1664
  { code: 0b010011011, bits: 9 },  // 1728
];

const BLACK_TERMINATING: readonly HuffmanCode[] = [
  { code: 0b0000110111, bits: 10 }, // 0
  { code: 0b010, bits: 3 },         // 1
  { code: 0b11, bits: 2 },          // 2
  { code: 0b10, bits: 2 },          // 3
  { code: 0b011, bits: 3 },         // 4
  { code: 0b0011, bits: 4 },        // 5
  { code: 0b0010, bits: 4 },        // 6
  { code: 0b00011, bits: 5 },       // 7
  { code: 0b000101, bits: 6 },      // 8
  { code: 0b000100, bits: 6 },      // 9
  { code: 0b0000100, bits: 7 },     // 10
  { code: 0b0000101, bits: 7 },     // 11
  { code: 0b0000111, bits: 7 },     // 12
  { code: 0b00000100, bits: 8 },    // 13
  { code: 0b00000111, bits: 8 },    // 14
  { code: 0b000011000, bits: 9 },   // 15
  { code: 0b0000010111, bits: 10 }, // 16
  { code: 0b0000011000, bits: 10 }, // 17
  { code: 0b0000001000, bits: 10 }, // 18
  { code: 0b00001100111, bits: 11 }, // 19
  { code: 0b00001101000, bits: 11 }, // 20
  { code: 0b00001101100, bits: 11 }, // 21
  { code: 0b00000110111, bits: 11 }, // 22
  { code: 0b00000101000, bits: 11 }, // 23
  { code: 0b00000010111, bits: 11 }, // 24
  { code: 0b00000011000, bits: 11 }, // 25
  { code: 0b000011001010, bits: 12 }, // 26
  { code: 0b000011001011, bits: 12 }, // 27
  { code: 0b000011001100, bits: 12 }, // 28
  { code: 0b000011001101, bits: 12 }, // 29
  { code: 0b000001101000, bits: 12 }, // 30
  { code: 0b000001101001, bits: 12 }, // 31
  { code: 0b000001101010, bits: 12 }, // 32
  { code: 0b000001101011, bits: 12 }, // 33
  { code: 0b000011010010, bits: 12 }, // 34
  { code: 0b000011010011, bits: 12 }, // 35
  { code: 0b000011010100, bits: 12 }, // 36
  { code: 0b000011010101, bits: 12 }, // 37
  { code: 0b000011010110, bits: 12 }, // 38
  { code: 0b000011010111, bits: 12 }, // 39
  { code: 0b000001101100, bits: 12 }, // 40
  { code: 0b000001101101, bits: 12 }, // 41
  { code: 0b000011011010, bits: 12 }, // 42
  { code: 0b000011011011, bits: 12 }, // 43
  { code: 0b000001010100, bits: 12 }, // 44
  { code: 0b000001010101, bits: 12 }, // 45
  { code: 0b000001010110, bits: 12 }, // 46
  { code: 0b000001010111, bits: 12 }, // 47
  { code: 0b000001100100, bits: 12 }, // 48
  { code: 0b000001100101, bits: 12 }, // 49
  { code: 0b000001010010, bits: 12 }, // 50
  { code: 0b000001010011, bits: 12 }, // 51
  { code: 0b000000100100, bits: 12 }, // 52
  { code: 0b000000110111, bits: 12 }, // 53
  { code: 0b000000111000, bits: 12 }, // 54
  { code: 0b000000100111, bits: 12 }, // 55
  { code: 0b000000101000, bits: 12 }, // 56
  { code: 0b000001011000, bits: 12 }, // 57
  { code: 0b000001011001, bits: 12 }, // 58
  { code: 0b000000101011, bits: 12 }, // 59
  { code: 0b000000101100, bits: 12 }, // 60
  { code: 0b000001011010, bits: 12 }, // 61
  { code: 0b000001100110, bits: 12 }, // 62
  { code: 0b000001100111, bits: 12 }, // 63
];

const BLACK_MAKEUP: readonly HuffmanCode[] = [
  { code: 0b0000001111, bits: 10 },   // 64
  { code: 0b000011001000, bits: 12 }, // 128
  { code: 0b000011001001, bits: 12 }, // 192
  { code: 0b000001011011, bits: 12 }, // 256
  { code: 0b000000110011, bits: 12 }, // 320
  { code: 0b000000110100, bits: 12 }, // 384
  { code: 0b000000110101, bits: 12 }, // 448
  { code: 0b0000001101100, bits: 13 }, // 512
  { code: 0b0000001101101, bits: 13 }, // 576
  { code: 0b0000001001010, bits: 13 }, // 640
  { code: 0b0000001001011, bits: 13 }, // 704
  { code: 0b0000001001100, bits: 13 }, // 768
  { code: 0b0000001001101, bits: 13 }, // 832
  { code: 0b0000001110010, bits: 13 }, // 896
  { code: 0b0000001110011, bits: 13 }, // 960
  { code: 0b0000001110100, bits: 13 }, // 1024
  { code: 0b0000001110101, bits: 13 }, // 1088
  { code: 0b0000001110110, bits: 13 }, // 1152
  { code: 0b0000001110111, bits: 13 }, // 1216
  { code: 0b0000001010010, bits: 13 }, // 1280
  { code: 0b0000001010011, bits: 13 }, // 1344
  { code: 0b0000001010100, bits: 13 }, // 1408
  { code: 0b0000001010101, bits: 13 }, // 1472
  { code: 0b0000001011010, bits: 13 }, // 1536
  { code: 0b0000001011011, bits: 13 }, // 1600
  { code: 0b0000001100100, bits: 13 }, // 1664
  { code: 0b0000001100101, bits: 13 }, // 1728
];

// Shared extended makeup codes (1792..2560) for both black and white runs
const EXTENDED_MAKEUP: readonly HuffmanCode[] = [
  { code: 0b00000001000, bits: 11 },  // 1792
  { code: 0b00000001100, bits: 11 },  // 1856
  { code: 0b00000001101, bits: 11 },  // 1920
  { code: 0b000000010010, bits: 12 }, // 1984
  { code: 0b000000010011, bits: 12 }, // 2048
  { code: 0b000000010100, bits: 12 }, // 2112
  { code: 0b000000010101, bits: 12 }, // 2176
  { code: 0b000000010110, bits: 12 }, // 2240
  { code: 0b000000010111, bits: 12 }, // 2304
  { code: 0b000000011100, bits: 12 }, // 2368
  { code: 0b000000011101, bits: 12 }, // 2432
  { code: 0b000000011110, bits: 12 }, // 2496
  { code: 0b000000011111, bits: 12 }, // 2560
];

class BitWriter {
  private buf: Uint8Array;
  private bytePos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensureCapacity(extraBytes: number): void {
    if (this.bytePos + extraBytes <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < this.bytePos + extraBytes) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.bytePos));
    this.buf = next;
  }

  writeBits(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.bitBuf = (this.bitBuf << 1) | ((code >>> i) & 1);
      this.bitCount++;
      if (this.bitCount === 8) {
        this.ensureCapacity(1);
        this.buf[this.bytePos++] = this.bitBuf & 0xff;
        this.bitBuf = 0;
        this.bitCount = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.ensureCapacity(1);
      this.buf[this.bytePos++] = (this.bitBuf << (8 - this.bitCount)) & 0xff;
      this.bitBuf = 0;
      this.bitCount = 0;
    }
    return this.buf.slice(0, this.bytePos);
  }
}

function writeRunLength(writer: BitWriter, runLength: number, isBlack: boolean): void {
  let rem = runLength;
  const makeup = isBlack ? BLACK_MAKEUP : WHITE_MAKEUP;
  const term = isBlack ? BLACK_TERMINATING : WHITE_TERMINATING;

  while (rem >= 2560) {
    const ext2560 = EXTENDED_MAKEUP[EXTENDED_MAKEUP.length - 1];
    writer.writeBits(ext2560.code, ext2560.bits);
    rem -= 2560;
  }

  if (rem >= 64) {
    const idx = Math.floor(rem / 64) - 1;
    if (idx < makeup.length) {
      const m = makeup[idx];
      writer.writeBits(m.code, m.bits);
    } else {
      const extIdx = idx - makeup.length;
      const m = EXTENDED_MAKEUP[extIdx];
      writer.writeBits(m.code, m.bits);
    }
    rem %= 64;
  }

  const t = term[rem];
  writer.writeBits(t.code, t.bits);
}

/**
 * Find next changing pixel index strictly after startIdx matching targetColor (or any color).
 */
function findNextChange(
  line: Uint8Array,
  width: number,
  afterIdx: number,
  currentColor: number
): number {
  let pos = afterIdx < 0 ? 0 : afterIdx + 1;
  while (pos < width) {
    if (line[pos] !== currentColor) return pos;
    pos++;
  }
  return width;
}

function findB1(
  refLine: Uint8Array,
  width: number,
  a0: number,
  a0Color: number
): number {
  if (a0 < 0) {
    // At line start, imaginary pixel at -1 is white (0).
    if (width > 0 && refLine[0] !== a0Color) return 0;
    let x = 1;
    while (x < width) {
      if (refLine[x] !== refLine[x - 1] && refLine[x] !== a0Color) {
        return x;
      }
      x++;
    }
    return width;
  }

  // Must scan refLine changing elements strictly right of a0 with color !== a0Color
  let x = a0 + 1;
  while (x < width) {
    const prev = refLine[x - 1];
    if (refLine[x] !== prev && refLine[x] !== a0Color) {
      return x;
    }
    x++;
  }
  return width;
}

function findB2(refLine: Uint8Array, width: number, b1: number): number {
  if (b1 >= width) return width;
  const b1Color = refLine[b1];
  let x = b1 + 1;
  while (x < width) {
    if (refLine[x] !== b1Color) return x;
    x++;
  }
  return width;
}

/**
 * Encodes a binary image buffer (length = width * height, 0 = white, 1 = black)
 * to ITU-T T.6 (CCITT Group 4) raw bitstream including 24-bit EOFB RTC.
 */
export function encodeCcittGroup4(
  binaryPixels: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions for CCITT Group 4 encoding');
  }
  if (binaryPixels.length < width * height) {
    throw new Error('Binary pixel buffer smaller than width * height');
  }

  const writer = new BitWriter(Math.max(1024, Math.ceil((width * height) / 16)));
  let refLine: Uint8Array = new Uint8Array(width); // Initialized to imaginary all-white row (0)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const codingLine = binaryPixels.subarray(rowOffset, rowOffset + width);

    let a0 = -1;
    let a0Color = 0; // Start each line with imaginary white pixel at -1

    while (a0 < width) {
      const a1 = findNextChange(codingLine, width, a0, a0Color);
      const b1 = findB1(refLine, width, a0, a0Color);
      const b2 = findB2(refLine, width, b1);

      if (b2 < a1) {
        // Pass Mode: 0001
        writer.writeBits(0b0001, 4);
        a0 = b2;
      } else {
        const diff = a1 - b1;
        if (diff >= -3 && diff <= 3) {
          // Vertical Modes
          switch (diff) {
            case 0:
              writer.writeBits(0b1, 1);
              break;
            case 1:
              writer.writeBits(0b011, 3);
              break;
            case 2:
              writer.writeBits(0b000011, 6);
              break;
            case 3:
              writer.writeBits(0b0000011, 7);
              break;
            case -1:
              writer.writeBits(0b010, 3);
              break;
            case -2:
              writer.writeBits(0b000010, 6);
              break;
            case -3:
              writer.writeBits(0b0000010, 7);
              break;
          }
          a0 = a1;
          a0Color = 1 - a0Color;
        } else {
          // Horizontal Mode: 001 + M(a0a1) + M(a1a2)
          const a1Color = 1 - a0Color;
          const a2 = a1 < width ? findNextChange(codingLine, width, a1, a1Color) : width;
          const run1 = a1 - (a0 < 0 ? 0 : a0);
          const run2 = a2 - a1;

          writer.writeBits(0b001, 3);
          writeRunLength(writer, run1, a0Color === 1);
          writeRunLength(writer, run2, a1Color === 1);
          a0 = a2;
        }
      }
    }

    refLine = codingLine;
  }

  // End-of-Facsimile-Block (EOFB): two consecutive EOL codes (000000000001 x 2)
  writer.writeBits(0b000000000001, 12);
  writer.writeBits(0b000000000001, 12);

  return writer.finish();
}

/**
 * Compute adaptive Otsu global threshold (0..255) on 8-bit grayscale luminance values.
 */
export function computeOtsuThreshold(luma: Uint8Array): number {
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(luma.length / 50000));
  let total = 0;
  for (let i = 0; i < luma.length; i += step) {
    hist[luma[i]]++;
    total++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = t;
    }
  }

  // Slight bias toward preserving crisp thin black strokes on cream/gray paper scans
  return Math.max(40, Math.min(220, threshold + 8));
}
