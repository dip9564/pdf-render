import {
  ExtractedPageData,
  StructuredBlock,
  StructuredLine,
  StructuredParagraph,
  StructuredImage,
  StructuredCodeBlock,
  StructuredTwoColumnBlock,
  StructuredCalloutBlock,
  TextSpan,
  PositionedItem,
  ConversionOptions,
} from './types';
import { buildSpansAndTextFromItems, computeModalLineBaseline } from './fontDetector';
import { extractImagesFromPage, cropPageRegionToPng } from './imageExtractor';
import { detectTableInLines, mergeLineItemsIntoChunks } from './tableDetector';
import { isLineCodeStart, collectCodeBlockLines, buildUnifiedCodeBlock } from './codeDetector';
import { extractVectorLayoutHints, VectorTableHints, HSegment } from './vectorExtractor';

interface RawItem extends PositionedItem {}

function stripInvisibleChars(str: string): string {
  return str.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
}

function getItemHeight(it: RawItem): number {
  return (
    Math.max(
      it.height || 0,
      Math.hypot(it.transform?.[0] || 0, it.transform?.[1] || 0),
      Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0)
    ) || 10
  );
}

/**
 * Checks whether a line represents an isolated mathematical or scientific formula line
 * (never shattering ordinary multi-line prose paragraphs or list items containing ₹ or ≤/≥/α).
 */
function isMathProseLine(line: StructuredLine): boolean {
  const raw = stripInvisibleChars(line.rawText).trim();
  if (!raw) return false;
  const hasExplicitFormula =
    /(?:E\s*=\s*mc\s*[²2]?|x\s*[₁1]\s*\+\s*x\s*[₂2]\s*=|π\s*r\s*[²2]|Area\s*=\s*π\s*r\s*[²2]?)/i.test(
      raw
    );
  if (hasExplicitFormula) return true;

  const isExplicitMathHeading =
    /^(?:Formula|Equation|Circle\s+formula|Linear\s+equation|Energy(?:-mass)?)\s*:/i.test(raw);
  if (isExplicitMathHeading) return true;

  const proseWords = (raw.match(/\b[A-Za-z]{2,}\b/g) || []).filter(
    (w) => !/^(?:sin|cos|tan|log|ln|exp|max|min|lim|mod|dx|dy)$/i.test(w)
  );
  if (proseWords.length >= 4 && !/^[A-Za-z &]+\s*:/.test(raw)) {
    return false;
  }

  const hasGreekAndMathOps = /[αβγΩ]/.test(raw) && /[≤≥×÷=≈≠±]/.test(raw);
  const looksLikeWrappedSentenceContinuation = /^[a-z]/.test(raw) || raw.length > 78;
  return hasGreekAndMathOps && !looksLikeWrappedSentenceContinuation && !raw.includes('|');
}

/**
 * Splits or flags PositionedItems overlapped by detected vector underline strokes,
 * supporting both whole-item underlines and partial-phrase underlines inside a single PDF string
 * without marking boundary whitespace as underlined.
 */
function applyUnderlineSegmentsToItems(
  items: RawItem[],
  underlineSegments: HSegment[] | undefined
): RawItem[] {
  if (!underlineSegments || underlineSegments.length === 0) return items;

  const charRelWeight = (ch: string): number => {
    if (ch === ' ') return 0.62;
    if (/[ilI1.,:;!'|]/.test(ch)) return 0.5;
    if (/[WMmw@%&]/.test(ch)) return 1.35;
    return 1.0;
  };

  const out: RawItem[] = [];
  for (const it of items) {
    const str = it.str || '';
    if (!str.trim()) {
      out.push(it);
      continue;
    }

    const itH = getItemHeight(it);
    const itW = it.width > 0 ? it.width : Math.max(3, str.length * itH * 0.48);
    const itMaxX = it.x + itW;

    const matching = underlineSegments
      .filter(
        (u) =>
          u.y <= it.y - 0.15 &&
          u.y >= it.y - Math.max(4.5, itH * 0.40) &&
          u.x2 >= it.x + 1.5 &&
          u.x1 <= itMaxX - 1.5
      )
      .sort((a, b) => a.x1 - b.x1);

    if (matching.length === 0) {
      out.push(it);
      continue;
    }

    // Compute total covered X interval on this item
    const intervals = matching.map(
      (u) => [Math.max(it.x, u.x1), Math.min(itMaxX, u.x2)] as [number, number]
    );
    let covW = 0;
    let ca = intervals[0][0];
    let cb = intervals[0][1];
    for (let k = 1; k < intervals.length; k++) {
      if (intervals[k][0] <= cb + 2) cb = Math.max(cb, intervals[k][1]);
      else {
        covW += cb - ca;
        ca = intervals[k][0];
        cb = intervals[k][1];
      }
    }
    covW += cb - ca;

    // Whole-item underline (trim outer pure spaces cleanly from underline styling if needed)
    if (covW >= itW * 0.88 && !/^\s+|\s+$/.test(str)) {
      out.push({ ...it, isUnderlineFlag: true });
      continue;
    }

    // Word-level proportional slicing for partial-phrase underlines inside one PDF item
    const tokens = str.match(/\S+|\s+/g);
    if (!tokens || tokens.length === 0) {
      out.push(it);
      continue;
    }

    const chars = Array.from(str);
    const totalWeight = chars.reduce((acc, ch) => acc + charRelWeight(ch), 0) || 1;
    let curX = it.x;

    interface SlicedTok {
      text: string;
      x: number;
      w: number;
      isSpace: boolean;
      underlined: boolean;
    }
    const sliced: SlicedTok[] = [];
    for (const tok of tokens) {
      const tokW =
        (Array.from(tok).reduce((acc, ch) => acc + charRelWeight(ch), 0) / totalWeight) * itW;
      const tokEndX = curX + tokW;
      const isSpace = /^\s+$/.test(tok);
      let underlined = false;
      if (!isSpace) {
        for (const u of matching) {
          const overlap = Math.min(tokEndX, u.x2) - Math.max(curX, u.x1);
          if (overlap >= Math.max(2.0, tokW * 0.52)) {
            underlined = true;
            break;
          }
        }
      }
      sliced.push({ text: tok, x: curX, w: tokW, isSpace, underlined });
      curX = tokEndX;
    }

    // Underline internal spaces ONLY when BOTH neighboring words belong to the same underlined phrase
    for (let k = 0; k < sliced.length; k++) {
      if (
        sliced[k].isSpace &&
        k > 0 &&
        k < sliced.length - 1 &&
        sliced[k - 1].underlined &&
        sliced[k + 1].underlined
      ) {
        const sMid = sliced[k].x + sliced[k].w / 2;
        if (matching.some((u) => sMid >= u.x1 - 1 && sMid <= u.x2 + 1)) {
          sliced[k].underlined = true;
        }
      }
    }

    // Group contiguous same-underline tokens back into PositionedItems preserving exact X/width
    let runText = '';
    let runX = sliced[0].x;
    let runW = 0;
    let runU = sliced[0].underlined;
    const flushTok = () => {
      if (!runText) return;
      out.push({
        ...it,
        str: runText,
        x: runX,
        width: runW,
        isUnderlineFlag: runU,
      });
    };
    for (let k = 0; k < sliced.length; k++) {
      const t = sliced[k];
      if (t.underlined === runU) {
        runText += t.text;
        runW += t.w;
      } else {
        flushTok();
        runText = t.text;
        runX = t.x;
        runW = t.w;
        runU = t.underlined;
      }
    }
    flushTok();
  }

  return out;
}

/**
 * Merges adjacent TextSpans that have identical typography and confidence review status
 */
function mergeAdjacentSpans(spans: TextSpan[]): TextSpan[] {
  const merged: TextSpan[] = [];
  for (const sp of spans) {
    if (!sp || !sp.text) continue;
    const prev = merged[merged.length - 1];
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
      merged.push({ ...sp });
    }
  }
  return merged;
}

/**
 * Strips a leading character prefix cleanly from the first non-empty TextSpan(s)
 */
function stripPrefixFromSpans(spans: TextSpan[], prefixRegex: RegExp): TextSpan[] {
  if (!spans || spans.length === 0) return [];
  const full = spans.map((s) => s.text).join('');
  const match = full.match(prefixRegex);
  if (!match) return spans;

  let toRemove = match[0].length;
  const result: TextSpan[] = [];

  for (const s of spans) {
    if (toRemove <= 0) {
      result.push({ ...s });
      continue;
    }
    if (s.text.length <= toRemove) {
      toRemove -= s.text.length;
    } else {
      result.push({ ...s, text: s.text.slice(toRemove) });
      toRemove = 0;
    }
  }
  return result.length > 0 ? result : [{ ...spans[0], text: full.slice(match[0].length) }];
}

/**
 * Groups raw positioned items (PDF.js or structured OCR words) into StructuredLines
 * using fractional Y baseline clustering.
 */
export function groupItemsIntoLines(
  rawItems: RawItem[],
  defaultFontFamily: string
): StructuredLine[] {
  if (rawItems.length === 0) return [];

  const sortedTopDown = [...rawItems].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 1.5) return b.y - a.y;
    return a.x - b.x;
  });

  interface LineCluster {
    baselineY: number;
    maxHeight: number;
    items: RawItem[];
  }

  const clusters: LineCluster[] = [];

  for (const it of sortedTopDown) {
    const itH = getItemHeight(it);

    let matched: LineCluster | null = null;
    let bestTolDist = Infinity;
    for (const cl of clusters) {
      const tol = Math.max(3.6, Math.min(6.0, Math.max(cl.maxHeight, itH) * 0.44));
      const d = Math.abs(cl.baselineY - it.y);
      if (d <= tol && d < bestTolDist) {
        bestTolDist = d;
        matched = cl;
      }
    }

    if (matched) {
      matched.items.push(it);
      if (itH > matched.maxHeight * 1.05) {
        matched.maxHeight = itH;
      }
      const fullHeightItems = matched.items.filter(
        (m) => getItemHeight(m) >= matched.maxHeight * 0.85
      );
      if (fullHeightItems.length > 0) {
        matched.baselineY =
          fullHeightItems.reduce((acc, m) => acc + m.y, 0) / fullHeightItems.length;
      }
    } else {
      clusters.push({
        baselineY: it.y,
        maxHeight: itH,
        items: [it],
      });
    }
  }

  clusters.sort((a, b) => b.baselineY - a.baselineY);

  // Rescue tiny orphaned raised superscript or lowered subscript clusters
  for (let c = clusters.length - 1; c >= 0; c--) {
    const orphan = clusters[c];
    const orphanText = orphan.items.map((it) => it.str).join('').replace(/\s+/g, '');
    const allTinyTokens =
      orphan.items.length > 0 &&
      orphan.items.length <= 8 &&
      orphan.items.every((it) => {
        const t = it.str.trim();
        return t.length > 0 && t.length <= 6;
      });
    if (orphanText.length === 0 || !allTinyTokens || orphanText.length > 18) continue;

    const neighbors = [c - 1, c + 1].filter((n) => n >= 0 && n < clusters.length);
    let targetIdx = -1;
    let bestScore = Infinity;
    const isScriptAlnumToken = /^[0-9+\-=()a-zA-Z]{1,6}$/.test(orphanText);

    for (const n of neighbors) {
      const nb = clusters[n];

      const isAboveOwner = orphan.baselineY > nb.baselineY;
      const dy = Math.abs(nb.baselineY - orphan.baselineY);
      const maxHeightAllowed = isScriptAlnumToken ? nb.maxHeight * 1.06 : nb.maxHeight * 0.95;
      if (orphan.maxHeight > maxHeightAllowed) continue;

      let minHorizGap = Infinity;
      let hasRightEdgeAdjacency = false;
      let hasInteriorCollision = false;

      for (const oi of orphan.items) {
        const oiW = oi.width > 0 ? oi.width : Math.max(2, oi.str.length * 4);
        const oiMaxX = oi.x + oiW;
        for (const ni of nb.items) {
          if (!ni.str || !ni.str.trim()) continue;
          const niW = ni.width > 0 ? ni.width : Math.max(4, ni.str.length * 5);
          const niMaxX = ni.x + niW;
          const rightAttachGap = oi.x - niMaxX;
          const leftAttachGap = ni.x - oiMaxX;

          if (rightAttachGap >= -3 && rightAttachGap <= 7.5) {
            hasRightEdgeAdjacency = true;
            minHorizGap = Math.min(minHorizGap, Math.max(0, rightAttachGap));
          } else if (leftAttachGap >= -3 && leftAttachGap <= 7.5) {
            hasRightEdgeAdjacency = true;
            minHorizGap = Math.min(minHorizGap, Math.max(0, leftAttachGap));
          } else {
            const xOverlap = Math.min(oiMaxX, niMaxX) - Math.max(oi.x, ni.x);
            if (xOverlap > 2.2) {
              hasInteriorCollision = true;
              minHorizGap = Math.min(minHorizGap, 0);
            } else {
              const gap =
                oi.x >= niMaxX - 3
                  ? oi.x - niMaxX
                  : ni.x >= oiMaxX - 3
                  ? ni.x - oiMaxX
                  : 0;
              if (gap < minHorizGap) minHorizGap = gap;
            }
          }
        }
      }

      if (orphan.maxHeight > nb.maxHeight * 0.95 && (!hasRightEdgeAdjacency || hasInteriorCollision)) {
        continue;
      }

      const maxAllowedDy = isAboveOwner
        ? hasRightEdgeAdjacency && !hasInteriorCollision
          ? Math.max(9.2, nb.maxHeight * 0.84)
          : Math.max(7.8, nb.maxHeight * 0.74)
        : hasRightEdgeAdjacency && !hasInteriorCollision
        ? Math.max(6.0, nb.maxHeight * 0.56)
        : Math.max(5.0, nb.maxHeight * 0.48);
      if (dy > maxAllowedDy) continue;

      if (minHorizGap <= 16) {
        const adjMultiplier = hasRightEdgeAdjacency && !hasInteriorCollision ? 0.28 : minHorizGap <= 5 ? 0.55 : 1.0;
        const collisionPenalty = hasInteriorCollision && !hasRightEdgeAdjacency ? 18 : 0;
        const score = dy * adjMultiplier + minHorizGap * 0.35 + collisionPenalty;
        if (score < bestScore) {
          bestScore = score;
          targetIdx = n;
        }
      }
    }

    if (targetIdx !== -1) {
      clusters[targetIdx].items.push(...orphan.items);
      clusters.splice(c, 1);
    }
  }

  const structuredLines: StructuredLine[] = [];
  let prevOcrParaId: number | undefined = undefined;

  for (const cl of clusters) {
    const items = cl.items.sort((a, b) => a.x - b.x);
    const modal = computeModalLineBaseline(items);
    const baselineY = modal.baselineY || cl.baselineY;
    const baselineFontSize = modal.baselineFontSize || cl.maxHeight || 11;

    const { spans, rawText } = buildSpansAndTextFromItems(
      items,
      baselineY,
      baselineFontSize,
      defaultFontFamily
    );

    if (!rawText.trim()) continue;

    const visibleItems = items.filter((it) => it.str.trim().length > 0);
    const spanItems = visibleItems.length > 0 ? visibleItems : items;
    const lineMinX = Math.min(...spanItems.map((it) => it.x));
    const lineMaxX = Math.max(
      ...spanItems.map((it) => it.x + (it.width > 0 ? it.width : it.str.length * 5.2))
    );

    const lineOcrParaId = items.find((it) => it.ocrParagraphId !== undefined)?.ocrParagraphId;
    const ocrParagraphBreakBefore =
      prevOcrParaId !== undefined &&
      lineOcrParaId !== undefined &&
      lineOcrParaId !== prevOcrParaId;
    if (lineOcrParaId !== undefined) {
      prevOcrParaId = lineOcrParaId;
    }

    structuredLines.push({
      y: baselineY,
      minX: lineMinX,
      maxX: lineMaxX,
      height: baselineFontSize,
      spans,
      rawText,
      items,
      ...(ocrParagraphBreakBefore ? { ocrParagraphBreakBefore: true } : {}),
    });
  }

  return structuredLines;
}

/**
 * Checks if a line is predominantly bold (>= 70% of non-whitespace characters are bold)
 */
function isLineMostlyBold(line: StructuredLine): boolean {
  let total = 0;
  let bold = 0;
  for (const s of line.spans) {
    const len = s.text.replace(/\s+/g, '').length;
    total += len;
    if (s.isBold) bold += len;
  }
  return total > 0 && bold / total >= 0.7;
}

interface ParsedListLine {
  kind: 'bullet' | 'numbered' | 'step';
  itemNumber?: number;
  requiresSequenceProof?: boolean;
  prefixRegex: RegExp;
  remainder: string;
  markerMinX: number;
  contentMinX: number;
  hasHangingMarker: boolean;
}

function parseListLine(
  line: StructuredLine,
  chunks: ReturnType<typeof mergeLineItemsIntoChunks>
): ParsedListLine | null {
  const rawTrimmed = stripInvisibleChars(line.rawText).trimStart();
  if (!rawTrimmed) return null;

  const markerMinX = chunks[0]?.minX ?? line.minX;
  const chunk0Clean = stripInvisibleChars(chunks[0]?.str || '').trim();
  const hasSeparateMarkerChunk =
    chunks.length >= 2 &&
    /^(?:[\(\[]?\d{1,2}[\)\]\.:]?|Step\s+\d{1,2}[\.\):\-]?|[•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅➜➤➢▸▹])$/i.test(
      chunk0Clean
    );
  const contentMinX = hasSeparateMarkerChunk && chunks.length >= 2 ? chunks[1].minX : markerMinX + 12;

  // Reject genuine multi-column table rows (4+ separated columns, or 3 columns with wide interior gap)
  let maxSecondaryGap = 0;
  for (let k = 2; k < chunks.length; k++) {
    const gap = chunks[k].minX - chunks[k - 1].maxX;
    if (gap > maxSecondaryGap) maxSecondaryGap = gap;
  }
  const hasTabularContentColumns =
    (chunks.length >= 4 && maxSecondaryGap >= (hasSeparateMarkerChunk ? 34 : 28)) ||
    (chunks.length === 3 && maxSecondaryGap >= (hasSeparateMarkerChunk ? 54 : 42));
  if (hasTabularContentColumns) return null;

  // 1. Bullet list (inline OR hanging-indent where Chunk 0 is purely bullet marker)
  const bulletMatch = rawTrimmed.match(
    /^([•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅➜➤➢▸▹])\s*(.*)$/
  );
  if (
    bulletMatch &&
    (chunks.length <= 1 ||
      (chunks.length >= 2 &&
        /^([•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅➜➤➢▸▹])$/.test(chunk0Clean)) ||
      chunks[0]?.str.trimStart().startsWith(bulletMatch[1]))
  ) {
    const firstChar = bulletMatch[1];
    const remainder = bulletMatch[2].trim();
    const isDashFollowedByNumber = (firstChar === '-' || firstChar === '–') && /^\d/.test(remainder);
    if (!isDashFollowedByNumber && remainder.length > 0) {
      return {
        kind: 'bullet',
        prefixRegex:
          /^\s*[\u200B-\u200D\uFEFF\u00AD]*([•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅➜➤➢▸▹])[\u200B-\u200D\uFEFF\u00AD]*\s*/,
        remainder,
        markerMinX,
        contentMinX,
        hasHangingMarker: hasSeparateMarkerChunk,
      };
    }
  }

  // 2. Step-prefixed Ordered Procedure list ("Step 1: ...", "Procedure 1: ...", "Phase 1. ...", "Stage 1 — ...")
  const stepMatch = rawTrimmed.match(
    /^(?:Step|Procedure|Phase|Stage|Item)\s+(\d{1,2})\s*([\.\):\-–—])\s+(.+)$/i
  );
  if (stepMatch) {
    return {
      kind: 'step',
      itemNumber: parseInt(stepMatch[1], 10),
      requiresSequenceProof: true,
      prefixRegex:
        /^\s*[\u200B-\u200D\uFEFF\u00AD]*(?:Step|Procedure|Phase|Stage|Item)\s+\d{1,2}\s*[\.\):\-–—]\s*/i,
      remainder: stepMatch[3].trim(),
      markerMinX,
      contentMinX,
      hasHangingMarker: hasSeparateMarkerChunk,
    };
  }

  // 2b. Circled-digit ordered list (① .. ⑩)
  const circledMatch = rawTrimmed.match(/^([\u2460-\u2469])\s*(.+)$/);
  if (circledMatch) {
    const cNum = (circledMatch[1].codePointAt(0) ?? 0x2460) - 0x2460 + 1;
    return {
      kind: 'numbered',
      itemNumber: cNum,
      prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*[\u2460-\u2469]\s*/,
      remainder: circledMatch[2].trim(),
      markerMinX,
      contentMinX,
      hasHangingMarker: hasSeparateMarkerChunk,
    };
  }

  // 3. Punctuated numbered list (1. Text, 1.Text, 1) Text, (1) Text, [1] Text, 1: Text, 1 - Text)
  // Allow both single-chunk AND multi-chunk justified/spaced lines starting with a numbered marker
  const startsWithParenNum = /^[\(\[]\d{1,2}[\)\]]\s+/.test(rawTrimmed);
  const startsWithPunctNum = /^\d{1,2}[\.\):](?:\s+|(?=[A-Z₹€£α-ωΑ-Ω(\["']))/.test(rawTrimmed);
  const startsWithDashNum = /^\d{1,2}\s*[-\u2013\u2014]\s+[A-Z]/.test(rawTrimmed);
  if (startsWithParenNum || startsWithPunctNum || startsWithDashNum) {
    const parenMatch = rawTrimmed.match(/^[\(\[](\d{1,2})[\)\]]\s+(.+)$/);
    if (parenMatch) {
      return {
        kind: 'numbered',
        itemNumber: parseInt(parenMatch[1], 10),
        prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*[\(\[]\d{1,2}[\)\]][\u200B-\u200D\uFEFF\u00AD]*\s+/,
        remainder: parenMatch[2].trim(),
        markerMinX,
        contentMinX,
        hasHangingMarker: hasSeparateMarkerChunk,
      };
    }

    const dashMatch = rawTrimmed.match(/^(\d{1,2})\s*[-\u2013\u2014]\s+([A-Z].+)$/);
    if (dashMatch) {
      return {
        kind: 'numbered',
        itemNumber: parseInt(dashMatch[1], 10),
        requiresSequenceProof: true,
        prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*\d{1,2}\s*[-\u2013\u2014]\s+/,
        remainder: dashMatch[2].trim(),
        markerMinX,
        contentMinX,
        hasHangingMarker: hasSeparateMarkerChunk,
      };
    }

    const punctMatch = rawTrimmed.match(/^(\d{1,2})([\.\):])\s*(.+)$/);
    if (punctMatch && !/^\d/.test(punctMatch[3])) {
      return {
        kind: 'numbered',
        itemNumber: parseInt(punctMatch[1], 10),
        requiresSequenceProof: punctMatch[2] === ':',
        prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*\d{1,2}[\.\):][\u200B-\u200D\uFEFF\u00AD]*\s*/,
        remainder: punctMatch[3].trim(),
        markerMinX,
        contentMinX,
        hasHangingMarker: hasSeparateMarkerChunk,
      };
    }
  }

  // 4. Bare digit hanging-indent numbered list (Chunk 0 = "1", Chunk 1 = "Objective description...")
  if (chunks.length >= 2 && chunks.length <= 3 && /^\d{1,2}$/.test(chunk0Clean)) {
    const remainder = chunks
      .slice(1)
      .map((c) => stripInvisibleChars(c.str).trim())
      .join(' ')
      .trim();
    const markerWidth = chunks[0].maxX - chunks[0].minX;
    if (markerWidth <= 28 && remainder.length >= 6) {
      return {
        kind: 'numbered',
        itemNumber: parseInt(chunk0Clean, 10),
        requiresSequenceProof: true,
        prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*\d{1,2}[\u200B-\u200D\uFEFF\u00AD]*\s+/,
        remainder,
        markerMinX,
        contentMinX,
        hasHangingMarker: true,
      };
    }
  }

  // 4b. Single-chunk bare digit sequence (e.g. "1 Load the document and...", strictly guarded by sequence lookahead)
  const bareInlineMatch = rawTrimmed.match(/^(\d{1,2})\s+([A-Z][a-zA-Z₹€£α-ωΑ-Ω].{5,})$/);
  if (bareInlineMatch && chunks.length === 1) {
    const itemNum = parseInt(bareInlineMatch[1], 10);
    if (
      itemNum >= 1 &&
      itemNum <= 25 &&
      !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(bareInlineMatch[2])
    ) {
      return {
        kind: 'numbered',
        itemNumber: itemNum,
        requiresSequenceProof: true,
        prefixRegex: /^\s*[\u200B-\u200D\uFEFF\u00AD]*\d{1,2}\s+/,
        remainder: bareInlineMatch[2].trim(),
        markerMinX,
        contentMinX: markerMinX + 12,
        hasHangingMarker: false,
      };
    }
  }

  return null;
}

/**
 * Layout and Content Classification Engine:
 * Classifies every content region into Title, Heading 1, Heading 2, Normal paragraph,
 * Actual data/metadata table, Bulleted list, Numbered/Step list, Code block, or Math content
 * BEFORE generating Word elements.
 */
export function parseBlocksFromLines(
  lines: StructuredLine[],
  options: ConversionOptions,
  printableWidthTwips: number,
  medianFontSize: number,
  context: {
    pageNumber: number;
    pageWidthPt: number;
    bodyLeftMarginPt?: number;
    inTwoColumn?: boolean;
    inCallout?: boolean;
    titleAssignedRef: { assigned: boolean };
    numberedListInstanceRef: { current: number };
    vectorTableHints?: VectorTableHints;
  }
): { blocks: StructuredBlock[]; hasTables: boolean; hasCode: boolean } {
  const blocks: StructuredBlock[] = [];
  let hasTables = false;
  let hasCode = false;
  let prevListKind: 'numbered' | 'step' | null = null;
  let prevNumberedValue = 0;
  let observedListWrapGap = 0;
  let i = 0;

  // Estimate tight intra-paragraph body leading and text region bounds across lines in this slice
  const bodyWrapSteps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const dy = Math.abs(lines[k - 1].y - lines[k].y);
    const refH = Math.max(8, lines[k - 1].height || medianFontSize || 11);
    if (dy >= refH * 0.98 && dy <= refH * 1.56) {
      bodyWrapSteps.push(dy);
    }
  }
  bodyWrapSteps.sort((a, b) => a - b);
  const tightBodyLeading =
    bodyWrapSteps.length >= 2 ? bodyWrapSteps[Math.floor(bodyWrapSteps.length * 0.4)] : 0;

  const regionLeftEdgePt =
    lines.length > 0 ? Math.min(...lines.map((l) => l.minX)) : context.bodyLeftMarginPt ?? 54;
  const regionRightEdgePt =
    lines.length > 0 ? Math.max(...lines.map((l) => l.maxX)) : context.pageWidthPt - 54;
  const bodyLeftAnchorPt = context.bodyLeftMarginPt ?? regionLeftEdgePt;

  const getLineVerticalDividers = (lineY: number, minX: number, maxX: number): number[] | undefined => {
    if (!context.vectorTableHints) return undefined;
    const divs: number[] = [];
    for (const v of context.vectorTableHints.vSegments) {
      if (
        v.y2 - v.y1 >= 24 &&
        v.y1 <= lineY + 8 &&
        v.y2 >= lineY - 8 &&
        v.x > minX + 5 &&
        v.x < maxX - 5
      ) {
        divs.push(v.x);
      }
    }
    for (const h of context.vectorTableHints.columnSplitHints || []) {
      if (h.minY <= lineY + 8 && h.maxY >= lineY - 8) {
        for (const x of h.xs) {
          if (x > minX + 5 && x < maxX - 5) divs.push(x);
        }
      }
    }
    return divs.length > 0 ? divs : undefined;
  };

  const isLineAllItalic = (l: StructuredLine): boolean => {
    let tot = 0;
    let it = 0;
    for (const s of l.spans) {
      const n = s.text.replace(/\s+/g, '').length;
      tot += n;
      if (s.isItalic) it += n;
    }
    return tot > 0 && it / tot >= 0.9;
  };

  const isKeyValueMetadataLine = (l: StructuredLine): boolean => {
    const raw = stripInvisibleChars(l.rawText).trim();
    if (!raw || raw.length > 105) return false;
    // Match short "Key: Value" metadata/field lines while excluding structural section headings
    // and narrative prose labels (Abstract:, Summary:, Note:, Results:, etc.).
    const kvMatch = raw.match(/^([A-Za-z][A-Za-z0-9\s\/\-\(\)\.&]{1,32}):\s+(\S.*)$/);
    if (!kvMatch) return false;
    const key = kvMatch[1].trim();
    if (
      /^(?:Section|Part|Chapter|Appendix|Phase|Column|Step|Procedure|Stage|Table|Figure|Fig|Chart|Diagram|Abstract|Summary|Conclusion|Interpretation|Note|Notes|Warning|Important|Results|Methods?|Methodology|Discussion|Formula|Equation)\b/i.test(
        key
      )
    ) {
      return false;
    }
    return true;
  };

  const isBareMetadataLabel = (raw: string): boolean =>
    /^(?:Date|Time|Venue|Location|Meeting\s+ID|(?:Document|Doc|Report|Reference|Ref|Session)\s+(?:ID|No\.?|Number)|Department|Dept\.?|Authors?|Affiliation|Prepared\s+by|Reviewed\s+by|Approved\s+by|Status|Version)\s*:?$/i.test(
      raw.trim()
    );

  const isExplicitColonFrontMatter = (l: StructuredLine): boolean => {
    const raw = stripInvisibleChars(l.rawText).trim();
    if (!raw) return false;
    return /^(?:Authors?|Co-authors?|Corresponding\s+authors?|Affiliation|Institution|Organization|Organisation|Keywords?|Index\s+Terms?|Email|E-mail|Correspondence|Date|Time|Venue|Location|Meeting\s+ID|(?:Document|Doc|Report|Reference|Ref|Session|Project|Case|Ticket)\s+(?:ID|No\.?|Number|Code)|Department|Dept\.?|Team|Division|Prepared\s+by|Reviewed\s+by|Approved\s+by|Organizer|Chair(?:person)?|Attendees|Participants|Subject|Status|Version)\s*:/i.test(
      raw
    );
  };

  const isFrontMatterMetadataLine = (l: StructuredLine): boolean => {
    const raw = stripInvisibleChars(l.rawText).trim();
    if (!raw) return false;
    if (isExplicitColonFrontMatter(l)) return true;
    if (isKeyValueMetadataLine(l) && raw.length <= 72) return true;
    if (
      /^(?:Authors?|Co-authors?|Corresponding\s+authors?|Department\s+of|Dept\.?\s+of|Faculty\s+of|School\s+of|Division\s+of|Institute\s+of|Center\s+for|Centre\s+for|Affiliation)\b(?:\s*:|\s+[A-Za-z])/i.test(
        raw
      ) &&
      raw.length <= 105
    ) {
      return true;
    }
    if (
      /^(?:Date\s+(?:[-\u2013\u2014]\s+)?(?:\d{1,4}[\/\-]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))|(?:Meeting|Document|Doc|Report|Reference|Session)\s+ID\s+(?:[-\u2013\u2014]\s+)?[A-Z0-9\-_\/#]+|(?:Department|Dept\.?)\s*[-\u2013\u2014]?\s+[A-Z][A-Za-z0-9\s&\/,-]{1,65}$)/i.test(
        raw
      )
    ) {
      return true;
    }
    if (
      /\b(?:University|Institute|Department|Laboratory|College|Faculty|School|Center|Centre)\b/i.test(
        raw
      ) &&
      raw.length <= 95 &&
      (computeLineAlignment(l) === 'center' ||
        /^(?:[A-Z][A-Za-z&,\.\s-]+,\s*[A-Z]|[A-Z][A-Za-z\s&]+\b(?:Department|University|Institute|College|School|Laboratory)$)/i.test(
          raw
        ))
    ) {
      return true;
    }
    if (/\S+@\S+\.\S+/.test(raw) && raw.length < 100) return true;
    return false;
  };

  const computeLineAlignment = (l: StructuredLine): 'left' | 'center' => {
    const raw = l.rawText.trim();
    if (!context.inTwoColumn && !context.inCallout && raw.length < 95) {
      const pageMidPt = context.pageWidthPt / 2;
      const lineMidPt = (l.minX + l.maxX) / 2;
      if (Math.abs(lineMidPt - pageMidPt) < 32 && l.minX > 90) {
        return 'center';
      }
    }
    return 'left';
  };

  const isHeadlineCandidate = (
    l: StructuredLine,
    chunksLen: number,
    inTwoCol: boolean
  ): { isTitle: boolean; headingLevel?: 1 | 2 } => {
    const raw = stripInvisibleChars(l.rawText).trim();
    if (!options.smartHeadingDetection || !raw || raw.length >= 96) {
      return { isTitle: false };
    }
    if (chunksLen >= 2 && !inTwoCol) {
      return { isTitle: false };
    }
    if (
      /^([•●▪▫◦‣⁃\*\-–—]|\[[ xX]?\]|[✓✔☑✅]|(?:Step|Procedure|Phase|Stage|Item)\s+\d+[\.\):\-–—])/i.test(
        raw
      )
    ) {
      return { isTitle: false };
    }
    if (isBareMetadataLabel(raw) || isKeyValueMetadataLine(l) || isFrontMatterMetadataLine(l)) {
      return { isTitle: false };
    }
    if (
      /^(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}|\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})$/i.test(
        raw
      )
    ) {
      return { isTitle: false };
    }
    if (isMathProseLine(l)) {
      return { isTitle: false };
    }

    const lineModalFontSize = l.height || Math.max(...l.spans.map((s) => s.fontSize), 0);
    const mostlyBold = isLineMostlyBold(l);
    const mostlyItalic = isLineAllItalic(l);
    const endsSentence = /[\.!?]$/.test(raw);
    const wordCount = raw.split(/\s+/).filter(Boolean).length;

    // Document Title (Page 1, prominent top-level display heading, assigned once)
    // Always combines display font size with weight/centering/all-caps/position (never size alone).
    const isCentered =
      !inTwoCol &&
      !context.inCallout &&
      raw.length < 95 &&
      Math.abs((l.minX + l.maxX) / 2 - context.pageWidthPt / 2) < 64 &&
      l.minX > 72;
    const isAllCapsHeading =
      raw.length >= 4 &&
      /[A-Z]/.test(raw) &&
      raw === raw.toUpperCase() &&
      wordCount <= 8 &&
      !endsSentence;

    const isTopBannerSizedTitle =
      lineModalFontSize >= Math.max(15.2, medianFontSize * 1.34) &&
      (mostlyBold || isCentered || isAllCapsHeading || blocks.length === 0) &&
      !endsSentence;
    const isProminentCenteredTitle =
      blocks.length === 0 &&
      mostlyBold &&
      (isCentered || isAllCapsHeading) &&
      lineModalFontSize >= Math.max(13.2, medianFontSize * 1.2) &&
      !endsSentence;

    if (
      context.pageNumber === 1 &&
      !context.titleAssignedRef.assigned &&
      !inTwoCol &&
      !context.inCallout &&
      (isTopBannerSizedTitle || isProminentCenteredTitle) &&
      !/^(?:Section\s+\d+|\d+\.\s+|Executive\s+Summary\b|Quarterly\s+(?:Project\s+)?Performance\b|Abstract\b|Introduction\b|Background\b|Overview\b|Methodology\b|Conclusion\b|Action\s+Items\b|Ordered\s+Procedure\b|Table\s+\d+|Figure\s+\d+)/i.test(
        raw
      )
    ) {
      return { isTitle: true };
    }

    // Numbered heading pattern: requires BOTH larger display size AND bold weight (non-sentence)
    // so regular numbered list items (e.g. 12pt over 9.5pt code/table median) are never promoted by size alone.
    const numMatch = raw.match(/^(\d{1,2})([\.\)])\s+(.+)$/);
    if (numMatch) {
      const rest = numMatch[3].trim();
      const isLarger = lineModalFontSize >= medianFontSize * 1.18;
      if (mostlyBold && isLarger && rest.length <= 68 && !endsSentence) {
        return {
          isTitle: false,
          headingLevel: lineModalFontSize >= medianFontSize * 1.28 || lineModalFontSize >= 14 ? 1 : 2,
        };
      }
      return { isTitle: false };
    }

    // Inline "Key: Value" prose/metadata is never a heading (except Section/Part/Column/Sub-section labels)
    const hasInlineColonProse =
      raw.includes(':') &&
      !raw.endsWith(':') &&
      !/^(?:Section|Part|Chapter|Appendix|Phase|Column|\d+\.\d+)\b/i.test(raw);
    if (hasInlineColonProse) {
      return { isTitle: false };
    }

    // Explicit standalone academic section labels (e.g. "Abstract", "ABSTRACT", "Introduction", "Conclusion", "References")
    const isStandaloneAcademicSection =
      /^(?:Abstract|Summary|Introduction|Background|Methodology|Methods|Experimental\s+Setup|Experiments|Results|Discussion|Conclusion|References|Acknowledgments?)\s*:?$/i.test(
        raw
      );

    // Main Heading (Heading 1)
    const isMainSection =
      isStandaloneAcademicSection ||
      /^(?:[Ss]ection\s+\d+|Quarterly\s+Project\s+Performance|Quarterly\s+Performance|Executive\s+Summary|Appendix\s+[A-Z]\b|Action\s+Items|Ordered\s+Procedure|Procedure|Overview|Architecture)\b/i.test(
        raw
      );
    const isSubSectionPattern =
      /^(?:(?:Column|COLUMN)\s+[A-Z](?:\b|:)|Sub-?[Ss]ection\b|\d+\.\d+\s+[A-Z]|Formatting\s+Section\b)/.test(
        raw
      );

    const hasTitleCasing =
      wordCount >= 1 &&
      wordCount <= 8 &&
      raw
        .split(/\s+/)
        .filter((w) => !/^(?:of|in|on|at|by|for|to|from|with|and|or|the|a|an)$/i.test(w))
        .every((w) => /^[A-Z0-9\("]/.test(w));

    const hasDisplaySizeAndSignal =
      lineModalFontSize >= medianFontSize * 1.28 &&
      !endsSentence &&
      wordCount <= 9 &&
      (mostlyBold || isCentered || isAllCapsHeading || hasTitleCasing);

    if (
      !inTwoCol &&
      !context.inCallout &&
      !isSubSectionPattern &&
      !endsSentence &&
      !mostlyItalic &&
      (hasDisplaySizeAndSignal ||
        (isStandaloneAcademicSection &&
          (mostlyBold || isAllCapsHeading || isCentered || lineModalFontSize >= medianFontSize * 0.98)) ||
        (isMainSection && (mostlyBold || isAllCapsHeading || isCentered)))
    ) {
      return { isTitle: false, headingLevel: 1 };
    }

    // Subheading (Heading 2): NEVER promote based on font size alone!
    if (
      !endsSentence &&
      (isSubSectionPattern ||
        (mostlyBold &&
          raw.length < 65 &&
          wordCount <= 9 &&
          (lineModalFontSize >= medianFontSize * 0.98 || inTwoCol || context.inCallout || raw.endsWith(':'))) ||
        (lineModalFontSize >= medianFontSize * 1.15 &&
          (mostlyBold || isAllCapsHeading) &&
          raw.length < 60 &&
          wordCount <= 7))
    ) {
      return { isTitle: false, headingLevel: 2 };
    }

    return { isTitle: false };
  };

  while (i < lines.length) {
    const line = lines[i];
    const lineDivs = getLineVerticalDividers(line.y, line.minX, line.maxX);
    const chunks = mergeLineItemsIntoChunks(line, lineDivs);

    // 1. Code Block Classification (prioritized BEFORE table detection)
    if (options.detectCodeBlocks && isLineCodeStart(line)) {
      const codeLines = collectCodeBlockLines(lines, i);
      const isMonoLine = line.spans.some((s) => s.isMonospace);
      if (codeLines.length >= 2 || isMonoLine) {
        const unifiedCode = buildUnifiedCodeBlock(codeLines);
        unifiedCode.yTopPt = codeLines[0].y + (codeLines[0].height || 10);
        unifiedCode.yBottomPt = codeLines[codeLines.length - 1].y;
        blocks.push(unifiedCode);
        hasCode = true;
        prevListKind = null;
        prevNumberedValue = 0;
        observedListWrapGap = 0;
        i += codeLines.length;
        continue;
      }
    }

    // Helper: Look ahead past wrapped continuation lines (indented OR flush-left tight wraps)
    // to find the next sibling numbered/step list marker.
    const lookaheadNextNumber = (
      fromIdx: number,
      targetKind: 'numbered' | 'step',
      minMarkerIndentX: number
    ): number | null => {
      let prevLookY = lines[fromIdx].y;
      let prevLookH = lines[fromIdx].height || 11;
      const minAllowedX = Math.min(minMarkerIndentX, bodyLeftAnchorPt) - 8;
      for (let look = fromIdx + 1; look < Math.min(lines.length, fromIdx + 24); look++) {
        const l = lines[look];
        const gap = Math.abs(prevLookY - l.y);
        if (gap > Math.max(58, prevLookH * 4.4)) break;

        const lDivs = getLineVerticalDividers(l.y, l.minX, l.maxX);
        const lChunks = mergeLineItemsIntoChunks(l, lDivs);
        const lParsed = parseListLine(l, lChunks);
        if (lParsed?.kind === targetKind && lParsed.itemNumber !== undefined) {
          return lParsed.itemNumber;
        }
        if (lParsed) break;

        const lHead = isHeadlineCandidate(l, lChunks.length, Boolean(context.inTwoColumn));
        if (lHead.isTitle || lHead.headingLevel === 1) break;
        if (options.detectCodeBlocks && isLineCodeStart(l)) break;

        const singleOrTightGap =
          lChunks.length === 1 ||
          (lChunks.length === 2 && lChunks[1].minX - lChunks[0].maxX < 42);
        if (!singleOrTightGap || l.minX < minAllowedX) {
          break;
        }
        prevLookY = l.y;
        prevLookH = l.height || 11;
      }
      return null;
    };

    // 2. Bulleted, Numbered, or Step Ordered Procedure List Classification
    const parsedList = parseListLine(line, chunks);
    if (parsedList?.kind === 'bullet') {
      const cleanSpans = stripPrefixFromSpans(line.spans, parsedList.prefixRegex);
      const listSpans: TextSpan[] = [...cleanSpans];
      let prevY = line.y;
      let prevH = line.height;
      let nextIdx = i + 1;

      while (nextIdx < lines.length) {
        const nxt = lines[nextIdx];
        const gap = Math.abs(prevY - nxt.y);
        const nxtChunks = mergeLineItemsIntoChunks(nxt);
        const nxtParsedList = parseListLine(nxt, nxtChunks);
        const nxtHead = isHeadlineCandidate(nxt, nxtChunks.length, Boolean(context.inTwoColumn));
        const nxtTightWrap =
          nxtChunks.length === 1 ||
          (nxtChunks.length === 2 && nxtChunks[1].minX - nxtChunks[0].maxX < 42);
        const isNextIndented =
          nxtTightWrap &&
          nxt.minX >= parsedList.markerMinX + 8 &&
          nxt.minX >= parsedList.contentMinX - 14;
        if (
          isNextIndented &&
          gap <= Math.max(20, prevH * 1.7) &&
          !nxtParsedList &&
          !(options.detectCodeBlocks && isLineCodeStart(nxt)) &&
          !isMathProseLine(nxt) &&
          !nxtHead.isTitle &&
          !nxtHead.headingLevel
        ) {
          const lastCh = listSpans[listSpans.length - 1]?.text.slice(-1) || '';
          const nxtFirst = nxt.spans[0];
          if (nxtFirst) {
            const needsSpace = lastCh !== ' ' && !nxtFirst.text.startsWith(' ');
            listSpans.push(
              ...nxt.spans.map((sp, spIdx) =>
                spIdx === 0 && needsSpace ? { ...sp, text: ' ' + sp.text } : { ...sp }
              )
            );
          }
          prevY = nxt.y;
          prevH = nxt.height;
          nextIdx++;
        } else {
          break;
        }
      }

      const relMarkerPt = Math.max(0, parsedList.markerMinX - bodyLeftAnchorPt);
      const relContentPt = Math.max(relMarkerPt + 13, parsedList.contentMinX - bodyLeftAnchorPt);
      const indentHanging = Math.max(240, Math.min(480, Math.round((relContentPt - relMarkerPt) * 20)));
      const indentLeft = Math.max(indentHanging, Math.round(relContentPt * 20));
      const nextLineAfter = nextIdx < lines.length ? lines[nextIdx] : undefined;
      const gapAfterPt = nextLineAfter
        ? Math.max(1.2, Math.min(10, Math.abs(prevY - nextLineAfter.y) - (prevH || 11) * 1.18))
        : 1.5;

      blocks.push({
        type: 'list-item',
        listType: 'bullet',
        listLevel: 0,
        spans: mergeAdjacentSpans(listSpans),
        alignment: 'left',
        indentLeft,
        indentHanging,
        spacingBefore: 16,
        spacingAfter: Math.max(24, Math.min(180, Math.round(gapAfterPt * 20))),
        yTopPt: line.y + (line.height || 10),
        yBottomPt: prevY,
      });
      prevListKind = null;
      prevNumberedValue = 0;
      observedListWrapGap = 0;
      i = nextIdx;
      continue;
    }

    if (
      (parsedList?.kind === 'numbered' || parsedList?.kind === 'step') &&
      parsedList.itemNumber !== undefined
    ) {
      const targetKind = parsedList.kind;
      const itemNumber = parsedList.itemNumber;
      const lineMaxFontSize = Math.max(...line.spans.map((s) => s.fontSize), 0);
      const modalListFS = line.height || lineMaxFontSize;
      const mostlyBold = isLineMostlyBold(line);

      const nextSiblingNum = lookaheadNextNumber(i, targetKind, parsedList.markerMinX);
      const continuesPrevSequence =
        prevListKind === targetKind && itemNumber === prevNumberedValue + 1;
      const startsNewSequence =
        nextSiblingNum !== null && nextSiblingNum === itemNumber + 1;
      const isPartOfSequence = continuesPrevSequence || startsNewSequence;

      const passesBareOrColonGuard = !parsedList.requiresSequenceProof || isPartOfSequence;
      const isSectionHeadingInstead =
        targetKind === 'numbered' &&
        !isPartOfSequence &&
        ((mostlyBold &&
          !context.inTwoColumn &&
          line.rawText.trim().length < 70 &&
          !/[\.!?;]$/.test(line.rawText.trim())) ||
          (!parsedList.hasHangingMarker &&
            modalListFS >= medianFontSize * 1.24 &&
            mostlyBold &&
            !/[\.!?;]$/.test(line.rawText.trim()) &&
            line.rawText.trim().length < 60));

      if (passesBareOrColonGuard && !isSectionHeadingInstead) {
        if (prevListKind !== targetKind || itemNumber === 1) {
          context.numberedListInstanceRef.current += 1;
          observedListWrapGap = 0;
        }
        const cleanSpans = stripPrefixFromSpans(line.spans, parsedList.prefixRegex);
        const listSpans: TextSpan[] = [...cleanSpans];
        let prevY = line.y;
        let prevH = line.height;
        let lastLineRaw = line.rawText.trim();
        let observedContentX = parsedList.contentMinX;
        let nextIdx = i + 1;

        // Absorb wrapped continuation lines (supports BOTH hanging indent and flush-left wrapped procedures, including last item!)
        while (nextIdx < lines.length) {
          const nxt = lines[nextIdx];
          if (nxt.ocrParagraphBreakBefore) break;
          const gap = Math.abs(prevY - nxt.y);
          const nxtChunks = mergeLineItemsIntoChunks(nxt);
          const nxtParsedList = parseListLine(nxt, nxtChunks);
          const nxtHead = isHeadlineCandidate(nxt, nxtChunks.length, Boolean(context.inTwoColumn));
          const nxtTightWrap =
            nxtChunks.length === 1 ||
            (nxtChunks.length === 2 && nxtChunks[1].minX - nxtChunks[0].maxX < 42);

          const isNextIndented =
            nxtTightWrap &&
            nxt.minX >= parsedList.markerMinX + 8 &&
            nxt.minX >= parsedList.contentMinX - 14;

          const hasFutureSiblingDirectlyAfter =
            isPartOfSequence &&
            (() => {
              const sib = lookaheadNextNumber(nextIdx - 1, targetKind, parsedList.markerMinX);
              return sib !== null && sib === itemNumber + 1;
            })();

          const nxtRaw = nxt.rawText.trim();
          const looksLikeSummaryOrSectionAfterList =
            /^(?:Abstract|Introduction|Background|Methodology|Results|Discussion|References|Appendix|Section\s+\d+|Summary|Conclusion|Interpretation|Note|Notes|Overall|In\s+summary|Table\s+\d+|Figure\s+\d+)\s*:?/i.test(
              nxtRaw
            ) ||
            Math.abs((nxt.height || prevH) - prevH) >= 1.0 ||
            isKeyValueMetadataLine(nxt) ||
            isFrontMatterMetadataLine(nxt);

          const isFinalItemTightContinuation =
            continuesPrevSequence &&
            nextSiblingNum === null &&
            !looksLikeSummaryOrSectionAfterList &&
            (observedListWrapGap > 0
              ? gap <= observedListWrapGap + 2.2
              : gap <= Math.max(17.5, prevH * 1.46));

          const isFlushWrappedContinuation =
            nxtTightWrap &&
            nxt.minX >= Math.min(parsedList.markerMinX, bodyLeftAnchorPt) - 6 &&
            gap <= Math.max(21, prevH * 1.75) &&
            (hasFutureSiblingDirectlyAfter ||
              isFinalItemTightContinuation ||
              (!/[\.!?]$/.test(lastLineRaw) &&
                !looksLikeSummaryOrSectionAfterList &&
                gap <= Math.max(17.5, prevH * 1.5)));

          const isDedicatedFormulaLine =
            isMathProseLine(nxt) &&
            (/^(?:Formula|Equation|Circle\s+formula|Linear\s+equation|Energy(?:-mass)?)\s*:/i.test(
              nxtRaw
            ) ||
              /[\.!?]$/.test(lastLineRaw));

          if (
            (isNextIndented || isFlushWrappedContinuation) &&
            gap <= Math.max(22, prevH * 1.85) &&
            !nxtParsedList &&
            !(options.detectCodeBlocks && isLineCodeStart(nxt)) &&
            !isDedicatedFormulaLine &&
            !nxtHead.isTitle &&
            !nxtHead.headingLevel
          ) {
            observedListWrapGap = observedListWrapGap > 0 ? Math.min(observedListWrapGap, gap) : gap;
            if (isNextIndented) {
              observedContentX = Math.min(observedContentX, nxt.minX);
            }
            const lastCh = listSpans[listSpans.length - 1]?.text.slice(-1) || '';
            const nxtFirst = nxt.spans[0];
            if (nxtFirst) {
              const needsSpace = lastCh !== ' ' && !nxtFirst.text.startsWith(' ');
              listSpans.push(
                ...nxt.spans.map((sp, spIdx) =>
                  spIdx === 0 && needsSpace ? { ...sp, text: ' ' + sp.text } : { ...sp }
                )
              );
            }
            prevY = nxt.y;
            prevH = nxt.height;
            lastLineRaw = nxtRaw;
            nextIdx++;
          } else {
            break;
          }
        }

        const relMarkerPt = Math.max(0, parsedList.markerMinX - bodyLeftAnchorPt);
        const defaultStepOffset = targetKind === 'step' ? 26 : 14;
        const relContentPt = Math.max(
          relMarkerPt + defaultStepOffset,
          observedContentX - bodyLeftAnchorPt
        );
        const indentHanging = Math.max(
          240,
          Math.min(720, Math.round((relContentPt - relMarkerPt) * 20))
        );
        const indentLeft = Math.max(indentHanging, Math.round(relContentPt * 20));
        const nextLineAfter = nextIdx < lines.length ? lines[nextIdx] : undefined;
        const gapAfterPt = nextLineAfter
          ? Math.max(1.5, Math.min(11, Math.abs(prevY - nextLineAfter.y) - (prevH || 11) * 1.18))
          : 2.0;

        blocks.push({
          type: 'list-item',
          listType: targetKind,
          listLevel: 0,
          listInstance: context.numberedListInstanceRef.current,
          spans: mergeAdjacentSpans(listSpans),
          alignment: 'left',
          indentLeft,
          indentHanging,
          spacingBefore: continuesPrevSequence ? 18 : 36,
          spacingAfter: Math.max(28, Math.min(220, Math.round(gapAfterPt * 20))),
          yTopPt: line.y + (line.height || 10),
          yBottomPt: prevY,
        });
        prevListKind = targetKind;
        prevNumberedValue = itemNumber;
        i = nextIdx;
        continue;
      }
    }

    prevListKind = null;
    prevNumberedValue = 0;
    observedListWrapGap = 0;

    // 4. Multi-column Actual Data / Metadata Table Classification
    if (
      !context.inTwoColumn &&
      !context.inCallout &&
      options.detectTables &&
      chunks.length >= 2 &&
      !isMathProseLine(line)
    ) {
      const remainingLines = lines.slice(i);
      const { table, consumedLineCount } = detectTableInLines(
        remainingLines,
        printableWidthTwips,
        options.defaultFontFamily,
        context.vectorTableHints
      );
      if (table && consumedLineCount >= 2) {
        if (!table.yTopPt) {
          table.yTopPt = remainingLines[0].y + (remainingLines[0].height || 11);
          table.yBottomPt = remainingLines[consumedLineCount - 1].y;
        }
        blocks.push(table);
        hasTables = true;
        i += consumedLineCount;
        continue;
      }
    }

    // 5. Standalone Mathematical / Symbol Formula Line -> Dedicated Paragraph
    if (isMathProseLine(line)) {
      blocks.push({
        type: 'paragraph',
        spans: line.spans,
        alignment: 'left',
        spacingBefore: 24,
        spacingAfter: 36,
        yTopPt: line.y + (line.height || 10),
        yBottomPt: line.y,
      });
      i++;
      continue;
    }

    // Alignment calculation relative to page width
    const alignment = computeLineAlignment(line);

    // 6. Semantic Title / Heading 1 / Heading 2 Classification
    const headline = isHeadlineCandidate(line, chunks.length, Boolean(context.inTwoColumn));
    if (headline.isTitle) {
      context.titleAssignedRef.assigned = true;
      blocks.push({
        type: 'title',
        spans: line.spans,
        alignment,
        keepNext: true,
        spacingBefore: 40,
        spacingAfter: 80,
        yTopPt: line.y + (line.height || 14),
        yBottomPt: line.y,
      });
      i++;
      continue;
    }

    if (headline.headingLevel) {
      blocks.push({
        type: 'heading',
        headingLevel: headline.headingLevel,
        spans: line.spans,
        alignment,
        keepNext: true,
        spacingBefore: headline.headingLevel === 1 ? 120 : 80,
        spacingAfter: 36,
        yTopPt: line.y + (line.height || 12),
        yBottomPt: line.y,
      });
      i++;
      continue;
    }

    // 7. Regular Normal Paragraph grouping (respecting Research Authors / Department / Abstract / paragraph boundaries!)
    const paraSpans: TextSpan[] = [...line.spans];
    const paraStartedFrontMatter =
      isFrontMatterMetadataLine(line) || isExplicitColonFrontMatter(line) || isKeyValueMetadataLine(line);
    let prevLine = line;
    let prevY = line.y;
    let prevHeight = line.height || 11;
    let paraWrapLeftX = line.minX;
    let nextIdx = i + 1;

    while (nextIdx < lines.length) {
      const nextLine = lines[nextIdx];
      if (nextLine.ocrParagraphBreakBefore) break;
      const lineGap = Math.abs(prevY - nextLine.y);
      const nextDivs = getLineVerticalDividers(nextLine.y, nextLine.minX, nextLine.maxX);
      const nextChunks = mergeLineItemsIntoChunks(nextLine, nextDivs);
      const nextHeadline = isHeadlineCandidate(
        nextLine,
        nextChunks.length,
        Boolean(context.inTwoColumn)
      );

      const isListNext = parseListLine(nextLine, nextChunks) !== null;
      const isCodeNext = options.detectCodeBlocks && isLineCodeStart(nextLine);
      const isMathNext = isMathProseLine(nextLine);
      const isTableNext =
        !context.inTwoColumn &&
        !context.inCallout &&
        options.detectTables &&
        nextChunks.length >= 2 &&
        !isMathNext;
      const isHeadingNext = nextHeadline.isTitle || Boolean(nextHeadline.headingLevel);

      if (isHeadingNext || isListNext || isCodeNext || isMathNext || isTableNext) {
        break;
      }

      // Adaptive wrap gap limit so 10-11pt paragraphs separated by ~17.5-20pt spacing NEVER merge together
      const maxAllowedWrapGap =
        tightBodyLeading > 0
          ? Math.min(
              Math.max(16.2, prevHeight * 1.54),
              Math.max(tightBodyLeading * 1.22, prevHeight * 1.46)
            )
          : Math.max(16.2, prevHeight * 1.54);
      if (lineGap > maxAllowedWrapGap) {
        break;
      }

      // Academic front-matter / metadata line isolation: separate Authors from Department, Meeting ID, Date, Keywords, Abstract
      const prevRaw = stripInvisibleChars(prevLine.rawText).trim();
      const nextRaw = stripInvisibleChars(nextLine.rawText).trim();
      const prevIsFront =
        nextIdx === i + 1 ? paraStartedFrontMatter : isExplicitColonFrontMatter(prevLine);
      const nextIsFront = isFrontMatterMetadataLine(nextLine);
      const prevEndsWithPrepOrComma =
        /(?:,|\b(?:the|a|an|of|in|on|at|by|for|to|from|with|and|or|as|into|under|via|per))$/i.test(
          prevRaw
        );
      const prevEndsWithPrepOrFullRight =
        prevEndsWithPrepOrComma ||
        (prevLine.maxX >= regionRightEdgePt - 28 && !/[\.!?]$/.test(prevRaw));
      const isPrevStandaloneLabel = /^(?:Abstract|Summary|Keywords?)\s*:?$/i.test(prevRaw);
      const isNextInlineSection =
        /^(?:Abstract|Summary|Keywords?|Index\s+Terms?|Note|Notes|Conclusion|Interpretation)\s*(?::|[\.\-–—]\s|$)/i.test(
          nextRaw
        );
      if (isPrevStandaloneLabel || isExplicitColonFrontMatter(nextLine) || isKeyValueMetadataLine(nextLine) || isNextInlineSection) {
        break;
      }
      if (nextIsFront && (paraStartedFrontMatter || !prevEndsWithPrepOrFullRight)) {
        break;
      }
      if (prevIsFront && (!prevRaw.endsWith(',') || isFrontMatterMetadataLine(nextLine))) {
        break;
      }
      if (
        prevIsFront &&
        prevRaw.endsWith(',') &&
        /^(?:and\s+)?[A-Z](?:[a-z]+|\.)/.test(nextRaw) === false
      ) {
        break;
      }

      // Alignment switch (e.g. centered Authors/Title/Department vs left-aligned text, or distinct centered short lines)
      const nextAlign = computeLineAlignment(nextLine);
      if (nextAlign !== alignment) {
        break;
      }
      if (
        alignment === 'center' &&
        (prevLine.maxX - prevLine.minX < context.pageWidthPt * 0.55 ||
          isLineMostlyBold(prevLine) !== isLineMostlyBold(nextLine) ||
          isLineAllItalic(prevLine) !== isLineAllItalic(nextLine))
      ) {
        break;
      }

      // Font size shift (>= 0.8pt) or full-line typographic weight/style switch on a non-mid-clause boundary
      const nextHeight = nextLine.height || 11;
      if (Math.abs(prevHeight - nextHeight) >= 0.85) {
        break;
      }
      const styleShift =
        isLineMostlyBold(prevLine) !== isLineMostlyBold(nextLine) ||
        isLineAllItalic(prevLine) !== isLineAllItalic(nextLine);
      if (
        styleShift &&
        (/[\.!?]$/.test(prevRaw) ||
          lineGap >= prevHeight * 1.28 ||
          prevLine.maxX < regionRightEdgePt - 40)
      ) {
        break;
      }

      // First-line indentation jump (standard LaTeX / academic paragraph break without vertical space)
      if (
        alignment === 'left' &&
        nextLine.minX - paraWrapLeftX >= 10 &&
        nextLine.minX <= context.pageWidthPt * 0.35
      ) {
        break;
      }

      // Short trailing line ending with sentence punctuation when next line's first word would easily have fit,
      // OR distinctly short non-sentence metadata/field line followed by a new capitalized line
      const nextFirstWord = nextRaw.split(/\s+/)[0] || '';
      const estFirstWordW = nextFirstWord.length * nextHeight * 0.52;
      const prevSpanW = prevLine.maxX - prevLine.minX;
      const fullSpanW = regionRightEdgePt - regionLeftEdgePt;
      const prevEndsSentence = /[\.!?]["'”\)]?$/.test(prevRaw);
      const refFullSpanW = Math.max(
        fullSpanW,
        context.inTwoColumn ? 130 : context.pageWidthPt * 0.66
      );
      if (
        prevEndsSentence &&
        fullSpanW >= (context.inTwoColumn ? 130 : 220) &&
        prevSpanW < fullSpanW * 0.85 &&
        prevLine.maxX + estFirstWordW + 22 < regionRightEdgePt
      ) {
        break;
      }
      if (
        !context.inTwoColumn &&
        !context.inCallout &&
        !prevEndsSentence &&
        refFullSpanW >= 280 &&
        prevLine.maxX - regionLeftEdgePt < refFullSpanW * 0.50 &&
        !prevEndsWithPrepOrComma &&
        !/[;\-:(\[]$/.test(prevRaw) &&
        /^[A-Z0-9]/.test(nextRaw) &&
        prevLine.maxX + estFirstWordW + 28 < Math.max(regionRightEdgePt, regionLeftEdgePt + refFullSpanW * 0.85)
      ) {
        break;
      }

      const lastChar = paraSpans[paraSpans.length - 1]?.text.slice(-1) || '';
      const nextFirstSpan = nextLine.spans[0];
      if (nextFirstSpan) {
        const needsSpace = lastChar !== ' ' && !nextFirstSpan.text.startsWith(' ');
        const spansToAppend = nextLine.spans.map((sp, spIdx) =>
          spIdx === 0 && needsSpace ? { ...sp, text: ' ' + sp.text } : { ...sp }
        );
        paraSpans.push(...spansToAppend);
      }
      paraWrapLeftX = Math.min(paraWrapLeftX, nextLine.minX);
      prevLine = nextLine;
      prevY = nextLine.y;
      prevHeight = nextHeight;
      nextIdx++;
    }

    blocks.push({
      type: 'paragraph',
      spans: mergeAdjacentSpans(paraSpans),
      alignment,
      spacingBefore: 20,
      spacingAfter: 44,
      yTopPt: line.y + (line.height || 10),
      yBottomPt: prevY,
    });

    i = nextIdx;
  }

  return { blocks, hasTables, hasCode };
}

/**
 * Dynamically detects balanced Two-Column Text Layout regions from StructuredLines
 * without mistaking Key-Value tables or bordered N-column tables for two-column prose.
 */
export function findTwoColumnRegions(
  lines: StructuredLine[],
  pageWidthPt: number,
  medianFontSize: number,
  vectorTableHints?: VectorTableHints
): { startIdx: number; endIdx: number; splitX: number }[] {
  if (lines.length < 4) return [];

  const centerLow = pageWidthPt * 0.42;
  const centerHigh = pageWidthPt * 0.58;
  const pageMidX = pageWidthPt * 0.5;

  interface AnalyzedLine {
    line: StructuredLine;
    chunks: ReturnType<typeof mergeLineItemsIntoChunks>;
    leftEnd?: number;
    rightStart?: number;
    hasCrossCenter: boolean;
    hasBalancedSplit: boolean;
    splitMid?: number;
  }

  const analyzed: AnalyzedLine[] = lines.map((l) => {
    const chunks = mergeLineItemsIntoChunks(l);
    let hasCrossCenter = false;
    let bestLeftEnd: number | undefined;
    let bestRightStart: number | undefined;
    let bestScore = -1;

    for (const c of chunks) {
      if (c.minX < pageWidthPt * 0.44 && c.maxX > pageWidthPt * 0.56) {
        hasCrossCenter = true;
      }
    }

    for (let k = 0; k < chunks.length - 1; k++) {
      const gapStart = chunks[k].maxX;
      const gapEnd = chunks[k + 1].minX;
      const gapW = gapEnd - gapStart;
      if (gapW >= 14 && gapStart <= centerHigh && gapEnd >= centerLow) {
        const clampedCenter = Math.max(gapStart + 6, Math.min(gapEnd - 6, pageMidX));
        const distFromPageCenter = Math.abs(clampedCenter - pageMidX);
        const score = gapW - distFromPageCenter * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestLeftEnd = gapStart;
          bestRightStart = gapEnd;
        }
      }
    }

    const splitCandidate =
      bestLeftEnd !== undefined && bestRightStart !== undefined
        ? Math.max(bestLeftEnd + 6, Math.min(bestRightStart - 6, pageMidX))
        : undefined;

    return {
      line: l,
      chunks,
      leftEnd: bestLeftEnd,
      rightStart: bestRightStart,
      hasCrossCenter,
      hasBalancedSplit:
        bestLeftEnd !== undefined && bestRightStart !== undefined && !hasCrossCenter,
      splitMid: splitCandidate,
    };
  });

  const regions: { startIdx: number; endIdx: number; splitX: number }[] = [];
  let cursor = 0;

  while (cursor < analyzed.length) {
    if (!analyzed[cursor].hasBalancedSplit || analyzed[cursor].chunks.length > 2) {
      cursor++;
      continue;
    }

    const initialMids: number[] = [];
    for (let k = cursor; k < Math.min(analyzed.length, cursor + 12); k++) {
      if (analyzed[k].hasBalancedSplit && analyzed[k].splitMid !== undefined) {
        initialMids.push(analyzed[k].splitMid!);
      } else if (analyzed[k].hasCrossCenter) {
        break;
      }
    }

    if (initialMids.length < 2) {
      cursor++;
      continue;
    }

    initialMids.sort((a, b) => a - b);
    const splitX = initialMids[Math.floor(initialMids.length / 2)];

    let endIdx = cursor;
    let pairedCount = 0;
    let consecutiveMultiColRows = 0;
    let firstMultiColIdx = -1;
    let colALongProseLines = 0;
    let colAConciseBoldRows = 0;

    for (let j = cursor; j < analyzed.length; j++) {
      const cur = analyzed[j];
      if (j > cursor) {
        const verticalGap = Math.abs(analyzed[j - 1].line.y - cur.line.y);
        if (verticalGap > 95) break;
      }

      const crossesSplit = cur.chunks.some(
        (c) => c.minX < splitX - 8 && c.maxX > splitX + 8
      );
      if (crossesSplit) break;

      const leftChunks = cur.chunks.filter((c) => (c.minX + c.maxX) / 2 < splitX);
      const rightChunks = cur.chunks.filter((c) => (c.minX + c.maxX) / 2 >= splitX);

      if (cur.chunks.length >= 3) {
        if (firstMultiColIdx === -1) firstMultiColIdx = j;
        consecutiveMultiColRows++;
        if (consecutiveMultiColRows >= 2) {
          endIdx = pairedCount >= 4 ? Math.max(cursor, firstMultiColIdx - 1) : cursor - 1;
          break;
        }
      } else {
        consecutiveMultiColRows = 0;
        firstMultiColIdx = -1;
      }

      if (leftChunks.length > 0 && rightChunks.length === 0) {
        let moreRightBelow = false;
        for (let look = j + 1; look < Math.min(analyzed.length, j + 8); look++) {
          const nxt = analyzed[look];
          if (nxt.chunks.some((c) => c.minX < splitX - 8 && c.maxX > splitX + 8)) break;
          if (nxt.chunks.some((c) => (c.minX + c.maxX) / 2 >= splitX)) {
            moreRightBelow = true;
            break;
          }
        }

        if (!moreRightBelow) {
          const lineMaxH = Math.max(...cur.line.spans.map((s) => s.fontSize), 0);
          const raw = cur.line.rawText.trim();
          const looksLikeNextSectionHeading =
            lineMaxH >= medianFontSize * 1.24 ||
            /^(Section\s+\d+|\d+\.\s+[A-Z]|Code\s+Block|Mathematical|Formatting|Checklist|Objectives|Ordered\s+Procedure)/i.test(
              raw
            );
          if (looksLikeNextSectionHeading) {
            break;
          }
        }
      }

      if (leftChunks.length > 0 && rightChunks.length > 0) pairedCount++;

      const leftText = leftChunks.map((c) => c.str).join(' ').trim();
      const rightText = rightChunks.map((c) => c.str).join(' ').trim();
      const leftAllBold = leftChunks.length > 0 && leftChunks.every((c) => c.isBold);

      if (leftText.length > 26 && !leftAllBold) colALongProseLines++;
      if (leftText.length > 0 && leftText.length <= 28 && leftAllBold && rightText.length > 0) {
        colAConciseBoldRows++;
      }

      endIdx = j;
    }

    const regionLen = endIdx - cursor + 1;
    const regionMaxY = analyzed[cursor].line.y + 12;
    const regionMinY = analyzed[endIdx].line.y - 6;

    // Also guard against a bordered 2-column table (horizontal row dividers inside region)
    const internalHRulesCount = vectorTableHints
      ? vectorTableHints.hSegments.filter(
          (h) => h.y >= regionMinY && h.y <= regionMaxY && h.x2 - h.x1 >= 120
        ).length
      : 0;
    const looksLikeBorderedTwoColTable =
      internalHRulesCount >= 3 || (internalHRulesCount >= 2 && colALongProseLines === 0);

    const looksLikeKeyValueMetadataTable =
      regionLen <= 6 &&
      colALongProseLines === 0 &&
      colAConciseBoldRows >= Math.max(2, pairedCount - 1) &&
      pairedCount === regionLen;

    const looksLikeTwoColumnProse =
      regionLen >= 4 &&
      pairedCount >= 2 &&
      !looksLikeKeyValueMetadataTable &&
      !looksLikeBorderedTwoColTable &&
      (regionLen >= 5 || colALongProseLines >= 1);

    if (looksLikeTwoColumnProse) {
      regions.push({ startIdx: cursor, endIdx, splitX });
      cursor = endIdx + 1;
    } else {
      cursor++;
    }
  }

  return regions;
}

/**
 * Resolves PDF.js font descriptor metadata for every fontName seen on the page.
 */
async function resolveFontMetadataMap(
  page: any,
  styles: Record<string, any> | undefined,
  fontNames: string[]
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  try {
    await page.getOperatorList();
  } catch {
    // non-fatal if operator list cannot be fetched
  }

  for (const fname of new Set(fontNames)) {
    if (!fname) continue;
    let fontObj: any = null;
    try {
      if (page.commonObjs && typeof page.commonObjs.has === 'function' && page.commonObjs.has(fname)) {
        fontObj = page.commonObjs.get(fname);
      }
    } catch {
      // ignore missing commonObj
    }
    const styleObj = styles ? styles[fname] : undefined;
    map.set(fname, {
      resolvedName: fontObj?.name || '',
      cssFontFamily: styleObj?.fontFamily || '',
      bold: Boolean(fontObj?.bold),
      italic: Boolean(fontObj?.italic),
      black: Boolean(fontObj?.black),
      isMonospace: Boolean(fontObj?.isMonospace),
    });
  }

  return map;
}

function getBlockYTop(b: StructuredBlock): number {
  return (b as any)?.yTopPt ?? 0;
}

/**
 * Separates running top headers and bottom footers from main body lines cleanly.
 */
export function separateHeaderAndFooterLines(
  allPageLines: StructuredLine[],
  pageNumber: number,
  heightPt: number,
  medianFontSize: number
): {
  bodyLines: StructuredLine[];
  extractedHeaderText?: string;
  extractedFooterText?: string;
  hasPageNumbers: boolean;
} {
  const topHeaderBandMinY = heightPt - 44;
  const bottomFooterBandMaxY = Math.min(64, heightPt * 0.08);
  const explicitPageNumMaxY = Math.min(72, heightPt * 0.09);

  let extractedHeaderText: string | undefined;
  let extractedFooterText: string | undefined;
  let hasPageNumbers = false;
  const bodyLines: StructuredLine[] = [];

  for (const line of allPageLines) {
    const raw = stripInvisibleChars(line.rawText).trim();
    const maxLineFS = Math.max(...line.spans.map((s) => s.fontSize), 10);

    const isTopHeader =
      line.y >= topHeaderBandMinY &&
      maxLineFS <= Math.max(10.5, medianFontSize * 0.96) &&
      (pageNumber > 1 || /Page\s+\d+|\|/.test(raw));

    if (isTopHeader) {
      if (!extractedHeaderText && !/^Page\s+\d+/i.test(raw)) {
        extractedHeaderText = raw;
      }
      continue;
    }

    const hasExplicitPagePattern =
      /Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?/i.test(raw) ||
      /\b\d+\s+of\s+\d+\b/i.test(raw) ||
      /\|\s*\d{1,3}(?:\s*\/\s*\d{1,3})?\s*$/.test(raw) ||
      /^\d{1,3}(?:\s*\/\s*\d{1,3})?$/.test(raw);
    const looksLikeGenericFooter =
      line.y <= bottomFooterBandMaxY &&
      maxLineFS <= Math.max(10.5, medianFontSize * 0.98) &&
      !/[\.!?]$/.test(raw) &&
      (raw.includes('|') || raw.length <= 100);

    const isExplicitBottomFooter =
      line.y <= explicitPageNumMaxY &&
      hasExplicitPagePattern &&
      maxLineFS <=
        (line.y <= 58
          ? Math.max(11.5, medianFontSize * 1.05)
          : Math.max(10.5, medianFontSize * 0.96)) &&
      (line.y <= 48 || (!/[\.!?]$/.test(raw) && raw.length <= 115));

    const isBottomFooter =
      isExplicitBottomFooter ||
      (line.y <= bottomFooterBandMaxY && looksLikeGenericFooter);

    if (isBottomFooter) {
      if (hasExplicitPagePattern) {
        hasPageNumbers = true;
      }
      const cleanedPrefix = raw
        .replace(
          /\s*\|\s*(?:Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+|\d{1,3}\s*\/\s*\d{1,3}|\d{1,3})\s*(?=\||$)/gi,
          ''
        )
        .replace(/^\s*(?:Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+)\s*[\|\-–—]?\s*/gi, '')
        .replace(/\b(?:Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+)\b/gi, '')
        .replace(/^\d{1,3}(?:\s*\/\s*\d{1,3})?$/, '')
        .replace(/^\s*[\|•·\-–—]+\s*|\s*[\|•·\-–—]+\s*$/g, '')
        .trim();

      if (cleanedPrefix && !extractedFooterText) {
        extractedFooterText = cleanedPrefix;
      }
      continue;
    }

    bodyLines.push(line);
  }

  return { bodyLines, extractedHeaderText, extractedFooterText, hasPageNumbers };
}

/**
 * Shared full-page structuring pipeline usable by BOTH PDF text pages and OCR'd scanned pages.
 */
export function buildPageDataFromLines(
  allPageLines: StructuredLine[],
  options: ConversionOptions,
  params: {
    pageNumber: number;
    widthPt: number;
    heightPt: number;
    pageImages?: StructuredImage[];
    calloutBlocks?: StructuredCalloutBlock[];
    vectorTableHints?: VectorTableHints;
    hasDiagramsOrImages?: boolean;
    ocrReviewCount?: number;
  }
): ExtractedPageData {
  const { pageNumber, widthPt, heightPt } = params;
  const orientation: 'portrait' | 'landscape' = widthPt > heightPt ? 'landscape' : 'portrait';

  const allFontSizes = allPageLines.flatMap((l) => l.spans.map((s) => s.fontSize));
  const sortedSizes = [...allFontSizes].sort((a, b) => a - b);
  const medianFontSize = sortedSizes[Math.floor(sortedSizes.length / 2)] || 11;

  const {
    bodyLines,
    extractedHeaderText,
    extractedFooterText,
    hasPageNumbers,
  } = separateHeaderAndFooterLines(allPageLines, pageNumber, heightPt, medianFontSize);

  const bodyItemsFlat = bodyLines.flatMap((l) => l.items);
  const bodyMinX = bodyItemsFlat.length > 0 ? Math.min(...bodyItemsFlat.map((it) => it.x)) : 54;
  const bodyMaxX =
    bodyItemsFlat.length > 0
      ? Math.max(...bodyItemsFlat.map((it) => it.x + (it.width || 0)))
      : widthPt - 54;
  const bodyTopY =
    bodyLines.length > 0 ? Math.max(...bodyLines.map((l) => l.y + l.height)) : heightPt - 54;
  const bodyBottomY = bodyLines.length > 0 ? Math.min(...bodyLines.map((l) => l.y)) : 54;

  const marginsPt = {
    top: Math.max(40, Math.min(58, Math.round(heightPt - bodyTopY))),
    bottom: Math.max(40, Math.min(58, Math.round(bodyBottomY))),
    left: Math.max(40, Math.min(64, Math.round(bodyMinX))),
    right: Math.max(40, Math.min(64, Math.round(widthPt - bodyMaxX))),
  };

  const printableWidthPt = widthPt - marginsPt.left - marginsPt.right;
  const printableWidthTwips = Math.round(printableWidthPt * 20);

  const twoColRegions = findTwoColumnRegions(
    bodyLines,
    widthPt,
    medianFontSize,
    params.vectorTableHints
  );

  const mainBlocks: StructuredBlock[] = [];
  let hasTables = false;
  let hasCode = false;

  const parseContext = {
    pageNumber,
    pageWidthPt: widthPt,
    bodyLeftMarginPt: marginsPt.left,
    inTwoColumn: false,
    titleAssignedRef: { assigned: false },
    numberedListInstanceRef: { current: (pageNumber - 1) * 100 },
    vectorTableHints: params.vectorTableHints,
  };

  let lineCursor = 0;
  for (const region of twoColRegions) {
    if (lineCursor < region.startIdx) {
      const slice = bodyLines.slice(lineCursor, region.startIdx);
      const parsed = parseBlocksFromLines(
        slice,
        options,
        printableWidthTwips,
        medianFontSize,
        { ...parseContext, inTwoColumn: false }
      );
      mainBlocks.push(...parsed.blocks);
      if (parsed.hasTables) hasTables = true;
      if (parsed.hasCode) hasCode = true;
    }

    const twoColSlice = bodyLines.slice(region.startIdx, region.endIdx + 1);
    const twoColItems = twoColSlice.flatMap((l) => l.items);

    const leftItems: RawItem[] = [];
    const rightItems: RawItem[] = [];

    for (const it of twoColItems) {
      const itW = it.width > 0 ? it.width : it.str.length * 4.5;
      const center = it.x + itW / 2;
      if (center < region.splitX) {
        leftItems.push(it);
      } else {
        rightItems.push(it);
      }
    }

    const leftLines = groupItemsIntoLines(leftItems, options.defaultFontFamily);
    const rightLines = groupItemsIntoLines(rightItems, options.defaultFontFamily);

    const gutterTwips = 480;
    const leftRatio = Math.max(
      0.42,
      Math.min(0.58, (region.splitX - marginsPt.left) / Math.max(100, printableWidthPt))
    );
    const innerAvail = printableWidthTwips - gutterTwips;
    const leftColTwips = Math.round(innerAvail * leftRatio);
    const rightColTwips = innerAvail - leftColTwips;

    const leftParsed = parseBlocksFromLines(
      leftLines,
      options,
      leftColTwips,
      medianFontSize,
      { ...parseContext, inTwoColumn: true }
    );
    const rightParsed = parseBlocksFromLines(
      rightLines,
      options,
      rightColTwips,
      medianFontSize,
      { ...parseContext, inTwoColumn: true }
    );

    const twoColBlock: StructuredTwoColumnBlock = {
      type: 'two-column',
      leftBlocks: leftParsed.blocks,
      rightBlocks: rightParsed.blocks,
      leftWidthTwips: leftColTwips,
      rightWidthTwips: rightColTwips,
      gutterTwips,
      yTopPt: twoColSlice[0].y + (twoColSlice[0].height || 10),
      yBottomPt: twoColSlice[twoColSlice.length - 1].y,
    };

    mainBlocks.push(twoColBlock);
    if (leftParsed.hasTables || rightParsed.hasTables) hasTables = true;
    if (leftParsed.hasCode || rightParsed.hasCode) hasCode = true;

    lineCursor = region.endIdx + 1;
  }

  if (lineCursor < bodyLines.length) {
    const trailingSlice = bodyLines.slice(lineCursor);
    const parsed = parseBlocksFromLines(
      trailingSlice,
      options,
      printableWidthTwips,
      medianFontSize,
      { ...parseContext, inTwoColumn: false }
    );
    mainBlocks.push(...parsed.blocks);
    if (parsed.hasTables) hasTables = true;
    if (parsed.hasCode) hasCode = true;
  }

  // Interleave callouts, raster images, cropped diagrams, and main flow blocks by vertical Y order
  const combined: { block: StructuredBlock; yTop: number; seq: number }[] = [];
  let seqCounter = 0;

  for (const b of mainBlocks) {
    combined.push({ block: b, yTop: getBlockYTop(b), seq: seqCounter++ });
  }
  for (const c of params.calloutBlocks || []) {
    combined.push({ block: c, yTop: getBlockYTop(c), seq: seqCounter++ });
  }
  for (const img of params.pageImages || []) {
    const topY = img.yTopPt ?? img.yPt + img.heightPt;
    combined.push({ block: img, yTop: topY, seq: seqCounter++ });
  }

  combined.sort((a, b) => {
    const dy = b.yTop - a.yTop;
    if (Math.abs(dy) > 2) return dy;
    return a.seq - b.seq;
  });

  const finalBlocks = combined.map((entry) => entry.block);

  const rawFullText = bodyLines.map((l) => l.rawText).join('\n');
  const words = rawFullText.split(/\s+/).filter(Boolean).length;

  const isCoverPage =
    pageNumber === 1 &&
    words < 90 &&
    bodyLines.some((l) => Math.max(...l.spans.map((s) => s.fontSize), 0) >= 22);

  const normalizedBlocks = finalBlocks
    .filter((b) => b && typeof b === 'object')
    .map((b) => {
      if (
        b.type === 'paragraph' ||
        b.type === 'heading' ||
        b.type === 'title' ||
        b.type === 'list-item'
      ) {
        const p = b as StructuredParagraph;
        if (!Array.isArray(p.spans) || p.spans.length === 0) {
          const txt = (p as any).text || (p as any).rawText || '';
          p.spans = [
            {
              text: txt,
              fontSize: p.type === 'heading' ? 14 : 11,
              fontFamily: options.defaultFontFamily,
              isBold: p.type === 'heading',
              isItalic: false,
              isMonospace: false,
            },
          ];
        }
      } else if (b.type === 'code-block') {
        const cb = b as StructuredCodeBlock;
        if (!Array.isArray(cb.lines)) {
          cb.lines = [];
        }
      }
      return b;
    });

  return {
    pageNumber,
    widthPt,
    heightPt,
    orientation,
    marginsPt,
    blocks: normalizedBlocks,
    isScanned: false,
    rawText: rawFullText,
    wordCount: words,
    hasTables,
    hasImages:
      Boolean(params.hasDiagramsOrImages) ||
      Boolean(params.pageImages && params.pageImages.length > 0),
    hasCode,
    isCoverPage,
    headerText: extractedHeaderText,
    footerText: extractedFooterText,
    hasPageNumbers,
    ...(params.ocrReviewCount !== undefined ? { ocrReviewCount: params.ocrReviewCount } : {}),
  };
}

/**
 * Parses a single PDF page into structured blocks with resolved font metadata,
 * accurate header/footer separation, vector callout & diagram extraction,
 * border-aware table reconstruction, cohesive code blocks, two-column text,
 * and Y-ordered visual object placement.
 */
export async function analyzePdfPage(
  page: any,
  options: ConversionOptions
): Promise<ExtractedPageData> {
  const pageNumber = page.pageNumber;
  const viewport = page.getViewport({ scale: 1.0 });
  const widthPt = viewport.width;
  const heightPt = viewport.height;
  const orientation: 'portrait' | 'landscape' = widthPt > heightPt ? 'landscape' : 'portrait';

  const textContent = await page.getTextContent();
  const fontNames = (textContent.items as any[])
    .map((it) => it?.fontName)
    .filter(Boolean);
  const fontMetaMap = await resolveFontMetadataMap(page, textContent.styles, fontNames);

  const rawItems: RawItem[] = [];
  for (const item of textContent.items as any[]) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str && str.length === 0) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width || 0;
    const scaleY = Math.hypot(item.transform[2] || 0, item.transform[3] || 0);
    const height = Math.max(item.height || 0, scaleY || 0) || 11;
    const meta = fontMetaMap.get(item.fontName || '');

    rawItems.push({
      str,
      x,
      y,
      width,
      height,
      fontName: item.fontName || '',
      transform: item.transform,
      resolvedFontName: meta?.resolvedName || '',
      cssFontFamily: meta?.cssFontFamily || '',
      isBoldFlag: meta?.bold || meta?.black || false,
      isItalicFlag: meta?.italic || false,
      isMonospaceFlag: meta?.isMonospace || false,
    });
  }

  // Extract embedded raster images
  let pageImages: StructuredImage[] = [];
  if (options.extractImages) {
    try {
      pageImages = await extractImagesFromPage(page, viewport);
    } catch {
      // fallback gracefully
    }
  }

  const totalRawChars = rawItems.reduce((acc, it) => acc + it.str.trim().length, 0);
  const hasFullPageRaster = pageImages.some(
    (img) => img.widthPt >= widthPt * 0.68 && img.heightPt >= heightPt * 0.55
  );

  // Scanned page check (handles zero-text scans AND scans stamped with tiny scanner page headers/footers)
  if (rawItems.length === 0 || totalRawChars < 20) {
    return {
      pageNumber,
      widthPt,
      heightPt,
      orientation,
      marginsPt: { top: 54, bottom: 54, left: 54, right: 54 },
      blocks: pageImages,
      isScanned: true,
      rawText: '',
      wordCount: 0,
      hasTables: false,
      hasImages: pageImages.length > 0,
      hasCode: false,
      isCoverPage: false,
    };
  }

  if (hasFullPageRaster && totalRawChars < 80) {
    const probeLines = groupItemsIntoLines(rawItems, options.defaultFontFamily);
    const probeSizes = probeLines.flatMap((l) => l.spans.map((s) => s.fontSize));
    const probeMedian =
      [...probeSizes].sort((a, b) => a - b)[Math.floor(probeSizes.length / 2)] || 11;
    const sep = separateHeaderAndFooterLines(probeLines, pageNumber, heightPt, probeMedian);
    const bodyCharCount = sep.bodyLines.reduce(
      (acc, l) => acc + l.rawText.trim().length,
      0
    );
    if (bodyCharCount < 20) {
      return {
        pageNumber,
        widthPt,
        heightPt,
        orientation,
        marginsPt: { top: 54, bottom: 54, left: 54, right: 54 },
        blocks: pageImages,
        isScanned: true,
        rawText: '',
        wordCount: 0,
        hasTables: false,
        hasImages: pageImages.length > 0,
        hasCode: false,
        isCoverPage: false,
        headerText: sep.extractedHeaderText,
        footerText: sep.extractedFooterText,
        hasPageNumbers: sep.hasPageNumbers,
      };
    }
  }

  // Extract vector graphics hints: table grid lines, shaded/bordered callouts, vector diagrams
  const vectorLayout = await extractVectorLayoutHints(page, widthPt, heightPt, rawItems);

  // Crop detected vector diagrams into high-DPI images and suppress duplicated internal node text
  const diagramImages: StructuredImage[] = [];
  const suppressedItemIndices = new Set<number>();

  if (options.extractImages && vectorLayout.diagrams.length > 0) {
    for (const diag of vectorLayout.diagrams) {
      const cropped = await cropPageRegionToPng(page, diag.cropBboxPt, 3.0);
      if (cropped && cropped.data.length > 0) {
        const diagCenterX = (diag.cropBboxPt.minX + diag.cropBboxPt.maxX) / 2;
        const alignment: 'left' | 'center' | 'right' =
          Math.abs(diagCenterX - widthPt / 2) < 48
            ? 'center'
            : diag.cropBboxPt.minX > widthPt * 0.5
            ? 'right'
            : 'left';

        diagramImages.push({
          type: 'image',
          data: cropped.data,
          widthPt: cropped.widthPt,
          heightPt: cropped.heightPt,
          xPt: Math.round(diag.cropBboxPt.minX),
          yPt: Math.round(diag.cropBboxPt.minY),
          alignment,
          isDiagram: true,
          yTopPt: diag.yTopPt,
          yBottomPt: diag.yBottomPt,
        });

        // Suppress ONLY items strictly inside diagram shape boxes / interior connector bounds
        // while always keeping external Figure/Diagram captions intact as editable paragraphs.
        for (let idx = 0; idx < rawItems.length; idx++) {
          const it = rawItems[idx];
          const str = it.str.trim();
          if (!str) continue;
          const itW = it.width > 0 ? it.width : Math.max(3, str.length * 4.5);
          const cx = it.x + itW / 2;
          const cy = it.y + getItemHeight(it) * 0.35;

          const inInternalBbox =
            cx >= diag.internalTextBboxPt.minX &&
            cx <= diag.internalTextBboxPt.maxX &&
            cy >= diag.internalTextBboxPt.minY &&
            cy <= diag.internalTextBboxPt.maxY;

          const inShape = diag.shapeBboxes.some(
            (s) =>
              cx >= s.minX - 2 &&
              cx <= s.maxX + 2 &&
              cy >= s.minY - 2 &&
              cy <= s.maxY + 2
          );

          if ((inInternalBbox || inShape) && !/^(?:Figure|Fig\.?|Diagram|Chart|Scheme|Architecture)\s*\d*[:.\-–]/i.test(str)) {
            suppressedItemIndices.add(idx);
          }
        }
      }
    }
  }

  // Route items enclosed inside styled Callout Boxes into StructuredCalloutBlock containers
  const calloutBlocks: StructuredCalloutBlock[] = [];
  for (const c of vectorLayout.callouts) {
    const calloutItems: RawItem[] = [];
    for (const idx of c.itemIndices) {
      if (suppressedItemIndices.has(idx)) continue;
      if (rawItems[idx]) {
        calloutItems.push(rawItems[idx]);
        suppressedItemIndices.add(idx);
      }
    }
    if (calloutItems.length === 0) continue;

    const underlinedCalloutItems = applyUnderlineSegmentsToItems(
      calloutItems,
      vectorLayout.underlineSegments
    );
    const calloutLines = groupItemsIntoLines(underlinedCalloutItems, options.defaultFontFamily);
    if (calloutLines.length === 0) continue;

    const innerWidthTwips = Math.max(3600, Math.round((c.maxX - c.minX - 24) * 20));
    const calloutSizes = calloutLines.flatMap((l) => l.spans.map((s) => s.fontSize));
    const calloutMedianFS =
      [...calloutSizes].sort((a, b) => a - b)[Math.floor(calloutSizes.length / 2)] || 10.5;

    const innerParsed = parseBlocksFromLines(
      calloutLines,
      options,
      innerWidthTwips,
      calloutMedianFS,
      {
        pageNumber,
        pageWidthPt: widthPt,
        inTwoColumn: false,
        inCallout: true,
        titleAssignedRef: { assigned: true },
        numberedListInstanceRef: { current: pageNumber * 1000 + calloutBlocks.length * 10 },
      }
    );

    if (innerParsed.blocks.length > 0) {
      calloutBlocks.push({
        type: 'callout',
        blocks: innerParsed.blocks,
        backgroundColor: c.backgroundColor,
        borderColor: c.borderColor,
        accentColor: c.accentColor,
        paddingTwips: 160,
        yTopPt: c.maxY,
        yBottomPt: c.minY,
      });
    }
  }

  const mainRawItems = applyUnderlineSegmentsToItems(
    rawItems.filter((_, idx) => !suppressedItemIndices.has(idx)),
    vectorLayout.underlineSegments
  );
  const allPageLines = groupItemsIntoLines(mainRawItems, options.defaultFontFamily);

  // Merge raster photos + cropped vector diagrams (deduplicating any raster completely covered by a cropped diagram)
  const nonRedundantRaster = pageImages.filter(
    (img) =>
      !diagramImages.some(
        (d) =>
          img.xPt >= d.xPt - 6 &&
          img.yPt >= d.yPt - 6 &&
          img.xPt + img.widthPt <= d.xPt + d.widthPt + 6 &&
          img.yPt + img.heightPt <= d.yPt + d.heightPt + 6
      )
  );
  const combinedImages = [...nonRedundantRaster, ...diagramImages];

  return buildPageDataFromLines(allPageLines, options, {
    pageNumber,
    widthPt,
    heightPt,
    pageImages: combinedImages,
    calloutBlocks,
    vectorTableHints: vectorLayout.tableHints,
    hasDiagramsOrImages: combinedImages.length > 0,
  });
}
