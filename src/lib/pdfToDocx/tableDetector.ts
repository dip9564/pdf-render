import {
  PositionedItem,
  StructuredLine,
  StructuredTable,
  StructuredTableCell,
  TextSpan,
} from './types';
import { buildSpansAndTextFromItems, computeModalLineBaseline, normalizeExtractedText } from './fontDetector';
import { VectorTableHints } from './vectorExtractor';

export interface LineCellChunk {
  str: string;
  minX: number;
  maxX: number;
  height: number;
  isBold: boolean;
  items: PositionedItem[];
}

/**
 * Merges horizontally adjacent PDF.js text fragments on a line (gap < ~11pt)
 * into logical cell chunks while preserving wide column gaps (>= 11pt)
 * AND strictly respecting drawn vertical table border dividers.
 */
export function mergeLineItemsIntoChunks(
  line: StructuredLine,
  verticalDividers?: number[]
): LineCellChunk[] {
  const validItems = (line.items || [])
    .filter((it) => it.str && it.str.trim().length > 0)
    .sort((a, b) => a.x - b.x);

  if (validItems.length === 0) {
    const parts = line.rawText.split(/\t+|\s{3,}/).filter((p) => p.trim().length > 0);
    if (parts.length >= 2) {
      const step = (line.maxX - line.minX) / parts.length;
      return parts.map((part, idx) => ({
        str: part.trim(),
        minX: line.minX + idx * step,
        maxX: line.minX + (idx + 1) * step - 5,
        height: line.height || 10,
        isBold: line.spans.some((s) => s.isBold),
        items: [],
      }));
    }
    return [];
  }

  const chunks: LineCellChunk[] = [];
  for (const it of validItems) {
    const normalizedStr = normalizeExtractedText(it.str, it.fontName, it.resolvedFontName);
    if (!normalizedStr.trim()) continue;
    const itFontSize = Math.max(
      it.height || 10,
      Math.hypot(it.transform?.[0] || 0, it.transform?.[1] || 0),
      Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0)
    );
    const itWidth =
      it.width > 0 ? it.width : Math.max(3, normalizedStr.length * itFontSize * 0.48);
    const itMaxX = it.x + itWidth;
    const itBold =
      Boolean(it.isBoldFlag) ||
      `${it.fontName || ''} ${it.resolvedFontName || ''}`
        .toLowerCase()
        .includes('bold');

    const prev = chunks[chunks.length - 1];
    const mergeThreshold = Math.max(10.5, Math.min(14, itFontSize * 1.05));

    // Never merge two text items separated by a drawn vertical table border
    const crossesVerticalDivider =
      Boolean(prev) &&
      Array.isArray(verticalDividers) &&
      verticalDividers.some((vx) => prev!.maxX <= vx + 2.5 && it.x >= vx - 2.5);

    if (prev && !crossesVerticalDivider && it.x - prev.maxX <= mergeThreshold) {
      const gap = it.x - prev.maxX;
      const needsSpace =
        gap >= Math.max(1.8, itFontSize * 0.16) &&
        !prev.str.endsWith(' ') &&
        !normalizedStr.startsWith(' ');
      prev.str += (needsSpace ? ' ' : '') + normalizedStr.trimEnd();
      prev.maxX = Math.max(prev.maxX, itMaxX);
      prev.height = Math.max(prev.height, itFontSize);
      prev.isBold = prev.isBold || itBold;
      prev.items.push(it);
    } else {
      chunks.push({
        str: normalizedStr.trim(),
        minX: it.x,
        maxX: itMaxX,
        height: itFontSize,
        isBold: itBold,
        items: [it],
      });
    }
  }

  return chunks;
}

/**
 * Checks whether a single-chunk line is explanatory prose that must stay outside tables.
 */
function isExplanatoryLine(line: StructuredLine, chunkCount: number): boolean {
  const raw = line.rawText.trim();
  if (
    chunkCount <= 1 &&
    /^(Interpretation:|Note:|Notes:|Comments:|Summary:|Remarks:|Analysis:|Conclusion:|The quarterly |This table |Checklist:?|Objectives:?)/i.test(
      raw
    )
  ) {
    return true;
  }
  if (chunkCount <= 1 && raw.length > 42 && /[\.!?]$/.test(raw)) {
    return true;
  }
  return false;
}

function stripInvisibleChars(str: string): string {
  return str.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
}

function isListMarkerChunkText(str: string): boolean {
  const clean = stripInvisibleChars(str).trim();
  return /^(?:[\(\[]?\d{1,2}[\)\]\.:]?|[•●▪▫◦‣⁃\*\-–—]|✓|✔|☑|✅)$/.test(clean);
}

function extractSequentialMarkerNumber(str: string): number | null {
  const clean = stripInvisibleChars(str).trim();
  const m = clean.match(/^[\(\[]?(\d{1,2})[\)\]\.:]?$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Checks whether a line is code, list, heading, or math prose that must NEVER be treated as a table.
 */
function isNonTableContent(line: StructuredLine, chunkCount: number): boolean {
  const raw = stripInvisibleChars(line.rawText).trim();
  if (!raw) return true;

  // Monospace code or programming constructs
  if (line.spans.some((s) => s.isMonospace)) return true;
  if (/^(def |class |import |from |return |if |elif |else:|for |while |print\(|result\s*=)/.test(raw)) {
    return true;
  }

  // Bulleted or numbered list items (including Step N:, (1), [1], 1., 1), 1:, Unicode bullets)
  if (
    /^([•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅]|\(\d{1,2}\)|\[\d{1,2}\]|\d{1,2}[\.\):]|Step\s+\d{1,2}[\.\):\-])\s+/i.test(
      raw
    )
  ) {
    return true;
  }
  if (line.items && line.items.length > 0) {
    const firstStr = stripInvisibleChars(line.items[0].str).trim();
    const fn = `${line.items[0].fontName || ''} ${line.items[0].resolvedFontName || ''}`.toLowerCase();
    if (
      ['•', '●', '▪', '▫', 'l', 'n', '✓', '✔'].includes(firstStr) &&
      (fn.includes('symbol') || fn.includes('dingbat') || fn.includes('wingding'))
    ) {
      return true;
    }
  }

  // Section Headings (large single-chunk text)
  if (chunkCount <= 1 && line.spans.some((s) => s.fontSize >= 13) && raw.length < 85) {
    return true;
  }

  // Mathematical formula prose (single contiguous line OR explicit multi-chunk equations without table pipes)
  if (
    !raw.includes('|') &&
    /(E\s*=\s*mc\s*[²2]?|x\s*[₁1]\s*\+\s*x\s*[₂2]\s*=|π\s*r\s*[²2]|Area\s*=\s*π\s*r\s*[²2]?|[αβγΩ].*[≤≥×÷]|[≤≥×÷].*[αβγΩ])/i.test(
      raw
    )
  ) {
    return true;
  }
  if (chunkCount <= 1 && /[αβγΩ≤≥×÷₹€£π]/.test(raw)) {
    return true;
  }

  return false;
}

interface CandidateRow {
  line: StructuredLine;
  chunks: LineCellChunk[];
  continuations: { chunk: LineCellChunk; line: StructuredLine }[];
}

function clusterSortedNumbers(vals: number[], tol: number = 3.5): number[] {
  if (vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = groups[groups.length - 1];
    if (sorted[i] - last[last.length - 1] <= tol) {
      last.push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/**
 * Finds drawn vertical/horizontal grid dividers relevant to a Y band [minY .. maxY].
 */
function extractBandGridDividers(
  vectorHints: VectorTableHints | undefined,
  minY: number,
  maxY: number,
  minX: number,
  maxX: number
): { interiorVLines: number[]; hintSplitLines: number[]; allVLines: number[]; hLines: number[] } {
  if (!vectorHints) return { interiorVLines: [], hintSplitLines: [], allVLines: [], hLines: [] };

  const spanH = Math.max(20, maxY - minY);
  // Group vertically collinear segments sharing X so per-cell border boxes fuse across the table height
  const rawMatchingVs = vectorHints.vSegments.filter(
    (v) =>
      v.y2 >= minY - 14 &&
      v.y1 <= maxY + 14 &&
      v.x >= minX - 18 &&
      v.x <= maxX + 18
  );
  const vXClusters = clusterSortedNumbers(
    rawMatchingVs.map((v) => v.x),
    3.5
  );
  const qualifiedVs: number[] = [];
  const minRequiredVCov = Math.min(22, spanH * 0.42);
  for (const vx of vXClusters) {
    const segsAtX = rawMatchingVs
      .filter((v) => Math.abs(v.x - vx) <= 3.5)
      .map((v) => [Math.max(minY - 14, v.y1), Math.min(maxY + 14, v.y2)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let cov = 0;
    let curA = -Infinity;
    let curB = -Infinity;
    for (const [a, b] of segsAtX) {
      if (a <= curB + 4) {
        curB = Math.max(curB, b);
      } else {
        if (curB > curA) cov += curB - curA;
        curA = a;
        curB = b;
      }
    }
    if (curB > curA) cov += curB - curA;
    if (cov >= minRequiredVCov) qualifiedVs.push(vx);
  }
  const allVLines = clusterSortedNumbers(qualifiedVs, 4.0);
  // Interior dividers sit strictly inside text edges (exclude left/right outer box borders)
  const interiorVLines = allVLines.filter((vx) => vx > minX + 6 && vx < maxX - 6);

  // Also collect pixel-valley column split hints overlapping this table Y-band
  const rawHintXs = (vectorHints.columnSplitHints || [])
    .filter((h) => h.maxY >= minY - 14 && h.minY <= maxY + 14)
    .flatMap((h) => h.xs)
    .filter((x) => x > minX + 6 && x < maxX - 6);
  const hintSplitLines = clusterSortedNumbers(rawHintXs, 4.0);

  const matchingHs = vectorHints.hSegments.filter(
    (h) =>
      h.y >= minY - 16 &&
      h.y <= maxY + 16 &&
      h.x2 >= minX - 18 &&
      h.x1 <= maxX + 18 &&
      h.x2 - h.x1 >= Math.max(40, (maxX - minX) * 0.35)
  );
  const hLines = clusterSortedNumbers(
    matchingHs.map((h) => h.y),
    3.0
  ).sort((a, b) => b - a); // Top-down

  return { interiorVLines, hintSplitLines, allVLines, hLines };
}

/**
 * Sub-splits coarse column ranges by inspecting raw positioned items (before wide-gap merging)
 * to recover missing vertical borders or tight column gutters (e.g., 4x2 -> 4x4 in scanned OCR tables)
 * without splitting normal multi-word phrases inside cells.
 */
function findItemLevelSubGuttersInRange(
  candidateRows: CandidateRow[],
  rangeStart: number,
  rangeEnd: number,
  avgHeight: number
): number[] {
  if (rangeEnd - rangeStart < 44 || candidateRows.length < 2) return [];

  const perRowExtents: { minX: number; maxX: number }[][] = [];
  const intraGaps: number[] = [];

  for (const row of candidateRows) {
    const itemsInRange = (row.line.items || [])
      .filter((it) => it.str && it.str.trim().length > 0)
      .map((it) => {
        const itFS = Math.max(
          it.height || 10,
          Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0)
        );
        const itW = it.width > 0 ? it.width : Math.max(3, it.str.trim().length * itFS * 0.48);
        const center = it.x + itW / 2;
        return { minX: it.x, maxX: it.x + itW, center };
      })
      .filter((it) => it.center >= rangeStart && it.center < rangeEnd)
      .sort((a, b) => a.minX - b.minX);

    if (itemsInRange.length > 0) {
      for (let k = 1; k < itemsInRange.length; k++) {
        const g = itemsInRange[k].minX - itemsInRange[k - 1].maxX;
        if (g >= 1.2 && g <= 4.2) intraGaps.push(g);
      }
      perRowExtents.push(itemsInRange.map((it) => ({ minX: it.minX, maxX: it.maxX })));
    } else {
      perRowExtents.push([]);
    }
  }

  const allItems = perRowExtents.flat();
  if (allItems.length < 3) return [];

  const localMinX = Math.max(rangeStart, Math.min(...allItems.map((i) => i.minX)));
  const localMaxX = Math.min(rangeEnd, Math.max(...allItems.map((i) => i.maxX)));
  if (localMaxX - localMinX < 36) return [];

  // 0.5pt resolution occupancy grid across all items in this range
  const binScale = 2;
  const startBin = Math.floor(localMinX * binScale);
  const endBin = Math.ceil(localMaxX * binScale);
  const binCount = endBin - startBin + 1;
  if (binCount < 16) return [];

  const occRows = new Uint16Array(binCount);
  for (const rowItems of perRowExtents) {
    const rowMask = new Uint8Array(binCount);
    for (const it of rowItems) {
      const s = Math.max(0, Math.floor((it.minX - 0.1) * binScale) - startBin);
      const e = Math.min(binCount - 1, Math.ceil((it.maxX + 0.1) * binScale) - startBin);
      for (let b = s; b <= e; b++) rowMask[b] = 1;
    }
    for (let b = 0; b < binCount; b++) {
      if (rowMask[b]) occRows[b]++;
    }
  }

  intraGaps.sort((a, b) => a - b);
  const medianIntraSpace =
    intraGaps.length > 0 ? intraGaps[Math.floor(intraGaps.length * 0.5)] : Math.max(2.6, avgHeight * 0.27);
  const minSubGutter = Math.max(4.5, Math.min(8.5, avgHeight * 0.42));

  // Allow empty vertical lanes (0 overlapping rows, or at most 1 row overhang when total >= 4 rows and clean center exists)
  const maxAllowedNoiseRows = candidateRows.length >= 4 ? 1 : 0;
  const candidateCenters: { center: number; width: number }[] = [];
  let inLane = false;
  let laneStart = 0;

  for (let b = 0; b < binCount; b++) {
    if (occRows[b] <= maxAllowedNoiseRows) {
      if (!inLane) {
        inLane = true;
        laneStart = b;
      }
    } else if (inLane) {
      inLane = false;
      const laneW = (b - laneStart) / binScale;
      if (laneW >= minSubGutter) {
        // Compute tight center inside purely empty bins if possible
        let pureStart = -1;
        let pureEnd = -1;
        for (let k = laneStart; k < b; k++) {
          if (occRows[k] === 0) {
            if (pureStart === -1) pureStart = k;
            pureEnd = k;
          }
        }
        const centerBin = pureStart !== -1 ? (pureStart + pureEnd + 1) / 2 : (laneStart + b) / 2;
        candidateCenters.push({ center: (startBin + centerBin) / binScale, width: laneW });
      }
    }
  }

  const validSplits: number[] = [];
  for (const cand of candidateCenters) {
    let bothSides = 0;
    const rightMinXs: number[] = [];
    const rightMaxXs: number[] = [];
    const leftMinXs: number[] = [];

    for (const rowItems of perRowExtents) {
      const left = rowItems.filter((it) => (it.minX + it.maxX) / 2 < cand.center);
      const right = rowItems.filter((it) => (it.minX + it.maxX) / 2 >= cand.center);
      if (left.length > 0 && right.length > 0) {
        // Ensure items don't badly straddle the split center
        const maxLeft = Math.max(...left.map((it) => it.maxX));
        const minRight = Math.min(...right.map((it) => it.minX));
        if (maxLeft <= cand.center + 1.5 && minRight >= cand.center - 1.5) {
          bothSides++;
        }
      }
      if (left.length > 0) leftMinXs.push(Math.min(...left.map((it) => it.minX)));
      if (right.length > 0) {
        rightMinXs.push(Math.min(...right.map((it) => it.minX)));
        rightMaxXs.push(Math.max(...right.map((it) => it.maxX)));
      }
    }

    const requiredBoth = Math.max(2, Math.ceil(candidateRows.length * 0.62));
    if (bothSides < requiredBoth) continue;

    // Protect normal multi-word phrases with narrow coincidental gaps by checking width OR column alignment
    const rightLeftSpread =
      rightMinXs.length >= 2 ? Math.max(...rightMinXs) - Math.min(...rightMinXs) : 99;
    const rightEdgeSpread =
      rightMaxXs.length >= 2 ? Math.max(...rightMaxXs) - Math.min(...rightMaxXs) : 99;
    const leftEdgeSpread =
      leftMinXs.length >= 2 ? Math.max(...leftMinXs) - Math.min(...leftMinXs) : 99;

    const isClearlyWideGutter = cand.width >= Math.max(7.2, medianIntraSpace * 2.1);
    const hasAlignedColumnEdge =
      (rightLeftSpread <= 7.5 || rightEdgeSpread <= 7.5 || leftEdgeSpread <= 6.5) &&
      cand.width >= Math.max(4.6, medianIntraSpace * 1.45);

    if (isClearlyWideGutter || hasAlignedColumnEdge) {
      validSplits.push(cand.center);
    }
  }

  return validSplits;
}

/**
 * Peeks at raw item alignment across the first few candidate lines to discover tight table column splits
 * even before chunk merging when inter-column gaps are slightly below the chunk merge threshold.
 */
function peekTightTableSplitXs(lines: StructuredLine[]): number[] {
  if (lines.length < 2) return [];
  const sample: CandidateRow[] = [];
  let prevY = lines[0].y;
  let prevH = lines[0].height || 11;
  for (let k = 0; k < Math.min(lines.length, 6); k++) {
    const l = lines[k];
    if (k > 0 && Math.abs(prevY - l.y) > Math.max(36, prevH * 3.0)) break;
    if (isNonTableContent(l, Math.max(1, l.items?.length || 1))) break;
    sample.push({ line: l, chunks: [], continuations: [] });
    prevY = l.y;
    prevH = l.height || 11;
  }
  if (sample.length < 2) return [];
  const minX = Math.min(...sample.map((s) => s.line.minX));
  const maxX = Math.max(...sample.map((s) => s.line.maxX));
  return findItemLevelSubGuttersInRange(sample, minX - 2, maxX + 2, prevH);
}

/**
 * Detects whether a sequence of lines forms an aligned table structure (data table or key-value metadata table)
 * and reconstructs exact column boundaries, wrapped cells, cell formatting, and proportional column widths.
 */
export function detectTableInLines(
  lines: StructuredLine[],
  pagePrintableWidthTwips: number,
  defaultFontFamily: string = 'Arial',
  vectorHints?: VectorTableHints
): { table: StructuredTable | null; consumedLineCount: number } {
  if (lines.length < 2) return { table: null, consumedLineCount: 0 };

  // Seed vertical dividers + column split hints crossing the very first candidate line so even tight bordered cells split cleanly
  const row0VectorSplits = vectorHints
    ? [
        ...vectorHints.vSegments
          .filter(
            (v) =>
              v.y1 <= lines[0].y + 8 &&
              v.y2 >= lines[0].y - 18 &&
              v.x > lines[0].minX + 5 &&
              v.x < lines[0].maxX - 5
          )
          .map((v) => v.x),
        ...(vectorHints.columnSplitHints || [])
          .filter((h) => h.minY <= lines[0].y + 8 && h.maxY >= lines[0].y - 18)
          .flatMap((h) => h.xs)
          .filter((x) => x > lines[0].minX + 5 && x < lines[0].maxX - 5),
      ]
    : [];
  const peekedSplits = row0VectorSplits.length === 0 ? peekTightTableSplitXs(lines) : [];
  const row0VDividers = clusterSortedNumbers([...row0VectorSplits, ...peekedSplits], 4.0);

  const firstChunks = mergeLineItemsIntoChunks(lines[0], row0VDividers);
  if (
    firstChunks.length < 2 ||
    isNonTableContent(lines[0], firstChunks.length) ||
    isExplanatoryLine(lines[0], firstChunks.length)
  ) {
    return { table: null, consumedLineCount: 0 };
  }

  const candidateRows: CandidateRow[] = [
    { line: lines[0], chunks: firstChunks, continuations: [] },
  ];
  let consumedLineCount = 1;
  let lastLineY = lines[0].y;
  let lastLineHeight = lines[0].height || 11;

  // Track left edge of Column >= 1 so indented wrapped cell lines merge back into previous row
  const col0MinX = firstChunks[0].minX;
  const col1StartX = firstChunks[1].minX;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const chunks = mergeLineItemsIntoChunks(line, row0VDividers);
    const verticalGap = Math.abs(lastLineY - line.y);

    // Stop if there's an unusually large vertical break suggesting a new section
    if (verticalGap > Math.max(40, lastLineHeight * 3.2)) {
      break;
    }

    if (isNonTableContent(line, chunks.length)) {
      break;
    }

    if (chunks.length >= 2) {
      candidateRows.push({ line, chunks, continuations: [] });
      consumedLineCount++;
      lastLineY = line.y;
      lastLineHeight = line.height || 11;
    } else if (chunks.length === 1) {
      const single = chunks[0];
      const minLaterColX = Math.min(
        col1StartX,
        ...candidateRows.flatMap((r) => (r.chunks.length >= 2 ? [r.chunks[1].minX] : []))
      );
      const isIndentedCellContinuation =
        single.minX >= col0MinX + 24 &&
        single.minX >= minLaterColX - 22 &&
        verticalGap <= Math.max(22, lastLineHeight * 1.95) &&
        !/^(?:Section\s+\d+|\d+[\.\)]\s+[A-Z]|Column\s+[A-Z](?:\b|:)|Step\s+\d+)/i.test(
          single.str
        );

      // Also check whether a horizontal vector border encloses the previous row AND this single line together
      const noRuleBetween =
        vectorHints &&
        row0VDividers.length >= 1 &&
        verticalGap <= Math.max(20, lastLineHeight * 1.75) &&
        !isExplanatoryLine(line, 1) &&
        !vectorHints.hSegments.some(
          (h) => h.y < lastLineY - 1 && h.y > line.y + line.height * 0.6
        );

      // Also handle vertically centered single-chunk first-column header label within Row 0 band
      const isCenteredRow0HeaderCont =
        candidateRows.length === 1 &&
        verticalGap <= Math.max(18, lastLineHeight * 1.6) &&
        !isExplanatoryLine(line, 1) &&
        single.str.trim().length <= 28 &&
        i + 1 < lines.length &&
        mergeLineItemsIntoChunks(lines[i + 1], row0VDividers).length >= 2 &&
        Math.abs(line.y - lines[i + 1].y) <= 20;

      if (isIndentedCellContinuation || noRuleBetween || isCenteredRow0HeaderCont) {
        candidateRows[candidateRows.length - 1].continuations.push({ chunk: single, line });
        consumedLineCount++;
        lastLineY = line.y;
        lastLineHeight = line.height || 11;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Genuine table needs at least 2 distinct multi-column rows
  if (candidateRows.length < 2) {
    return { table: null, consumedLineCount: 0 };
  }

  // Re-evaluate vector grid lines across the full table vertical band
  const bandMinY = Math.min(...candidateRows.map((r) => r.line.y));
  const bandMaxY = Math.max(...candidateRows.map((r) => r.line.y + (r.line.height || 11)));
  const bandMinX = Math.min(...candidateRows.flatMap((r) => r.chunks.map((c) => c.minX)));
  const bandMaxX = Math.max(...candidateRows.flatMap((r) => r.chunks.map((c) => c.maxX)));

  const { interiorVLines, hintSplitLines, hLines } = extractBandGridDividers(
    vectorHints,
    bandMinY,
    bandMaxY,
    bandMinX,
    bandMaxX
  );

  // Merge strict interior border lines with any bitmap column-valley hints that do not collide with word centers
  const combinedBandSplits = clusterSortedNumbers([...interiorVLines, ...hintSplitLines], 4.0);
  if (combinedBandSplits.length >= 1) {
    for (const r of candidateRows) {
      const rechunked = mergeLineItemsIntoChunks(r.line, combinedBandSplits);
      if (rechunked.length >= 1) r.chunks = rechunked;
    }
  }

  // Never convert a 2-column hanging-indent numbered/bulleted list into a 2-col table!
  if (candidateRows.every((r) => r.chunks.length === 2 && isListMarkerChunkText(r.chunks[0].str))) {
    const seqNums = candidateRows.map((r) => extractSequentialMarkerNumber(r.chunks[0].str));
    const allSequentialNumbers =
      seqNums.every((n) => n !== null) &&
      seqNums.every((n, idx) => idx === 0 || n === seqNums[idx - 1]! + 1);
    const allBullets = candidateRows.every((r) => extractSequentialMarkerNumber(r.chunks[0].str) === null);
    if (allSequentialNumbers || allBullets) {
      return { table: null, consumedLineCount: 0 };
    }
  }

  // 2. Compute Table Bounding Box across all chunks (primary + wrapped continuations)
  const allChunks = candidateRows.flatMap((r) => [
    ...r.chunks,
    ...r.continuations.map((c) => c.chunk),
  ]);
  const tableMinX = Math.min(...allChunks.map((c) => c.minX));
  const tableMaxX = Math.max(...allChunks.map((c) => c.maxX));
  const tableWidth = tableMaxX - tableMinX;

  if (tableWidth < 70) {
    return { table: null, consumedLineCount: 0 };
  }

  // 3. Determine Column Ranges:
  // Priority A: Exact interior vertical table dividers / pixel-valley hints from vector graphics or OCR grid
  // Priority B: Horizontal Occupancy Projection + Complementary-Column Gutter Pruning
  // Priority C: Item-level sub-column gutter splitting (fixes 4x2 when 1 border is missing or word bboxes shrink gaps)
  let columnRanges: { start: number; end: number }[] = [];
  const seedDividers = combinedBandSplits.length >= 1 ? combinedBandSplits : [];

  if (seedDividers.length >= 1) {
    const candidateRanges: { start: number; end: number }[] = [
      { start: tableMinX - 2, end: seedDividers[0] },
    ];
    for (let v = 0; v < seedDividers.length - 1; v++) {
      candidateRanges.push({ start: seedDividers[v], end: seedDividers[v + 1] });
    }
    candidateRanges.push({
      start: seedDividers[seedDividers.length - 1],
      end: tableMaxX + 2,
    });
    if (candidateRanges.length >= 2) {
      columnRanges = candidateRanges;
    }
  }

  if (columnRanges.length < 2) {
    const binStart = Math.floor(tableMinX);
    const binEnd = Math.ceil(tableMaxX);
    const binCount = binEnd - binStart + 1;
    const occupiedBins = new Uint8Array(binCount);

    for (const ch of allChunks) {
      const s = Math.max(0, Math.floor(ch.minX - binStart));
      const e = Math.min(binCount - 1, Math.ceil(ch.maxX - binStart));
      for (let b = s; b <= e; b++) {
        occupiedBins[b] = 1;
      }
    }

    interface Gutter {
      start: number;
      end: number;
      center: number;
    }
    const gutters: Gutter[] = [];
    let inGutter = false;
    let gStart = 0;
    const avgHeight =
      allChunks.reduce((acc, c) => acc + (c.height || 10), 0) / Math.max(1, allChunks.length);
    const minGutterWidth = Math.max(11, Math.min(15, avgHeight * 1.1));

    for (let b = 0; b < binCount; b++) {
      if (occupiedBins[b] === 0) {
        if (!inGutter) {
          inGutter = true;
          gStart = b;
        }
      } else if (inGutter) {
        inGutter = false;
        const gWidth = b - gStart;
        if (gWidth >= minGutterWidth) {
          gutters.push({
            start: binStart + gStart,
            end: binStart + b,
            center: binStart + (gStart + b) / 2,
          });
        }
      }
    }

    if (gutters.length >= 1) {
      columnRanges.push({ start: tableMinX, end: gutters[0].center });
      for (let g = 0; g < gutters.length - 1; g++) {
        columnRanges.push({ start: gutters[g].center, end: gutters[g + 1].center });
      }
      columnRanges.push({ start: gutters[gutters.length - 1].center, end: tableMaxX });
    } else {
      const centers = candidateRows[0].chunks
        .map((c) => (c.minX + c.maxX) / 2)
        .sort((a, b) => a - b);
      if (centers.length < 2) return { table: null, consumedLineCount: 0 };
      for (let c = 0; c < centers.length; c++) {
        const prev = c === 0 ? tableMinX : (centers[c - 1] + centers[c]) / 2;
        const next = c === centers.length - 1 ? tableMaxX : (centers[c] + centers[c + 1]) / 2;
        columnRanges.push({ start: prev, end: next });
      }
    }
  }

  // Always check coarse column ranges (e.g., 2 wide buckets from 1 middle border or glued OCR gaps)
  // for crisp multi-row item-level vertical sub-column gutters!
  const avgRowHeight =
    allChunks.reduce((acc, c) => acc + (c.height || 10), 0) / Math.max(1, allChunks.length);
  const refinedRanges: { start: number; end: number }[] = [];
  let discoveredSubSplits = false;
  for (const r of columnRanges) {
    const subSplits = findItemLevelSubGuttersInRange(
      candidateRows,
      r.start,
      r.end,
      avgRowHeight
    );
    if (subSplits.length > 0) {
      discoveredSubSplits = true;
      let prev = r.start;
      for (const sp of subSplits) {
        refinedRanges.push({ start: prev, end: sp });
        prev = sp;
      }
      refinedRanges.push({ start: prev, end: r.end });
    } else {
      refinedRanges.push(r);
    }
  }
  columnRanges = refinedRanges;

  // Re-chunk candidate rows against ALL discovered column split boundaries so no glued chunks straddle columns
  if (discoveredSubSplits) {
    const allSplitXs = columnRanges.slice(1).map((r) => r.start);
    for (const r of candidateRows) {
      const rechunked = mergeLineItemsIntoChunks(r.line, allSplitXs);
      if (rechunked.length >= 1) r.chunks = rechunked;
    }
  }

  // ------------------------------------------------------------------
  // 3b. Complementary-Column Pruning for Borderless / Aligned Tables
  // Fixes left-aligned headers (e.g. "Input files") + right-aligned numbers ("120..210")
  // being split across a false internal gutter into 5 columns instead of 4.
  // ------------------------------------------------------------------
  if (interiorVLines.length === 0 && !discoveredSubSplits && hintSplitLines.length === 0 && columnRanges.length > 2) {
    const maxRowChunks = Math.max(...candidateRows.map((r) => r.chunks.length), 2);

    const findColIndex = (chunk: LineCellChunk, ranges: { start: number; end: number }[]): number => {
      const center = (chunk.minX + chunk.maxX) / 2;
      for (let c = 0; c < ranges.length; c++) {
        if (c === 0 && center < ranges[c].end) return 0;
        if (c === ranges.length - 1 && center >= ranges[c].start) return ranges.length - 1;
        if (center >= ranges[c].start && center < ranges[c].end) return c;
      }
      return ranges.length - 1;
    };

    let changed = true;
    while (changed && columnRanges.length > 2) {
      changed = false;
      const colCount = columnRanges.length;

      // Track per-row occupancy and minX/maxX per bucket
      const occ: boolean[][] = candidateRows.map(() => new Array(colCount).fill(false));
      const colMinX: number[] = new Array(colCount).fill(Infinity);
      const colMaxX: number[] = new Array(colCount).fill(-Infinity);

      candidateRows.forEach((row, rIdx) => {
        for (const ch of [...row.chunks, ...row.continuations.map((k) => k.chunk)]) {
          const c = findColIndex(ch, columnRanges);
          occ[rIdx][c] = true;
          colMinX[c] = Math.min(colMinX[c], ch.minX);
          colMaxX[c] = Math.max(colMaxX[c], ch.maxX);
        }
      });

      // Prune completely empty ranges first
      const emptyIdx = colMinX.findIndex((v) => !Number.isFinite(v));
      if (emptyIdx !== -1 && colCount > 2) {
        if (emptyIdx === 0) {
          columnRanges[1].start = columnRanges[0].start;
          columnRanges.splice(0, 1);
        } else {
          columnRanges[emptyIdx - 1].end = columnRanges[emptyIdx].end;
          columnRanges.splice(emptyIdx, 1);
        }
        changed = true;
        continue;
      }

      // Check adjacent pairs that never appear together on the same row
      let bestMergeIdx = -1;
      let bestMergeScore = Infinity;

      for (let c = 0; c < colCount - 1; c++) {
        let bothOccupied = 0;
        let leftOnly = 0;
        let rightOnly = 0;
        for (let r = 0; r < candidateRows.length; r++) {
          if (occ[r][c] && occ[r][c + 1]) bothOccupied++;
          else if (occ[r][c]) leftOnly++;
          else if (occ[r][c + 1]) rightOnly++;
        }

        if (bothOccupied > 0) continue;

        const gap = Math.max(0, colMinX[c + 1] - colMaxX[c]);
        const isHeaderBodySplit =
          (occ[0][c] && leftOnly === 1 && !occ[0][c + 1] && rightOnly >= 2) ||
          (occ[0][c + 1] && rightOnly === 1 && !occ[0][c] && leftOnly >= 2);
        const exceedsRowChunkBudget = colCount > maxRowChunks;
        const singleRowArtifactSplit = leftOnly === 1 || rightOnly === 1;

        const maxAllowedGap = isHeaderBodySplit && exceedsRowChunkBudget ? 115 : 72;
        if (
          gap <= maxAllowedGap &&
          (isHeaderBodySplit ||
            exceedsRowChunkBudget ||
            (singleRowArtifactSplit && gap <= 46))
        ) {
          // Prefer genuine header+data splits and smallest horizontal distance
          const score = gap - (isHeaderBodySplit ? 40 : 0) - (exceedsRowChunkBudget ? 20 : 0);
          if (score < bestMergeScore) {
            bestMergeScore = score;
            bestMergeIdx = c;
          }
        }
      }

      if (bestMergeIdx !== -1) {
        columnRanges[bestMergeIdx] = {
          start: columnRanges[bestMergeIdx].start,
          end: columnRanges[bestMergeIdx + 1].end,
        };
        columnRanges.splice(bestMergeIdx + 1, 1);
        changed = true;
      }
    }
  }

  let columnCount = columnRanges.length;
  if (columnCount < 2) {
    return { table: null, consumedLineCount: 0 };
  }

  // Assign each row's chunks & continuations into its exact column buckets
  type CellBucket = {
    spans: TextSpan[];
    text: string;
    isBold: boolean;
    pdfWidth: number;
  };

  let rawMatrix: CellBucket[][] = candidateRows.map((row) => {
    const rowCols: { chunks: LineCellChunk[]; baselineY: number; height: number }[] = Array.from(
      { length: columnCount },
      () => ({ chunks: [], baselineY: row.line.y, height: row.line.height || 10 })
    );

    const assignToCol = (chunk: LineCellChunk) => {
      const center = (chunk.minX + chunk.maxX) / 2;
      let targetCol = columnCount - 1;
      for (let c = 0; c < columnCount; c++) {
        if (c === 0 && center < columnRanges[c].end) {
          targetCol = 0;
          break;
        } else if (c === columnCount - 1 && center >= columnRanges[c].start) {
          targetCol = columnCount - 1;
          break;
        } else if (center >= columnRanges[c].start && center < columnRanges[c].end) {
          targetCol = c;
          break;
        }
      }
      rowCols[targetCol].chunks.push(chunk);
    };

    for (const ch of row.chunks) assignToCol(ch);
    for (const cont of row.continuations) assignToCol(cont.chunk);

    return rowCols.map((bucket) => {
      if (bucket.chunks.length === 0) {
        return { spans: [], text: '', isBold: false, pdfWidth: 0 };
      }

      const combinedSpans: TextSpan[] = [];
      let combinedText = '';
      let anyBold = false;

      bucket.chunks.sort((a, b) => {
        const yA = a.items[0]?.y ?? bucket.baselineY;
        const yB = b.items[0]?.y ?? bucket.baselineY;
        if (Math.abs(yA - yB) > 4) return yB - yA;
        return a.minX - b.minX;
      });

      const lineGroups: LineCellChunk[][] = [];
      for (const ch of bucket.chunks) {
        const chY = ch.items[0]?.y ?? bucket.baselineY;
        const lastGrp = lineGroups[lineGroups.length - 1];
        if (lastGrp && Math.abs((lastGrp[0].items[0]?.y ?? bucket.baselineY) - chY) <= 4.5) {
          lastGrp.push(ch);
        } else {
          lineGroups.push([ch]);
        }
      }

      lineGroups.forEach((grp, gIdx) => {
        const items = grp.flatMap((g) => g.items);
        let grpSpans: TextSpan[];
        let grpText: string;
        if (items.length > 0) {
          const { baselineY: cellBaseY, baselineFontSize: cellBaseFS } =
            computeModalLineBaseline(items);
          const built = buildSpansAndTextFromItems(
            items,
            cellBaseY,
            cellBaseFS,
            defaultFontFamily
          );
          grpSpans = built.spans;
          grpText = built.rawText.trim();
        } else {
          grpText = grp.map((g) => g.str).join(' ').trim();
          grpSpans = [
            {
              text: grpText,
              fontSize: 9.5,
              fontFamily: defaultFontFamily,
              isBold: grp.some((g) => g.isBold),
              isItalic: false,
              isMonospace: false,
              color: '111827',
            },
          ];
        }

        if (gIdx > 0 && combinedText && grpSpans.length > 0) {
          combinedText += ' ';
          grpSpans[0] = { ...grpSpans[0], text: ' ' + grpSpans[0].text };
        }
        combinedText += grpText;
        for (const sp of grpSpans) {
          combinedSpans.push(sp);
          if (sp.isBold) anyBold = true;
        }
      });

      const minChunkX = Math.min(...bucket.chunks.map((c) => c.minX));
      const maxChunkX = Math.max(...bucket.chunks.map((c) => c.maxX));

      return {
        spans: combinedSpans,
        text: combinedText.trim(),
        isBold: anyBold,
        pdfWidth: Math.max(0, maxChunkX - minChunkX),
      };
    });
  });

  // Strip any completely empty columns (guard against trailing/spurious empty column)
  const nonEmptyColIndices: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    if (rawMatrix.some((row) => row[c].text.trim().length > 0)) {
      nonEmptyColIndices.push(c);
    }
  }
  if (nonEmptyColIndices.length >= 2 && nonEmptyColIndices.length < columnCount) {
    rawMatrix = rawMatrix.map((row) => nonEmptyColIndices.map((idx) => row[idx]));
    columnCount = nonEmptyColIndices.length;
  }

  // Merge wrapped 2-line header row (Row 0 + Row 1) cleanly when Row 1 holds wrapped header fragments
  if (rawMatrix.length >= 3) {
    const r0 = rawMatrix[0];
    const r1 = rawMatrix[1];
    const r0Y = candidateRows[0].line.y;
    const r1Y = candidateRows[1].line.y;
    const r2Y = candidateRows[2].line.y;

    const hRuleBetween0And1 = hLines.some((hy) => hy < r0Y - 1 && hy > r1Y + 4);
    const hRuleBetween1And2 = hLines.some((hy) => hy < r1Y - 1 && hy > r2Y + 4);

    const r1HasNumericData = r1.some((cell) => /\d+%?$/.test(cell.text) || /[$₹€£]/.test(cell.text));
    const r1ShortWordsOnly = r1.every(
      (cell) => cell.text === '' || (cell.text.length <= 22 && !cell.text.endsWith('.'))
    );
    const r1BoldOrMatchesHeader =
      r0.every((c) => c.text === '' || c.isBold) &&
      r1.some((c) => c.text !== '') &&
      r1.filter((c) => c.text !== '').every((c) => c.isBold || c.text.startsWith('('));

    const r2StartsBody =
      rawMatrix[2].some((c) => !c.isBold || /\d+%?$/.test(c.text));

    if (
      !r1HasNumericData &&
      r1ShortWordsOnly &&
      !hRuleBetween0And1 &&
      (hRuleBetween1And2 ||
        (r1BoldOrMatchesHeader &&
          (r1.filter((c) => c.text !== '').length < columnCount || r2StartsBody)))
    ) {
      for (let c = 0; c < columnCount; c++) {
        if (r1[c].text) {
          const prefixSpace = r0[c].text ? ' ' : '';
          r0[c] = {
            text: (r0[c].text + prefixSpace + r1[c].text).trim(),
            isBold: r0[c].isBold || r1[c].isBold,
            pdfWidth: Math.max(r0[c].pdfWidth, r1[c].pdfWidth),
            spans:
              r0[c].spans.length > 0 && r1[c].spans.length > 0
                ? [
                    ...r0[c].spans,
                    { ...r1[c].spans[0], text: prefixSpace + r1[c].spans[0].text },
                    ...r1[c].spans.slice(1),
                  ]
                : [...r0[c].spans, ...r1[c].spans],
          };
        }
      }
      rawMatrix.splice(1, 1);
    }
  }

  // Safeguard after column projection: an N × 2 block whose Column 0 is strictly bullets or
  // sequential list numbers (e.g. 1..4 / 1..N with or without punctuation) is ALWAYS a list, never a table.
  if (columnCount === 2 && rawMatrix.every((row) => isListMarkerChunkText(row[0].text))) {
    const seqNums = rawMatrix.map((row) => extractSequentialMarkerNumber(row[0].text));
    const allSeq =
      seqNums.every((n) => n !== null) &&
      seqNums.every((n, idx) => idx === 0 || n === seqNums[idx - 1]! + 1);
    const allBul = rawMatrix.every((row) => extractSequentialMarkerNumber(row[0].text) === null);
    if (allSeq || allBul) {
      return { table: null, consumedLineCount: 0 };
    }
  }

  // 4. Determine whether this is a 2-column Key-Value metadata table or a headered data table
  const col0ShortAll = rawMatrix.every((row) => row[0].text.length > 0 && row[0].text.length <= 32);
  const col0MostlyBold =
    rawMatrix.filter((row) => row[0].isBold).length >= Math.ceil(rawMatrix.length * 0.5);
  const row0AllHeaders =
    rawMatrix[0].every((c) => c.isBold) && rawMatrix.slice(1).some((r) => !r[0].isBold);
  const col1HasLongDescriptions = rawMatrix.some((r) => r[1]?.text.length >= 16);

  const isKeyValueTable =
    columnCount === 2 &&
    col0ShortAll &&
    !row0AllHeaders &&
    (col0MostlyBold || (col1HasLongDescriptions && !rawMatrix[0][1].isBold));

  const hasHeaderRow = !isKeyValueTable;

  // 5. Calculate proportional column widths in twips summing strictly to pagePrintableWidthTwips
  const colWeights: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    const maxChars = Math.max(...rawMatrix.map((row) => row[c].text.length), 6);
    const maxPdfW = Math.max(...rawMatrix.map((row) => row[c].pdfWidth), 30);
    if (isKeyValueTable) {
      colWeights.push(c === 0 ? Math.max(14, Math.min(26, maxChars + 4)) : Math.max(48, Math.min(76, maxChars)));
    } else {
      colWeights.push(Math.max(12, Math.round(maxChars * 0.65 + maxPdfW * 0.25)));
    }
  }

  const totalWeight = colWeights.reduce((a, b) => a + b, 0) || 1;
  const minColTwips = isKeyValueTable
    ? Math.floor(pagePrintableWidthTwips * 0.22)
    : Math.floor(pagePrintableWidthTwips * 0.14);

  const rawWidths = colWeights.map((w) =>
    Math.max(minColTwips, Math.round((w / totalWeight) * pagePrintableWidthTwips))
  );
  const sumRaw = rawWidths.reduce((a, b) => a + b, 0);
  const columnWidthsTwips = rawWidths.map((w) =>
    Math.floor((w / sumRaw) * pagePrintableWidthTwips)
  );
  const remainder =
    pagePrintableWidthTwips - columnWidthsTwips.reduce((a, b) => a + b, 0);
  columnWidthsTwips[columnWidthsTwips.length - 1] += remainder;

  // 6. Build StructuredTable Cells
  const structuredRows: StructuredTableCell[][] = rawMatrix.map((row, rIdx) => {
    const isHeaderRow = hasHeaderRow && rIdx === 0;

    return row.map((bucket, cIdx) => {
      const cellText = bucket.text;
      const isNumeric = /^-?[\$₹€£]?\s*[\d,]+(\.\d+)?%?$/.test(cellText);
      const alignment: 'left' | 'center' | 'right' =
        isNumeric && !isHeaderRow ? 'right' : 'left';

      const forceCellBold = isHeaderRow || (isKeyValueTable && cIdx === 0 && col0MostlyBold);
      const cellSpans: TextSpan[] =
        bucket.spans.length > 0
          ? bucket.spans.map((sp) => ({
              ...sp,
              fontSize: isHeaderRow ? Math.max(sp.fontSize, 10) : Math.min(sp.fontSize, 10),
              isBold: forceCellBold ? true : sp.isBold,
            }))
          : [
              {
                text: cellText,
                fontSize: isHeaderRow ? 10 : 9.5,
                fontFamily: defaultFontFamily,
                isBold: forceCellBold,
                isItalic: false,
                isMonospace: false,
                color: '111827',
              },
            ];

      let backgroundColor = 'FFFFFF';
      if (isKeyValueTable) {
        backgroundColor = cIdx === 0 ? 'F8FAFC' : 'FFFFFF';
      } else if (isHeaderRow) {
        backgroundColor = 'F1F5F9';
      } else if (rIdx % 2 === 1) {
        backgroundColor = 'FAFAFA';
      }

      return {
        text: cellText,
        spans: cellSpans,
        widthTwips: columnWidthsTwips[cIdx],
        isHeader: isHeaderRow,
        alignment,
        backgroundColor,
      };
    });
  });

  return {
    table: {
      type: 'table',
      rows: structuredRows,
      totalWidthTwips: pagePrintableWidthTwips,
      columnCount,
      columnWidthsTwips,
      hasHeaderRow,
      yTopPt: bandMaxY,
      yBottomPt: bandMinY,
    },
    consumedLineCount,
  };
}
