import { StructuredLine, StructuredCodeBlock, TextSpan } from './types';

const CODE_START_REGEX =
  /^(def |async def |class |function |async function |import |from |export |const |let |var |public |private |protected |#|\/\/|\/\*|<!--|return\b|for\s+\w+\s+in\b|while\s*\(?|if\s+__name__)/;

const CODE_SYNTAX_REGEX =
  /(\b(def|class|function|import|from|export|const|let|var|return|if|elif|else|for|while|try|except|catch|finally|print|round|len|sum|range)\b|[=><+\-*/%()\[\]{}:])/;

/**
 * Checks if the majority of non-whitespace characters in a line use a monospace font
 * (prevents prose sentences with a single inline `code` word from becoming code blocks).
 */
function isPredominantlyMonospace(line: StructuredLine): boolean {
  let totalChars = 0;
  let monoChars = 0;
  for (const s of line.spans) {
    const len = s.text.trim().length;
    totalChars += len;
    if (s.isMonospace) monoChars += len;
  }
  return totalChars > 0 && monoChars / totalChars >= 0.7;
}

/**
 * Checks if a line is the start of a programming code block.
 */
export function isLineCodeStart(line: StructuredLine): boolean {
  const raw = line.rawText.trim();
  if (raw.length < 2) return false;

  // Exclude obvious prose headings or ordered list items even if styled unusually
  if (/^(Section\s+\d+|Column\s+[A-Z]|Quarterly\s+|Document\s+Title)/i.test(raw)) {
    return false;
  }
  if (/^\s*(?:\d{1,2}[\.\)]|Step\s+\d+[\.\):\-]|Procedure\s+\d+[\.\):\-]|[•●▪▫◦‣⁃])\s+[A-Z]/i.test(raw) && !isPredominantlyMonospace(line)) {
    return false;
  }

  if (isPredominantlyMonospace(line)) {
    return true;
  }

  return CODE_START_REGEX.test(raw);
}

/**
 * Checks if a subsequent line belongs to an ongoing code block.
 */
export function isLineCodeContinuation(
  line: StructuredLine,
  codeBaseMinX: number,
  prevLineY: number,
  prevWasMonospace: boolean
): boolean {
  const verticalGap = Math.abs(prevLineY - line.y);
  const raw = line.rawText.trim();

  // If line is an explicit large section heading or bullet/numbered list, stop code block
  const maxFontSize = Math.max(...line.spans.map((s) => s.fontSize), 0);
  if (
    maxFontSize >= 13 &&
    (/^(?:Section\s+\d+|\d+[\.\)]\s+[A-Z]|Mathematical|Formatting|Checklist|Objectives|Column\s+[A-Z]\b)/.test(raw) ||
      (!isPredominantlyMonospace(line) && raw.length < 60 && !raw.includes('(') && !raw.includes('=')))
  ) {
    return false;
  }
  if (
    /^([•●▪▫◦\*\-—]|\[[ xX]?\]|[✓✔]|\d{1,2}[\.\)])\s+/.test(raw) ||
    (!isPredominantlyMonospace(line) && /^\d{1,2}[\.\)][A-Z₹€£α-ωΑ-Ω]/.test(raw))
  ) {
    return false;
  }

  const lineIsMono = isPredominantlyMonospace(line);

  // Allow slightly larger vertical gap (e.g. a blank line inside a Python script) when monospace continues
  const maxAllowedGap = lineIsMono && prevWasMonospace ? 44 : 34;
  if (verticalGap > maxAllowedGap) return false;

  if (raw.length === 0) return true;

  // Normal prose sentence without monospace font or code punctuation stops code block
  const isNormalProse =
    !lineIsMono &&
    line.minX <= codeBaseMinX + 6 &&
    /^[A-Z][a-z]+(\s+[a-z]+)+.*[\.!?]$/.test(raw) &&
    !raw.includes('(') &&
    !raw.includes('=') &&
    !raw.includes(':');
  if (isNormalProse) return false;

  if (lineIsMono) {
    return true;
  }

  // Indented relative to base code X
  if (line.minX >= codeBaseMinX + 8 || /^\s{2,}/.test(line.rawText)) {
    return true;
  }

  // Explicit top-level statements / calls following a function definition (e.g., result = ..., print(...))
  if (
    /^(result\s*=|print\(|return\b|percentage\s*=|elif\b|else:|except\b|finally:|@|\w+\s*=\s*[\w\[\{\("']+|[}\])];?$)/i.test(
      raw
    ) ||
    (CODE_SYNTAX_REGEX.test(raw) && (raw.includes('(') || raw.includes('=')))
  ) {
    return true;
  }

  return false;
}

/**
 * Collects all consecutive lines belonging to one unified logical code block.
 */
export function collectCodeBlockLines(
  lines: StructuredLine[],
  startIndex: number
): StructuredLine[] {
  const firstLine = lines[startIndex];
  const codeLines: StructuredLine[] = [firstLine];
  const codeBaseMinX = firstLine.minX;

  let currentY = firstLine.y;
  let prevMono = isPredominantlyMonospace(firstLine);
  let idx = startIndex + 1;

  while (idx < lines.length) {
    const nextLine = lines[idx];
    if (isLineCodeContinuation(nextLine, codeBaseMinX, currentY, prevMono)) {
      codeLines.push(nextLine);
      currentY = nextLine.y;
      prevMono = isPredominantlyMonospace(nextLine);
      idx++;
    } else {
      break;
    }
  }

  return codeLines;
}

/**
 * Estimates exact monospace glyph width in points from positioned PDF.js items.
 */
function estimateMonospaceCharWidth(lines: StructuredLine[]): number {
  const samples: number[] = [];
  for (const l of lines) {
    for (const it of l.items || []) {
      const len = it.str.length;
      if (len >= 4 && it.width > 0) {
        samples.push(it.width / len);
      }
    }
  }
  if (samples.length > 0) {
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    if (median >= 3.5 && median <= 9) return median;
  }
  const avgFontSize =
    lines.reduce((acc, l) => acc + (l.spans[0]?.fontSize || 9.5), 0) /
    Math.max(1, lines.length);
  return avgFontSize * 0.56;
}

/**
 * Builds ONE unified StructuredCodeBlock container preserving all lines,
 * exact leading whitespace, newlines, and Consolas monospace styling.
 */
export function buildUnifiedCodeBlock(lines: StructuredLine[]): StructuredCodeBlock {
  if (lines.length === 0) {
    return {
      type: 'code-block',
      lines: [],
      rawCode: '',
    };
  }

  const nonEmptyLines = lines.filter((l) => l.rawText.trim().length > 0);
  const minX =
    nonEmptyLines.length > 0
      ? Math.min(...nonEmptyLines.map((l) => l.minX))
      : 0;
  const charWidth = estimateMonospaceCharWidth(nonEmptyLines);

  // Compute typical single-line vertical step to optionally preserve blank separator lines inside code
  const steps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > 4 && gap < 22) steps.push(gap);
  }
  const typicalStep =
    steps.length > 0 ? steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)] : 13;

  const formattedLines: { text: string; indentSpaces: number; spans: TextSpan[] }[] = [];
  const rawLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If PDF had an intentional blank code line (e.g. gap >= ~1.85x normal line step) between two code lines
    if (i > 0) {
      const gap = Math.abs(lines[i - 1].y - line.y);
      if (gap >= Math.max(25, typicalStep * 1.85)) {
        formattedLines.push({
          text: '',
          indentSpaces: 0,
          spans: [
            {
              text: '',
              fontSize: 9.5,
              fontFamily: 'Consolas',
              isBold: false,
              isItalic: false,
              isMonospace: true,
              color: '0F172A',
            },
          ],
        });
        rawLines.push('');
      }
    }

    const existingIndentMatch = line.rawText.match(/^(\s+)/);
    const existingIndentCount = existingIndentMatch ? existingIndentMatch[1].length : 0;

    const xOffset = Math.max(0, line.minX - minX);
    const geometricIndent = xOffset > charWidth * 0.75 ? Math.round(xOffset / charWidth) : 0;

    const totalIndent = Math.max(existingIndentCount, geometricIndent);
    const cleanText = line.rawText.trimStart().replace(/\s+$/, '');
    const indentedText = ' '.repeat(totalIndent) + cleanText;

    const monospaceSpans: TextSpan[] = [
      {
        text: indentedText,
        fontSize: 9.5,
        fontFamily: 'Consolas',
        isBold: false,
        isItalic: false,
        isMonospace: true,
        color: '0F172A',
      },
    ];

    formattedLines.push({
      text: indentedText,
      indentSpaces: totalIndent,
      spans: monospaceSpans,
    });

    rawLines.push(indentedText);
  }

  return {
    type: 'code-block',
    lines: formattedLines,
    rawCode: rawLines.join('\n'),
  };
}