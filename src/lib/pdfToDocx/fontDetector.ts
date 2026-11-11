import { PositionedItem, TextSpan } from './types';

export interface FontStyleAnalysis {
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
  isMonospace: boolean;
  fontSize: number;
  color: string;
}

export interface PdfFontMetadata {
  resolvedName?: string;
  cssFontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
  isMonospace?: boolean;
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i', 'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c',
  'ᵈ': 'd', 'ᵉ': 'e', 'ᶠ': 'f', 'ᵍ': 'g', 'ʰ': 'h',
  'ʲ': 'j', 'ᵏ': 'k', 'ˡ': 'l', 'ᵐ': 'm', 'ᵒ': 'o',
  'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't', 'ᵘ': 'u',
  'ᵛ': 'v', 'ʷ': 'w', 'ˣ': 'x', 'ʸ': 'y', 'ᶻ': 'z',
  'ᵝ': 'β', 'ᵞ': 'γ', 'ᵟ': 'δ', 'ᶿ': 'θ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't',
  'ᵤ': 'u', 'ᵥ': 'v',
  'ᵦ': 'β', 'ᵧ': 'γ', 'ᵨ': 'ρ', 'ᵩ': 'φ', 'ᵪ': 'χ',
};

const ADOBE_SYMBOL_MAP: Record<string, string> = {
  ' ': ' ',
  '+': '+',
  '-': '−',
  '=': '=',
  '<': '<',
  '>': '>',
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '{': '{',
  '}': '}',
  ',': ',',
  '.': '.',
  ':': ':',
  ';': ';',
  '/': '/',
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  a: 'α', b: 'β', g: 'γ', d: 'δ', e: 'ε', z: 'ζ', h: 'η', q: 'θ',
  i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν', x: 'ξ', p: 'π', r: 'ρ',
  s: 'σ', t: 'τ', u: 'υ', f: 'φ', c: 'χ', y: 'ψ', w: 'ω',
  A: 'Α', B: 'Β', G: 'Γ', D: 'Δ', Q: 'Θ', L: 'Λ', P: 'Π', S: 'Σ',
  F: 'Φ', Y: 'Ψ', W: 'Ω',
  '£': '≤', '³': '≥', '´': '×', '¸': '÷', '¹': '≠', '»': '≈',
  '²': '″', '±': '±', '¥': '∞', '°': '°', '×': '×', '÷': '÷',
  '\u00B7': '•', '\uF0B7': '•', '\uF0A7': '▪', '\uF0FC': '✓',
};

/**
 * Unshifts Windows/Office Private Use Area (U+F020..U+F0FF) byte codes used by legacy
 * Symbol/Wingdings/Dingbats fonts back to 0x20..0xFF for lookup.
 */
function unshiftSymbolPuaChar(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp !== undefined && cp >= 0xf020 && cp <= 0xf0ff) {
    return String.fromCharCode(cp - 0xf000);
  }
  return ch;
}

/**
 * Normalizes mathematical alphanumeric symbols (U+1D400..U+1D7FF) and variant symbols
 * to standard Unicode BMP code points while reporting any intrinsic italic/bold style.
 */
function normalizeMathUnicodeChar(ch: string): { ch: string; italic?: boolean; bold?: boolean } {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return { ch };
  if (cp === 0x2126) return { ch: 'Ω' }; // OHM SIGN -> Greek Capital Omega
  if (cp === 0x2212) return { ch: '−' };

  // Mathematical Italic lowercase/uppercase Latin (U+1D434..U+1D467)
  if (cp >= 0x1d434 && cp <= 0x1d44d) return { ch: String.fromCharCode(0x41 + (cp - 0x1d434)), italic: true };
  if (cp >= 0x1d44e && cp <= 0x1d467) {
    // U+1D455 is reserved; U+210E (h) handled separately
    return { ch: String.fromCharCode(0x61 + (cp - 0x1d44e)), italic: true };
  }
  if (cp === 0x210e) return { ch: 'h', italic: true };

  // Mathematical Bold Latin (U+1D400..U+1D433)
  if (cp >= 0x1d400 && cp <= 0x1d419) return { ch: String.fromCharCode(0x41 + (cp - 0x1d400)), bold: true };
  if (cp >= 0x1d41a && cp <= 0x1d433) return { ch: String.fromCharCode(0x61 + (cp - 0x1d41a)), bold: true };

  // Mathematical Bold Italic Latin (U+1D468..U+1D49B)
  if (cp >= 0x1d468 && cp <= 0x1d481) return { ch: String.fromCharCode(0x41 + (cp - 0x1d468)), bold: true, italic: true };
  if (cp >= 0x1d482 && cp <= 0x1d49b) return { ch: String.fromCharCode(0x61 + (cp - 0x1d482)), bold: true, italic: true };

  // Mathematical Greek Bold (U+1D6A8..U+1D6DB) and Italic (U+1D6E2..U+1D71B)
  if (cp >= 0x1d6a8 && cp <= 0x1d6c0) return { ch: String.fromCharCode(0x0391 + (cp - 0x1d6a8)), bold: true };
  if (cp >= 0x1d6c2 && cp <= 0x1d6da) return { ch: String.fromCharCode(0x03b1 + (cp - 0x1d6c2)), bold: true };
  if (cp >= 0x1d6e2 && cp <= 0x1d6fa) return { ch: String.fromCharCode(0x0391 + (cp - 0x1d6e2)), italic: true };
  if (cp >= 0x1d6fc && cp <= 0x1d714) return { ch: String.fromCharCode(0x03b1 + (cp - 0x1d6fc)), italic: true };
  if (cp === 0x1d71b) return { ch: 'π', italic: true };

  // Mathematical Sans-Serif Latin (U+1D5A0..U+1D66F) and Monospace Latin (U+1D670..U+1D6A3)
  if (cp >= 0x1d5a0 && cp <= 0x1d5b9) return { ch: String.fromCharCode(0x41 + (cp - 0x1d5a0)) };
  if (cp >= 0x1d5ba && cp <= 0x1d5d3) return { ch: String.fromCharCode(0x61 + (cp - 0x1d5ba)) };
  if (cp >= 0x1d5d4 && cp <= 0x1d5ed) return { ch: String.fromCharCode(0x41 + (cp - 0x1d5d4)), bold: true };
  if (cp >= 0x1d5ee && cp <= 0x1d607) return { ch: String.fromCharCode(0x61 + (cp - 0x1d5ee)), bold: true };
  if (cp >= 0x1d608 && cp <= 0x1d621) return { ch: String.fromCharCode(0x41 + (cp - 0x1d608)), italic: true };
  if (cp >= 0x1d622 && cp <= 0x1d63b) return { ch: String.fromCharCode(0x61 + (cp - 0x1d622)), italic: true };
  if (cp >= 0x1d63c && cp <= 0x1d655) return { ch: String.fromCharCode(0x41 + (cp - 0x1d63c)), bold: true, italic: true };
  if (cp >= 0x1d656 && cp <= 0x1d66f) return { ch: String.fromCharCode(0x61 + (cp - 0x1d656)), bold: true, italic: true };
  if (cp >= 0x1d670 && cp <= 0x1d689) return { ch: String.fromCharCode(0x41 + (cp - 0x1d670)) };
  if (cp >= 0x1d68a && cp <= 0x1d6a3) return { ch: String.fromCharCode(0x61 + (cp - 0x1d68a)) };

  // Mathematical Digits (Bold, Double-Struck, Sans, Sans-Bold, Monospace: U+1D7CE..U+1D7FF)
  if (cp >= 0x1d7ce && cp <= 0x1d7d7) return { ch: String.fromCharCode(0x30 + (cp - 0x1d7ce)), bold: true };
  if (cp >= 0x1d7d8 && cp <= 0x1d7e1) return { ch: String.fromCharCode(0x30 + (cp - 0x1d7d8)) };
  if (cp >= 0x1d7e2 && cp <= 0x1d7eb) return { ch: String.fromCharCode(0x30 + (cp - 0x1d7e2)) };
  if (cp >= 0x1d7ec && cp <= 0x1d7f5) return { ch: String.fromCharCode(0x30 + (cp - 0x1d7ec)), bold: true };
  if (cp >= 0x1d7f6 && cp <= 0x1d7ff) return { ch: String.fromCharCode(0x30 + (cp - 0x1d7f6)) };

  return { ch };
}

function isMathUnicodeStyledString(str: string): { hasItalic: boolean; hasBold: boolean } {
  let hasItalic = false;
  let hasBold = false;
  for (const raw of Array.from(str)) {
    const info = normalizeMathUnicodeChar(raw);
    if (info.italic) hasItalic = true;
    if (info.bold) hasBold = true;
  }
  return { hasItalic, hasBold };
}

/**
 * Normalizes genuine legacy PDF Symbol / Wingdings / Dingbats glyphs without modifying normal Unicode text.
 */
export function normalizeExtractedText(
  str: string,
  fontName: string = '',
  resolvedFontName: string = ''
): string {
  if (!str) return '';
  const combined = `${fontName} ${resolvedFontName}`.toLowerCase();

  // Only remap Private Use Area or 8-bit Wingdings/Dingbats when the font itself is Wingdings/Dingbats
  if (combined.includes('wingding') || combined.includes('dingbat') || combined.includes('zapf')) {
    return Array.from(str)
      .map((rawCh) => {
        const ch = unshiftSymbolPuaChar(rawCh);
        if (ch === 'l' || ch === '\u00B7' || ch === '\u006C' || ch === '\u009F' || rawCh === '\uF0B7') return '•';
        if (ch === 'n' || ch === '\u00A7' || rawCh === '\uF0A7' || rawCh === '\uF06E') return '▪';
        if (ch === '¨' || ch === 'o' || rawCh === '\uF0A8' || rawCh === '\uF06F') return '□';
        if (ch === 'ü' || rawCh === '\uF0FC' || ch === '4') return '✓';
        if (ch === 'þ' || rawCh === '\uF0FE') return '☑';
        return rawCh;
      })
      .join('');
  }

  // Only remap Adobe Symbol single-byte/PUA glyphs when the font is explicitly legacy Adobe Symbol
  // (never scramble Segoe UI Symbol, Apple Symbols, Noto Sans Symbols, OpenSymbol, Cambria, STIX, or already-Unicode runs)
  const isLegacyAdobeSymbol =
    combined.includes('symbol') &&
    !combined.includes('segoe') &&
    !combined.includes('apple') &&
    !combined.includes('noto') &&
    !combined.includes('opensymbol') &&
    !combined.includes('cambria') &&
    !combined.includes('stix');

  if (isLegacyAdobeSymbol) {
    if (str === '\u00B7' || str === '\uF0B7') return '•';
    const hasUnicodeMathOrGreek = /[\u0370-\u03FF\u2200-\u22FF]/.test(str);
    return Array.from(str)
      .map((rawCh) => {
        const cp = rawCh.codePointAt(0) ?? 0;
        const isPua = cp >= 0xf020 && cp <= 0xf0ff;
        if (hasUnicodeMathOrGreek && !isPua) {
          return normalizeMathUnicodeChar(rawCh).ch;
        }
        if (rawCh in ADOBE_SYMBOL_MAP) return ADOBE_SYMBOL_MAP[rawCh];
        const unshifted = unshiftSymbolPuaChar(rawCh);
        return ADOBE_SYMBOL_MAP[unshifted] ?? normalizeMathUnicodeChar(rawCh).ch;
      })
      .join('');
  }

  // Fallback for obfuscated/unnamed PDF font subsets that emit Office PUA symbols or Math Alphanumeric Unicode
  return Array.from(str)
    .map((rawCh) => {
      switch (rawCh) {
        case '\uF020': return ' ';
        case '\uF02B': return '+';
        case '\uF02D': return '−';
        case '\uF03D': return '=';
        case '\uF044': return 'Δ';
        case '\uF051': return 'Θ';
        case '\uF053': return 'Σ';
        case '\uF057': return 'Ω';
        case '\uF061': return 'α';
        case '\uF062': return 'β';
        case '\uF064': return 'δ';
        case '\uF065': return 'ε';
        case '\uF067': return 'γ';
        case '\uF06D': return 'μ';
        case '\uF070': return 'π';
        case '\uF071': return 'θ';
        case '\uF073': return 'σ';
        case '\uF077': return 'ω';
        case '\uF0A3': return '≤';
        case '\uF0A5': return '∞';
        case '\uF0A7': return '▪';
        case '\uF0A8': return '□';
        case '\uF0B0': return '°';
        case '\uF0B1': return '±';
        case '\uF0B3': return '≥';
        case '\uF0B4': return '×';
        case '\uF0B7': return '•';
        case '\uF0B8': return '÷';
        case '\uF0B9': return '≠';
        case '\uF0BB': return '≈';
        case '\uF0D8': return '➢';
        case '\uF0FC': return '✓';
        case '\uF0FE': return '☑';
        default: return normalizeMathUnicodeChar(rawCh).ch;
      }
    })
    .join('');
}

/**
 * Splits a text span into multiple runs when Unicode superscript/subscript glyphs (e.g., ², ₁, ₂)
 * are embedded inline, converting them into native Word superscript/subscript runs (<w:vertAlign/>)
 * so πr², x₁, x₂ render reliably across all OS fonts (even when Arial lacks U+2081/U+2082 glyphs).
 */
export function splitSuperSubSpans(span: TextSpan): TextSpan[] {
  if (!span.text) return [];
  // If already geometrically tagged as super or sub, map any Unicode super/sub digits inside cleanly
  if (span.isSuperScript || span.isSubScript) {
    const normalized = Array.from(span.text)
      .map((ch) => SUPERSCRIPT_MAP[ch] ?? SUBSCRIPT_MAP[ch] ?? ch)
      .join('');
    return [{ ...span, text: normalized }];
  }

  const out: TextSpan[] = [];
  let buffer = '';
  let currentMode: 'normal' | 'super' | 'sub' = 'normal';

  const flush = () => {
    if (!buffer) return;
    out.push({
      ...span,
      text: buffer,
      isSuperScript: currentMode === 'super',
      isSubScript: currentMode === 'sub',
    });
    buffer = '';
  };

  for (const ch of Array.from(span.text)) {
    if (ch in SUPERSCRIPT_MAP) {
      if (currentMode !== 'super') {
        flush();
        currentMode = 'super';
      }
      buffer += SUPERSCRIPT_MAP[ch];
    } else if (ch in SUBSCRIPT_MAP) {
      if (currentMode !== 'sub') {
        flush();
        currentMode = 'sub';
      }
      buffer += SUBSCRIPT_MAP[ch];
    } else {
      if (currentMode !== 'normal') {
        flush();
        currentMode = 'normal';
      }
      buffer += ch;
    }
  }
  flush();
  return out;
}

/**
 * Computes length-weighted modal font size & baseline Y across items in a line/bucket,
 * preventing single tall math symbols or unscaled superscripts/subscripts from distorting baseline detection.
 */
export function computeModalLineBaseline(
  items: PositionedItem[]
): { baselineY: number; baselineFontSize: number } {
  const vis = items.filter((it) => it.str && it.str.trim().length > 0);
  const src = vis.length > 0 ? vis : items;
  if (src.length === 0) return { baselineY: 0, baselineFontSize: 11 };

  const getH = (it: PositionedItem): number =>
    Math.max(
      it.height || 0,
      Math.hypot(it.transform?.[0] || 0, it.transform?.[1] || 0),
      Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0)
    ) || 11;

  const nonScriptSrc = src.filter((it) => !it.isSuperScriptFlag && !it.isSubScriptFlag);
  const hPool = nonScriptSrc.length > 0 ? nonScriptSrc : src;

  const heightWeights = new Map<number, number>();
  for (const it of hPool) {
    const bucket = Math.round(getH(it) * 2) / 2;
    const w = Math.max(1, it.str.trim().length);
    heightWeights.set(bucket, (heightWeights.get(bucket) || 0) + w);
  }

  let modalFontSize = 11;
  let bestHWeight = -1;
  for (const [bucket, weight] of heightWeights.entries()) {
    // On exact ties (e.g. 1-char base "x" vs 1-char smaller subscript "1"), prefer normal-larger base height
    if (weight > bestHWeight + 0.01 || (Math.abs(weight - bestHWeight) <= 0.01 && bucket > modalFontSize)) {
      bestHWeight = weight;
      modalFontSize = bucket;
    }
  }

  const baseHeightItems = hPool.filter((it) => {
    const h = getH(it);
    return h >= modalFontSize * 0.85 && h <= modalFontSize * 1.18;
  });
  const yPool = baseHeightItems.length > 0 ? baseHeightItems : hPool;

  // Cluster Y coordinates within 0.6pt and pick dominant alphabetic baseline Y
  const yBuckets: { ySum: number; wSum: number; alphaWSum: number; centerY: number }[] = [];
  for (const it of yPool) {
    const trimmed = it.str.trim();
    const len = Math.max(1, trimmed.length);
    const hasAlpha = /[A-Za-zπΩαβγμσθωΔΣΦΨ]/.test(trimmed);
    const weight = len * (hasAlpha ? 1.25 : /^[0-9+\-=()]+$/.test(trimmed) ? 0.8 : 1.0);
    const found = yBuckets.find((b) => Math.abs(b.centerY - it.y) <= 0.65);
    if (found) {
      found.ySum += it.y * weight;
      found.wSum += weight;
      if (hasAlpha) found.alphaWSum += len;
      found.centerY = found.ySum / found.wSum;
    } else {
      yBuckets.push({
        ySum: it.y * weight,
        wSum: weight,
        alphaWSum: hasAlpha ? len : 0,
        centerY: it.y,
      });
    }
  }

  yBuckets.sort((a, b) => {
    if (Math.abs(b.wSum - a.wSum) > 0.25) return b.wSum - a.wSum;
    return b.alphaWSum - a.alphaWSum;
  });

  const baselineY = yBuckets.length > 0 ? yBuckets[0].centerY : yPool[0].y;
  return { baselineY, baselineFontSize: modalFontSize || 11 };
}

/**
 * Builds properly spaced, style-coherent TextSpan[] and rawText from sorted PositionedItems.
 * Guarantees spans.map(s => s.text).join('') === rawText.
 */
export function buildSpansAndTextFromItems(
  items: PositionedItem[],
  baselineY: number,
  baselineFontSize: number,
  defaultFamily: string
): { spans: TextSpan[]; rawText: string } {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const rawSpans: TextSpan[] = [];
  let rawText = '';
  let prevRightX: number | null = null;
  let prevFontSize = baselineFontSize;
  let prevWasGeomScript: boolean = false;
  let pendingSpace = false;

  for (const it of sorted) {
    const cleanStr = normalizeExtractedText(it.str, it.fontName, it.resolvedFontName);
    if (!cleanStr) continue;

    // Pure whitespace item: defer space until next visible item so trailing whitespace NEVER pollutes <sup>/<sub> runs
    if (cleanStr.trim().length === 0) {
      if (rawText.length > 0 && !rawText.endsWith(' ')) {
        pendingSpace = true;
      }
      prevRightX = Math.max(prevRightX ?? it.x, it.x + (it.width || 0));
      continue;
    }

    const mathUnicodeStyle = isMathUnicodeStyledString(it.str);
    const fontMeta: PdfFontMetadata = {
      resolvedName: it.resolvedFontName,
      cssFontFamily: it.cssFontFamily,
      bold: it.isBoldFlag,
      italic: it.isItalicFlag,
      isMonospace: it.isMonospaceFlag,
    };

    const fontAnalysis = analyzeFont(
      it.fontName,
      it.height,
      it.transform,
      defaultFamily,
      fontMeta
    );
    const rawTrimmedForMath =
      mathUnicodeStyle.hasItalic || mathUnicodeStyle.hasBold ? it.str : null;

    const isItemUnderline = Boolean(it.isUnderlineFlag);

    // Geometric & explicit subscript / superscript detection against modal full-height baseline
    const trimmed = cleanStr.trim();
    const dy = it.y - baselineY;
    const sizeRatio = fontAnalysis.fontSize / Math.max(1, baselineFontSize);
    const isValidScriptBody =
      !/^[•●▪▫◦‣⁃₹$€£¥]/.test(trimmed) &&
      /^[0-9a-zA-Z+\-=()′'\*†‡,;\.]+$/.test(trimmed) &&
      !/^[,;\.]+$/.test(trimmed);
    const isShortScriptToken =
      baselineFontSize >= 7.5 &&
      trimmed.length <= 6 &&
      isValidScriptBody;

    const tightHorizGap = prevRightX !== null ? it.x - prevRightX : 999;
    const prevBaseEndsScriptable: boolean =
      rawText.length > 0 &&
      (prevWasGeomScript || /[A-Za-z0-9\)\]α-ωΑ-ΩπΩ]$/.test(rawText.trimEnd()));
    const isHighConfScaledBase: boolean =
      prevRightX !== null &&
      tightHorizGap <= Math.max(4.8, baselineFontSize * 0.45) &&
      prevBaseEndsScriptable;
    const isUnscaledAdjacentScript: boolean =
      isShortScriptToken &&
      prevRightX !== null &&
      tightHorizGap <= Math.max(4.5, baselineFontSize * 0.45) &&
      trimmed.length <= 4 &&
      prevBaseEndsScriptable &&
      /^[0-9+\-=()a-zA-Z]{1,4}$/.test(trimmed);

    const isGeomSub: boolean =
      Boolean(it.isSubScriptFlag) ||
      (isShortScriptToken &&
        !it.isSuperScriptFlag &&
        ((sizeRatio <= 0.80 && isHighConfScaledBase && dy <= -Math.max(0.45, baselineFontSize * 0.045)) ||
          (sizeRatio <= 0.90 && dy <= -Math.max(0.85, baselineFontSize * 0.08)) ||
          (sizeRatio <= 0.96 && dy <= -Math.max(1.6, baselineFontSize * 0.15)) ||
          (isUnscaledAdjacentScript && dy <= -Math.max(1.5, baselineFontSize * 0.14))));

    const isGeomSuper: boolean =
      Boolean(it.isSuperScriptFlag) ||
      (isShortScriptToken &&
        !isGeomSub &&
        ((sizeRatio <= 0.80 && isHighConfScaledBase && dy >= Math.max(0.55, baselineFontSize * 0.055)) ||
          (sizeRatio <= 0.90 && dy >= Math.max(0.95, baselineFontSize * 0.09)) ||
          (sizeRatio <= 0.96 && dy >= Math.max(1.8, baselineFontSize * 0.18)) ||
          (isUnscaledAdjacentScript && dy >= Math.max(1.8, baselineFontSize * 0.16))));

    // Check horizontal gap from previous visible item to insert word spaces ONLY when PDF spacing warrants it
    // Wait before inserting space onto a geometric super/subscript so italic overhang in "mc²", "πr²", "x₁" never splits with a space.
    let needsGapSpace = false;
    if (prevRightX !== null && rawText.length > 0 && !rawText.endsWith(' ') && !cleanStr.startsWith(' ')) {
      const gap = it.x - prevRightX;
      if (isGeomSub || isGeomSuper) {
        if (gap >= Math.max(4.4, baselineFontSize * 0.42)) {
          needsGapSpace = true;
        }
      } else {
        const refSize = prevWasGeomScript
          ? Math.min(baselineFontSize, fontAnalysis.fontSize)
          : Math.min(prevFontSize, fontAnalysis.fontSize);
        const spaceThreshold = Math.max(1.8, refSize * 0.16);
        if (gap >= spaceThreshold) {
          needsGapSpace = true;
        }
      }
    }

    const insertSpaceBefore =
      rawText.length > 0 &&
      !rawText.endsWith(' ') &&
      !cleanStr.startsWith(' ') &&
      (pendingSpace || needsGapSpace);

    pendingSpace = false;

    if (insertSpaceBefore) {
      const lastSpan = rawSpans[rawSpans.length - 1];
      if (
        lastSpan &&
        !lastSpan.isSuperScript &&
        !lastSpan.isSubScript &&
        !lastSpan.lowConfidence &&
        !it.lowConfidence &&
        Boolean(lastSpan.isUnderline) === isItemUnderline
      ) {
        lastSpan.text += ' ';
      } else {
        // Place inter-word space in baseline styling, NEVER inside <sup>/<sub>, lowConfidence highlights, or half-underlined boundaries
        rawSpans.push({
          text: ' ',
          fontSize: baselineFontSize,
          fontFamily: fontAnalysis.fontFamily,
          isBold: false,
          isItalic: false,
          isMonospace: fontAnalysis.isMonospace,
          isUnderline: Boolean(lastSpan?.isUnderline) && isItemUnderline,
          isSuperScript: false,
          isSubScript: false,
          color: fontAnalysis.color,
        });
      }
      rawText += ' ';
    }

    const effectiveSpanFontSize =
      isGeomSub || isGeomSuper
        ? Math.max(fontAnalysis.fontSize, Math.round(baselineFontSize * 9.5) / 10)
        : fontAnalysis.fontSize;

    // If a geometrically tagged script item has leading/trailing whitespace, strip whitespace out cleanly
    const leadingWsMatch = (isGeomSub || isGeomSuper) ? cleanStr.match(/^(\s+)/) : null;
    const trailingWsMatch = (isGeomSub || isGeomSuper) ? cleanStr.match(/(\s+)$/) : null;
    const coreText = (isGeomSub || isGeomSuper) ? cleanStr.trim() : cleanStr;

    if (leadingWsMatch) {
      rawSpans.push({
        text: leadingWsMatch[1],
        fontSize: baselineFontSize,
        fontFamily: fontAnalysis.fontFamily,
        isBold: false,
        isItalic: false,
        isMonospace: fontAnalysis.isMonospace,
        isUnderline: false,
        isSuperScript: false,
        isSubScript: false,
        color: fontAnalysis.color,
      });
      rawText += leadingWsMatch[1];
    }

    let expanded: TextSpan[] = [];
    if (rawTrimmedForMath && !(isGeomSub || isGeomSuper)) {
      const charRuns: { text: string; isBold: boolean; isItalic: boolean }[] = [];
      for (const rawCh of Array.from(rawTrimmedForMath)) {
        const info = normalizeMathUnicodeChar(rawCh);
        const mapped = normalizeExtractedText(rawCh, it.fontName, it.resolvedFontName);
        if (!mapped) continue;
        const chBold = Boolean(fontAnalysis.isBold || info.bold);
        const chItalic = Boolean(fontAnalysis.isItalic || info.italic);
        const lastRun = charRuns[charRuns.length - 1];
        if (lastRun && lastRun.isBold === chBold && lastRun.isItalic === chItalic) {
          lastRun.text += mapped;
        } else {
          charRuns.push({ text: mapped, isBold: chBold, isItalic: chItalic });
        }
      }
      for (const cr of charRuns) {
        expanded.push(
          ...splitSuperSubSpans({
            text: cr.text,
            fontSize: effectiveSpanFontSize,
            fontFamily: fontAnalysis.fontFamily,
            isBold: cr.isBold,
            isItalic: cr.isItalic,
            isMonospace: fontAnalysis.isMonospace,
            isUnderline: isItemUnderline,
            isSuperScript: false,
            isSubScript: false,
            color: fontAnalysis.color,
            ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
            ...(it.lowConfidence ? { lowConfidence: true } : {}),
          })
        );
      }
    } else {
      const trailingPunctSplit =
        (isGeomSub || isGeomSuper) ? coreText.match(/^([0-9+\-=()a-zA-Z]{1,4})([,;.])$/) : null;
      if (trailingPunctSplit) {
        expanded = [
          ...splitSuperSubSpans({
            text: trailingPunctSplit[1],
            fontSize: effectiveSpanFontSize,
            fontFamily: fontAnalysis.fontFamily,
            isBold: fontAnalysis.isBold || mathUnicodeStyle.hasBold,
            isItalic: fontAnalysis.isItalic || mathUnicodeStyle.hasItalic,
            isMonospace: fontAnalysis.isMonospace,
            isUnderline: isItemUnderline,
            isSuperScript: isGeomSuper,
            isSubScript: isGeomSub,
            color: fontAnalysis.color,
            ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
            ...(it.lowConfidence ? { lowConfidence: true } : {}),
          }),
          {
            text: trailingPunctSplit[2],
            fontSize: baselineFontSize,
            fontFamily: fontAnalysis.fontFamily,
            isBold: fontAnalysis.isBold,
            isItalic: fontAnalysis.isItalic,
            isMonospace: fontAnalysis.isMonospace,
            isUnderline: isItemUnderline,
            isSuperScript: false,
            isSubScript: false,
            color: fontAnalysis.color,
            ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
            ...(it.lowConfidence ? { lowConfidence: true } : {}),
          },
        ];
      } else {
        const itemSpan: TextSpan = {
          text: coreText,
          fontSize: effectiveSpanFontSize,
          fontFamily: fontAnalysis.fontFamily,
          isBold: fontAnalysis.isBold || mathUnicodeStyle.hasBold,
          isItalic: fontAnalysis.isItalic || mathUnicodeStyle.hasItalic,
          isMonospace: fontAnalysis.isMonospace,
          isUnderline: isItemUnderline,
          isSuperScript: isGeomSuper,
          isSubScript: isGeomSub,
          color: fontAnalysis.color,
          ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
          ...(it.lowConfidence ? { lowConfidence: true } : {}),
        };
        expanded = splitSuperSubSpans(itemSpan);
      }
    }

    for (const sp of expanded) {
      rawSpans.push(sp);
      rawText += sp.text;
    }

    if (trailingWsMatch) {
      pendingSpace = true;
    }

    prevRightX = it.x + (it.width > 0 ? it.width : trimmed.length * fontAnalysis.fontSize * 0.5);
    prevFontSize = fontAnalysis.fontSize;
    prevWasGeomScript =
      isGeomSub ||
      isGeomSuper ||
      (expanded.length > 0 &&
        Boolean(expanded[expanded.length - 1].isSuperScript || expanded[expanded.length - 1].isSubScript));
  }

  // Merge adjacent runs with identical formatting & review status for clean XML & UI output
  const mergedSpans: TextSpan[] = [];
  for (const sp of rawSpans) {
    const prev = mergedSpans[mergedSpans.length - 1];
    if (
      prev &&
      prev.fontFamily === sp.fontFamily &&
      Math.abs(prev.fontSize - sp.fontSize) < 0.25 &&
      prev.isBold === sp.isBold &&
      prev.isItalic === sp.isItalic &&
      prev.isMonospace === sp.isMonospace &&
      Boolean(prev.isUnderline) === Boolean(sp.isUnderline) &&
      Boolean(prev.isSuperScript) === Boolean(sp.isSuperScript) &&
      Boolean(prev.isSubScript) === Boolean(sp.isSubScript) &&
      Boolean(prev.lowConfidence) === Boolean(sp.lowConfidence) &&
      prev.color === sp.color
    ) {
      prev.text += sp.text;
      if (sp.confidence !== undefined) {
        prev.confidence =
          prev.confidence !== undefined ? Math.min(prev.confidence, sp.confidence) : sp.confidence;
      }
    } else {
      mergedSpans.push({ ...sp });
    }
  }

  return { spans: mergedSpans, rawText };
}

/**
 * Analyzes PDF.js font name, resolved font descriptor, transform matrix, and height
 * to deduce accurate Word typography.
 */
export function analyzeFont(
  rawFontName: string = '',
  height: number = 11,
  transform: number[] = [1, 0, 0, 1, 0, 0],
  defaultFamily: string = 'Arial',
  fontMeta?: PdfFontMetadata
): FontStyleAnalysis {
  const combinedName = `${rawFontName || ''} ${fontMeta?.resolvedName || ''}`.toLowerCase();
  const cssFamilyLower = (fontMeta?.cssFontFamily || '').toLowerCase();

  // Bold detection: combine PDF.js font descriptor flags and PostScript font naming
  const isBold =
    Boolean(fontMeta?.bold || fontMeta?.black) ||
    combinedName.includes('bold') ||
    combinedName.includes('black') ||
    combinedName.includes('heavy') ||
    combinedName.includes('semibold') ||
    combinedName.includes('demi') ||
    combinedName.includes('cmb') ||
    combinedName.includes('cmbx') ||
    /[-_,](b|bd|bx)\b/.test(combinedName);

  // Italic / oblique detection
  const isItalic =
    Boolean(fontMeta?.italic) ||
    combinedName.includes('italic') ||
    combinedName.includes('oblique') ||
    combinedName.includes('slanted') ||
    combinedName.includes('cmi') ||
    combinedName.includes('cmti') ||
    combinedName.includes('ital') ||
    /[-_,](i|it|ob)\b/.test(combinedName);

  // Monospace detection
  const isMonospace =
    Boolean(fontMeta?.isMonospace) ||
    cssFamilyLower.includes('monospace') ||
    combinedName.includes('courier') ||
    combinedName.includes('consolas') ||
    combinedName.includes('mono') ||
    combinedName.includes('code') ||
    combinedName.includes('menlo') ||
    combinedName.includes('inconsolata') ||
    combinedName.includes('sourcecode') ||
    combinedName.includes('firacode') ||
    combinedName.includes('jetbrains') ||
    combinedName.includes('cmtt') ||
    combinedName.includes('fixed') ||
    combinedName.includes('typewriter');

  // Font family resolution
  let fontFamily = defaultFamily;
  if (isMonospace) {
    fontFamily =
      combinedName.includes('consolas') ||
      combinedName.includes('fira') ||
      combinedName.includes('jetbrains') ||
      combinedName.includes('menlo')
        ? 'Consolas'
        : combinedName.includes('courier')
        ? 'Courier New'
        : 'Consolas';
  } else if (
    cssFamilyLower === 'serif' ||
    combinedName.includes('times') ||
    combinedName.includes('georgia') ||
    combinedName.includes('serif') ||
    combinedName.includes('garamond') ||
    combinedName.includes('palatino') ||
    combinedName.includes('cambria') ||
    combinedName.includes('cmr')
  ) {
    fontFamily = combinedName.includes('georgia')
      ? 'Georgia'
      : combinedName.includes('cambria')
      ? 'Cambria'
      : 'Times New Roman';
  } else if (combinedName.includes('calibri')) {
    fontFamily = 'Calibri';
  } else if (
    combinedName.includes('helvetica') ||
    combinedName.includes('arial') ||
    combinedName.includes('liberation') ||
    combinedName.includes('dejavu')
  ) {
    fontFamily = defaultFamily === 'Calibri' ? 'Calibri' : 'Arial';
  }

  // Calculate actual rendered font size in points using full Euclidean transform magnitude
  // Handles normal text as well as skewed/rotated glyphs cleanly
  const scaleX = Math.hypot(transform[0] || 0, transform[1] || 0);
  const scaleY = Math.hypot(transform[2] || 0, transform[3] || 0);
  const calculatedHeight = Math.max(scaleX, scaleY, height || 0);
  const fontSize = Math.max(5.5, Math.min(72, Math.round(calculatedHeight * 10) / 10));

  return {
    fontFamily,
    isBold,
    isItalic,
    isMonospace,
    fontSize,
    color: '111827',
  };
}
