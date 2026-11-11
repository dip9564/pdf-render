import { pdfjsLib } from '@/lib/pdfWorker';
import { PositionedItem } from './types';

export interface HSegment {
  x1: number;
  x2: number;
  y: number;
  lineWidth: number;
  color: string;
}

export interface VSegment {
  x: number;
  y1: number;
  y2: number;
  lineWidth: number;
  color: string;
}

export interface VectorRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  hasFill: boolean;
  hasStroke: boolean;
  fillColor?: string;
  strokeColor?: string;
  lineWidth: number;
}

export interface VectorPrimitive {
  id: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  kind: 'rect' | 'thin-bar' | 'h-line' | 'v-line' | 'diagonal' | 'curve' | 'polygon';
  hasFill: boolean;
  hasStroke: boolean;
  fillColor?: string;
  strokeColor?: string;
  lineWidth: number;
  segmentCount: number;
  hasCurves: boolean;
}

export interface VectorTableHints {
  hSegments: HSegment[];
  vSegments: VSegment[];
  headerBands: { minY: number; maxY: number; minX: number; maxX: number; fillColor: string }[];
  columnSplitHints?: { minY: number; maxY: number; xs: number[] }[];
}

export interface DetectedCalloutBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  backgroundColor: string;
  borderColor: string;
  accentColor?: string;
  itemIndices: number[];
}

export interface DetectedDiagramRegion {
  cropBboxPt: { minX: number; minY: number; maxX: number; maxY: number };
  internalTextBboxPt: { minX: number; minY: number; maxX: number; maxY: number };
  shapeBboxes: { minX: number; minY: number; maxX: number; maxY: number }[];
  yTopPt: number;
  yBottomPt: number;
}

export interface ExtractedVectorLayout {
  tableHints: VectorTableHints;
  callouts: DetectedCalloutBox[];
  diagrams: DetectedDiagramRegion[];
  underlineSegments: HSegment[];
}

function rgbArrayToHex(args: any): string | undefined {
  if (!args) return undefined;
  let r: number;
  let g: number;
  let b: number;
  if (args.length >= 3) {
    r = Number(args[0]);
    g = Number(args[1]);
    b = Number(args[2]);
  } else if (typeof args[0] === 'string' && args[0].startsWith('#')) {
    return args[0].slice(1).toUpperCase().padStart(6, '0').slice(0, 6);
  } else {
    return undefined;
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined;
  if (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b)) {
    if (Math.max(r, g, b) <= 1.001) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    }
  }
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function grayToHex(gVal: any): string | undefined {
  if (gVal === undefined || gVal === null) return undefined;
  const g = Number(Array.isArray(gVal) ? gVal[0] : gVal);
  if (!Number.isFinite(g)) return undefined;
  const v = g <= 1 ? Math.round(g * 255) : Math.round(g);
  const hx = Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0').toUpperCase();
  return `${hx}${hx}${hx}`;
}

function isNearWhite(hex?: string): boolean {
  if (!hex || hex.length < 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r >= 251 && g >= 251 && b >= 251;
}

function applyCtmPoint(ctm: number[], x: number, y: number): [number, number] {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
}

function multiplyCtm(cur: number[], m: number[]): number[] {
  const [c0, c1, c2, c3, c4, c5] = cur;
  const [a, b, c, d, e, f] = m;
  return [
    c0 * a + c2 * b,
    c1 * a + c3 * b,
    c0 * c + c2 * d,
    c1 * c + c3 * d,
    c0 * e + c2 * f + c4,
    c1 * e + c3 * f + c5,
  ];
}

function itemCenter(it: PositionedItem): { cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number } {
  const h = Math.max(
    it.height || 0,
    Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0),
    8
  );
  const w = it.width > 0 ? it.width : Math.max(3, (it.str || '').length * h * 0.48);
  return {
    cx: it.x + w / 2,
    cy: it.y + h * 0.35,
    minX: it.x,
    maxX: it.x + w,
    minY: it.y - h * 0.15,
    maxY: it.y + h * 0.85,
  };
}

function isRectInside(
  inner: { minX: number; maxX: number; minY: number; maxY: number },
  outer: { minX: number; maxX: number; minY: number; maxY: number },
  tol: number = 3
): boolean {
  return (
    inner.minX >= outer.minX - tol &&
    inner.maxX <= outer.maxX + tol &&
    inner.minY >= outer.minY - tol &&
    inner.maxY <= outer.maxY + tol
  );
}

function boxesOverlap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
  pad: number = 0
): boolean {
  return !(
    a.maxX + pad < b.minX ||
    a.minX - pad > b.maxX ||
    a.maxY + pad < b.minY ||
    a.minY - pad > b.maxY
  );
}

/**
 * Extracts PDF vector graphics (table grid rules, shaded panels, callout boxes, diagram clusters)
 * cleanly transformed into page user-space point coordinates matching getTextContent() positions.
 */
export async function extractVectorLayoutHints(
  page: any,
  pageWidthPt: number,
  pageHeightPt: number,
  textItems: PositionedItem[]
): Promise<ExtractedVectorLayout> {
  const hSegments: HSegment[] = [];
  const vSegments: VSegment[] = [];
  const rects: VectorRect[] = [];
  const primitives: VectorPrimitive[] = [];
  const headerBands: { minY: number; maxY: number; minX: number; maxX: number; fillColor: string }[] = [];

  try {
    const operatorList = await page.getOperatorList();
    if (
      operatorList &&
      Array.isArray(operatorList.fnArray) &&
      Array.isArray(operatorList.argsArray)
    ) {
      const { fnArray, argsArray } = operatorList;
      const OPS = pdfjsLib.OPS;

    interface GraphicsState {
      ctm: number[];
      fillColor: string;
      strokeColor: string;
      lineWidth: number;
    }

    let state: GraphicsState = {
      ctm: [1, 0, 0, 1, 0, 0],
      fillColor: '000000',
      strokeColor: '000000',
      lineWidth: 1,
    };
    const stack: GraphicsState[] = [];
    let pendingPath: { ops: number[]; coords: number[]; minMax?: number[] } | null = null;
    let nextPrimId = 1;

    const pushState = () => {
      stack.push({
        ctm: [...state.ctm],
        fillColor: state.fillColor,
        strokeColor: state.strokeColor,
        lineWidth: state.lineWidth,
      });
    };

    const popState = () => {
      if (stack.length > 0) {
        state = stack.pop()!;
      }
    };

    const finalizePath = (hasFill: boolean, hasStroke: boolean) => {
      if (!pendingPath) return;
      const { ops, coords } = pendingPath;
      pendingPath = null;
      if (!hasFill && !hasStroke) return;
      if (!Array.isArray(ops) || !Array.isArray(coords) || ops.length === 0) return;

      // Ignore invisible white strokes or pure white backgrounds without stroke
      if (!hasStroke && hasFill && isNearWhite(state.fillColor)) return;
      if (!hasFill && hasStroke && isNearWhite(state.strokeColor)) return;

      let cIdx = 0;
      let curX = 0;
      let curY = 0;
      let startX = 0;
      let startY = 0;
      const subSegs: { x1: number; y1: number; x2: number; y2: number }[] = [];
      let allPts: [number, number][] = [];
      let hasCurves = false;
      let hasRectOp = false;

      for (const op of ops) {
        if (op === OPS.moveTo && cIdx + 1 < coords.length) {
          const [px, py] = applyCtmPoint(state.ctm, coords[cIdx], coords[cIdx + 1]);
          curX = px;
          curY = py;
          startX = px;
          startY = py;
          allPts.push([px, py]);
          cIdx += 2;
        } else if (op === OPS.lineTo && cIdx + 1 < coords.length) {
          const [px, py] = applyCtmPoint(state.ctm, coords[cIdx], coords[cIdx + 1]);
          subSegs.push({ x1: curX, y1: curY, x2: px, y2: py });
          allPts.push([px, py]);
          curX = px;
          curY = py;
          cIdx += 2;
        } else if (op === OPS.curveTo && cIdx + 5 < coords.length) {
          hasCurves = true;
          const p1 = applyCtmPoint(state.ctm, coords[cIdx], coords[cIdx + 1]);
          const p2 = applyCtmPoint(state.ctm, coords[cIdx + 2], coords[cIdx + 3]);
          const p3 = applyCtmPoint(state.ctm, coords[cIdx + 4], coords[cIdx + 5]);
          allPts.push(p1, p2, p3);
          subSegs.push({ x1: curX, y1: curY, x2: p3[0], y2: p3[1] });
          curX = p3[0];
          curY = p3[1];
          cIdx += 6;
        } else if ((op === OPS.curveTo2 || op === OPS.curveTo3) && cIdx + 3 < coords.length) {
          hasCurves = true;
          const p1 = applyCtmPoint(state.ctm, coords[cIdx], coords[cIdx + 1]);
          const p2 = applyCtmPoint(state.ctm, coords[cIdx + 2], coords[cIdx + 3]);
          allPts.push(p1, p2);
          subSegs.push({ x1: curX, y1: curY, x2: p2[0], y2: p2[1] });
          curX = p2[0];
          curY = p2[1];
          cIdx += 4;
        } else if (op === OPS.closePath) {
          if (Math.hypot(curX - startX, curY - startY) > 0.3) {
            subSegs.push({ x1: curX, y1: curY, x2: startX, y2: startY });
          }
          curX = startX;
          curY = startY;
        } else if (op === OPS.rectangle && cIdx + 3 < coords.length) {
          hasRectOp = true;
          const rx = coords[cIdx];
          const ry = coords[cIdx + 1];
          const rw = coords[cIdx + 2];
          const rh = coords[cIdx + 3];
          const p0 = applyCtmPoint(state.ctm, rx, ry);
          const p1 = applyCtmPoint(state.ctm, rx + rw, ry);
          const p2 = applyCtmPoint(state.ctm, rx + rw, ry + rh);
          const p3 = applyCtmPoint(state.ctm, rx, ry + rh);
          allPts.push(p0, p1, p2, p3);
          subSegs.push(
            { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] },
            { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
            { x1: p2[0], y1: p2[1], x2: p3[0], y2: p3[1] },
            { x1: p3[0], y1: p3[1], x2: p0[0], y2: p0[1] }
          );
          cIdx += 4;
        }
      }

      if (allPts.length === 0) return;

      const xs = allPts.map((p) => p[0]);
      const ys = allPts.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const width = maxX - minX;
      const height = maxY - minY;

      // Ignore full-page frames or background fills
      if (width >= pageWidthPt * 0.90 && height >= pageHeightPt * 0.88) {
        return;
      }

      const scaledLineWidth = Math.max(
        0.3,
        state.lineWidth * Math.max(Math.hypot(state.ctm[0], state.ctm[1]), Math.hypot(state.ctm[2], state.ctm[3]), 1)
      );

      // Extract horizontal / vertical rule segments from strokes AND very thin filled rules
      if (hasFill && !hasCurves) {
        if (height <= 3.0 && width >= 8) {
          hSegments.push({
            x1: minX,
            x2: maxX,
            y: (minY + maxY) / 2,
            lineWidth: Math.max(0.5, height),
            color: state.fillColor,
          });
        } else if (width <= 3.0 && height >= 10) {
          vSegments.push({
            x: (minX + maxX) / 2,
            y1: minY,
            y2: maxY,
            lineWidth: Math.max(0.5, width),
            color: state.fillColor,
          });
        }
      }

      if (hasStroke) {
        for (const s of subSegs) {
          const dx = Math.abs(s.x2 - s.x1);
          const dy = Math.abs(s.y2 - s.y1);
          if (dy <= 1.2 && dx >= 8) {
            hSegments.push({
              x1: Math.min(s.x1, s.x2),
              x2: Math.max(s.x1, s.x2),
              y: (s.y1 + s.y2) / 2,
              lineWidth: scaledLineWidth,
              color: state.strokeColor,
            });
          } else if (dx <= 1.2 && dy >= 10) {
            vSegments.push({
              x: (s.x1 + s.x2) / 2,
              y1: Math.min(s.y1, s.y2),
              y2: Math.max(s.y1, s.y2),
              lineWidth: scaledLineWidth,
              color: state.strokeColor,
            });
          }
        }
      }

      // Check whether path is an axis-aligned rectangle
      const isAxisAlignedRect =
        !hasCurves &&
        (hasRectOp ||
          (subSegs.length >= 3 &&
            subSegs.length <= 5 &&
            allPts.every(
              ([px, py]) =>
                (Math.abs(px - minX) <= 1.5 || Math.abs(px - maxX) <= 1.5) &&
                (Math.abs(py - minY) <= 1.5 || Math.abs(py - maxY) <= 1.5)
            )));

      if (isAxisAlignedRect && width >= 3 && height >= 3) {
        const vr: VectorRect = {
          minX,
          maxX,
          minY,
          maxY,
          width,
          height,
          hasFill,
          hasStroke,
          fillColor: hasFill ? state.fillColor : undefined,
          strokeColor: hasStroke ? state.strokeColor : undefined,
          lineWidth: scaledLineWidth,
        };
        rects.push(vr);

        // Potential table header / row shading strip (wide bar with moderate height)
        if (hasFill && !isNearWhite(state.fillColor) && width >= 120 && height >= 12 && height <= 44) {
          headerBands.push({
            minY,
            maxY,
            minX,
            maxX,
            fillColor: state.fillColor,
          });
        }
      }

      // Record generic primitive for callout/diagram classification
      let kind: VectorPrimitive['kind'] = 'polygon';
      if (isAxisAlignedRect) {
        kind = width <= 10 && height >= 16 ? 'thin-bar' : 'rect';
      } else if (hasCurves) {
        kind = 'curve';
      } else if (subSegs.length === 1) {
        const s = subSegs[0];
        const dx = Math.abs(s.x2 - s.x1);
        const dy = Math.abs(s.y2 - s.y1);
        if (dy <= 1.5 && dx >= 8) kind = 'h-line';
        else if (dx <= 1.5 && dy >= 8) kind = 'v-line';
        else kind = 'diagonal';
      } else if (!hasCurves && width <= 3.0 && height >= 10) {
        kind = 'v-line';
      } else if (!hasCurves && height <= 3.0 && width >= 10) {
        kind = 'h-line';
      }

      if (width >= 2 || height >= 2) {
        primitives.push({
          id: nextPrimId++,
          minX,
          maxX,
          minY,
          maxY,
          width,
          height,
          kind,
          hasFill,
          hasStroke,
          fillColor: hasFill ? state.fillColor : undefined,
          strokeColor: hasStroke ? state.strokeColor : undefined,
          lineWidth: scaledLineWidth,
          segmentCount: subSegs.length,
          hasCurves,
        });
      }
    };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        pushState();
      } else if (fn === OPS.restore) {
        popState();
        pendingPath = null;
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        state.ctm = multiplyCtm(state.ctm, args);
      } else if (fn === OPS.paintFormXObjectBegin) {
        pushState();
        const matrix = Array.isArray(args?.[0]) ? args[0] : null;
        if (matrix && matrix.length >= 6) {
          state.ctm = multiplyCtm(state.ctm, matrix);
        }
      } else if (fn === OPS.paintFormXObjectEnd) {
        popState();
        pendingPath = null;
      } else if (fn === OPS.setFillRGBColor) {
        const hx = rgbArrayToHex(args);
        if (hx) state.fillColor = hx;
      } else if (fn === OPS.setStrokeRGBColor) {
        const hx = rgbArrayToHex(args);
        if (hx) state.strokeColor = hx;
      } else if (fn === OPS.setFillGray) {
        const hx = grayToHex(args);
        if (hx) state.fillColor = hx;
      } else if (fn === OPS.setStrokeGray) {
        const hx = grayToHex(args);
        if (hx) state.strokeColor = hx;
      } else if (fn === OPS.setLineWidth && args && args.length > 0) {
        const lw = Number(args[0]);
        if (Number.isFinite(lw) && lw > 0) state.lineWidth = lw;
      } else if (fn === OPS.constructPath && Array.isArray(args)) {
        pendingPath = { ops: args[0], coords: args[1], minMax: args[2] };
      } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
        finalizePath(false, true);
      } else if (fn === OPS.fill || fn === OPS.eoFill) {
        finalizePath(true, false);
      } else if (
        fn === OPS.fillStroke ||
        fn === OPS.eoFillStroke ||
        fn === OPS.closeFillStroke ||
        fn === OPS.closeEOFillStroke
      ) {
        finalizePath(true, true);
      } else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
        pendingPath = null;
      }
    }
    }
  } catch (err) {
    console.warn('Vector layout extraction warning:', err);
  }

  // Merge collinear touching/overlapping H and V border segments so per-cell rectangles fuse into continuous table grid lines
  const mergeHSegments = (segs: HSegment[]): HSegment[] => {
    const sorted = [...segs].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x1 - b.x1));
    const merged: HSegment[] = [];
    for (const s of sorted) {
      const prev = merged.find(
        (m) => Math.abs(m.y - s.y) <= 2.2 && s.x1 <= m.x2 + 4 && s.x2 >= m.x1 - 4
      );
      if (prev) {
        prev.x1 = Math.min(prev.x1, s.x1);
        prev.x2 = Math.max(prev.x2, s.x2);
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  };
  const mergeVSegments = (segs: VSegment[]): VSegment[] => {
    const sorted = [...segs].sort((a, b) => (Math.abs(a.x - b.x) > 2 ? a.x - b.x : a.y1 - b.y1));
    const merged: VSegment[] = [];
    for (const s of sorted) {
      const prev = merged.find(
        (m) => Math.abs(m.x - s.x) <= 2.2 && s.y1 <= m.y2 + 4 && s.y2 >= m.y1 - 4
      );
      if (prev) {
        prev.y1 = Math.min(prev.y1, s.y1);
        prev.y2 = Math.max(prev.y2, s.y2);
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  };
  const mergedHSegments = mergeHSegments(hSegments);
  const mergedVSegments = mergeVSegments(vSegments);
  hSegments.length = 0;
  hSegments.push(...mergedHSegments);
  vSegments.length = 0;
  vSegments.push(...mergedVSegments);

  // Precompute item centers
  const itemBoxes = textItems.map((it) => ({
    item: it,
    ...itemCenter(it),
  }));

  // ---------------------------------------------------------
  // Step 0: Detect Text Underline Strokes without confusing them with Table Rules or Diagrams
  // ---------------------------------------------------------
  const underlineSegments: HSegment[] = [];
  const underlinePrimitiveIds = new Set<number>();

  for (const h of hSegments) {
    if (h.lineWidth > 2.4) continue;
    const segLen = h.x2 - h.x1;
    if (segLen < 7) continue;

    // Intersects a vertical table border rule -> table rule, not underline
    const crossesVRule = vSegments.some(
      (v) =>
        v.y2 - v.y1 >= 18 &&
        v.x >= h.x1 - 3 &&
        v.x <= h.x2 + 3 &&
        v.y1 <= h.y + 8 &&
        v.y2 >= h.y - 8
    );
    if (crossesVRule) continue;

    // Collect text items whose baseline sits strictly directly above this horizontal stroke
    const aboveMatches = itemBoxes.filter((ib) => {
      const itH = Math.max(
        ib.item.height || 0,
        Math.hypot(ib.item.transform?.[2] || 0, ib.item.transform?.[3] || 0),
        9
      );
      return (
        ib.item.str.trim().length > 0 &&
        h.y <= ib.item.y - 0.15 &&
        h.y >= ib.item.y - Math.max(4.2, itH * 0.38) &&
        h.x2 >= ib.minX + 1 &&
        h.x1 <= ib.maxX - 1
      );
    });
    if (aboveMatches.length === 0) continue;

    // Measure fraction of the horizontal segment covered by text (underlines hug text; table rules span whitespace gutters)
    const sortedIntervals = aboveMatches
      .map((ib) => [Math.max(h.x1, ib.minX), Math.min(h.x2, ib.maxX)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);

    let coveredLen = 0;
    let curA = -Infinity;
    let curB = -Infinity;
    for (const [a, b] of sortedIntervals) {
      if (a <= curB + 2) {
        curB = Math.max(curB, b);
      } else {
        if (curB > curA) coveredLen += curB - curA;
        curA = a;
        curB = b;
      }
    }
    if (curB > curA) coveredLen += curB - curA;

    const coverageRatio = coveredLen / Math.max(1, segLen);
    if (coverageRatio >= 0.62) {
      underlineSegments.push(h);
      for (const p of primitives) {
        if (
          p.kind === 'h-line' &&
          Math.abs(p.minY - h.y) <= 1.8 &&
          p.maxX >= h.x1 - 2 &&
          p.minX <= h.x2 + 2
        ) {
          underlinePrimitiveIds.add(p.id);
        }
      }
    }
  }

  // Filter pure narrow underlines out of table hSegments so they cannot confuse table/callout rule counts
  if (underlineSegments.length > 0) {
    const filteredH = hSegments.filter(
      (h) =>
        !underlineSegments.some(
          (u) =>
            u === h ||
            (Math.abs(u.y - h.y) <= 0.5 &&
              Math.abs(u.x1 - h.x1) <= 1 &&
              Math.abs(u.x2 - h.x2) <= 1 &&
              h.x2 - h.x1 < 180)
        )
    );
    hSegments.length = 0;
    hSegments.push(...filteredH);
  }

  // ---------------------------------------------------------
  // Step 1: Identify contiguous Bordered Table Grids
  // so table cell boxes NEVER turn into Callouts or Diagrams!
  // ---------------------------------------------------------
  const tableGridBoxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];

  // Cluster horizontal and vertical segments sharing X/Y extent that form >= 2 cols & >= 2 rows
  const nonEmptyRects = rects.filter((r) => r.width >= 16 && r.height >= 10 && r.height <= 90);
  // Check adjacent cell rectangles aligned in grid rows/columns
  const visitedRectIdx = new Set<number>();
  for (let i = 0; i < nonEmptyRects.length; i++) {
    if (visitedRectIdx.has(i)) continue;
    const seed = nonEmptyRects[i];
    const cluster = [seed];
    visitedRectIdx.add(i);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let j = 0; j < nonEmptyRects.length; j++) {
        if (visitedRectIdx.has(j)) continue;
        const cand = nonEmptyRects[j];
        if (
          cluster.some(
            (m) =>
              !(
                cand.maxX < m.minX - 4 ||
                cand.minX > m.maxX + 4 ||
                cand.maxY < m.minY - 4 ||
                cand.minY > m.maxY + 4
              )
          )
        ) {
          cluster.push(cand);
          visitedRectIdx.add(j);
          expanded = true;
        }
      }
    }
    if (cluster.length >= 4) {
      const uniqueYs = new Set(cluster.map((r) => Math.round(r.maxY / 6)));
      const uniqueXs = new Set(cluster.map((r) => Math.round(r.minX / 8)));
      if (uniqueYs.size >= 2 && uniqueXs.size >= 2) {
        tableGridBoxes.push({
          minX: Math.min(...cluster.map((r) => r.minX)),
          maxX: Math.max(...cluster.map((r) => r.maxX)),
          minY: Math.min(...cluster.map((r) => r.minY)),
          maxY: Math.max(...cluster.map((r) => r.maxY)),
        });
      }
    }
  }

  // Also register line-intersection grids (e.g. bordered tables drawn purely with H and V lines)
  const vLong = vSegments.filter((v) => Math.abs(v.y2 - v.y1) >= 34);
  const hLong = hSegments.filter((h) => Math.abs(h.x2 - h.x1) >= 80);
  if (hLong.length >= 3 && vLong.length >= 3) {
    // Group touching H/V line networks
    const allSegs = [
      ...hLong.map((h) => ({ minX: h.x1, maxX: h.x2, minY: h.y - 1, maxY: h.y + 1, isH: true })),
      ...vLong.map((v) => ({ minX: v.x - 1, maxX: v.x + 1, minY: v.y1, maxY: v.y2, isH: false })),
    ];
    const used = new Set<number>();
    for (let i = 0; i < allSegs.length; i++) {
      if (used.has(i)) continue;
      const comp = [allSegs[i]];
      used.add(i);
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < allSegs.length; j++) {
          if (used.has(j)) continue;
          if (comp.some((m) => boxesOverlap(m, allSegs[j], 4))) {
            comp.push(allSegs[j]);
            used.add(j);
            changed = true;
          }
        }
      }
      const hc = comp.filter((s) => s.isH);
      const vc = comp.filter((s) => !s.isH);
      const distinctHY = new Set(hc.map((s) => Math.round(s.minY / 6)));
      const distinctVX = new Set(vc.map((s) => Math.round(s.minX / 8)));
      if (distinctHY.size >= 3 && distinctVX.size >= 3) {
        tableGridBoxes.push({
          minX: Math.min(...comp.map((c) => c.minX)),
          maxX: Math.max(...comp.map((c) => c.maxX)),
          minY: Math.min(...comp.map((c) => c.minY)),
          maxY: Math.max(...comp.map((c) => c.maxY)),
        });
      }
    }
  }

  // Also register zebra-striped / horizontal-ruled multi-column tables (stacked wide row bands >= 2 cols)
  const countTabularRowsInBox = (
    box: { minX: number; maxX: number; minY: number; maxY: number },
    minCols: number = 2
  ): number => {
    const coarse = new Map<number, typeof itemBoxes>();
    for (const ib of itemBoxes) {
      if (ib.cx >= box.minX - 4 && ib.cx <= box.maxX + 4 && ib.cy >= box.minY - 6 && ib.cy <= box.maxY + 6) {
        const yB = Math.round(ib.item.y / 6);
        if (!coarse.has(yB)) coarse.set(yB, []);
        coarse.get(yB)!.push(ib);
      }
    }
    let multiCol = 0;
    for (const rowItems of coarse.values()) {
      const sorted = [...rowItems].sort((a, b) => a.minX - b.minX);
      let chunks = 1;
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k].minX - sorted[k - 1].maxX >= 15) chunks++;
      }
      if (chunks >= minCols) multiCol++;
    }
    return multiCol;
  };

  const rowBandRects = rects
    .filter((r) => r.width >= 130 && r.height >= 12 && r.height <= 42)
    .sort((a, b) => b.maxY - a.maxY);
  const visitedRowBands = new Set<number>();
  for (let i = 0; i < rowBandRects.length; i++) {
    if (visitedRowBands.has(i)) continue;
    const seed = rowBandRects[i];
    const stack = [seed];
    visitedRowBands.add(i);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let j = 0; j < rowBandRects.length; j++) {
        if (visitedRowBands.has(j)) continue;
        const cand = rowBandRects[j];
        if (
          Math.abs(cand.minX - seed.minX) <= 14 &&
          Math.abs(cand.maxX - seed.maxX) <= 14 &&
          stack.some((m) => Math.abs(m.minY - cand.maxY) <= 45 || Math.abs(cand.minY - m.maxY) <= 45)
        ) {
          stack.push(cand);
          visitedRowBands.add(j);
          expanded = true;
        }
      }
    }
    if (stack.length >= 2) {
      const bandBox = {
        minX: Math.min(...stack.map((r) => r.minX)),
        maxX: Math.max(...stack.map((r) => r.maxX)),
        minY: Math.min(...stack.map((r) => r.minY)),
        maxY: Math.max(...stack.map((r) => r.maxY)),
      };
      if (countTabularRowsInBox(bandBox, 2) >= 2) {
        tableGridBoxes.push(bandBox);
      }
    }
  }

  // ---------------------------------------------------------
  // Step 2: Detect Styled Callout Boxes (background/border/accent + prose text)
  // ---------------------------------------------------------
  const consumedPrimitiveIds = new Set<number>();
  const callouts: DetectedCalloutBox[] = [];

  // Sort candidate wide rectangles largest height first so nested inner header strips stay inside parent
  const calloutRectPrims = primitives
    .filter(
      (p) =>
        (p.kind === 'rect' || (p.kind === 'curve' && p.segmentCount >= 4)) &&
        p.width >= Math.min(200, pageWidthPt * 0.36) &&
        p.width <= pageWidthPt * 0.94 &&
        p.height >= 26 &&
        p.height <= pageHeightPt * 0.62 &&
        ((p.hasFill && !isNearWhite(p.fillColor)) || p.hasStroke)
    )
    .sort((a, b) => b.width * b.height - a.width * a.height);

  for (const box of calloutRectPrims) {
    if (consumedPrimitiveIds.has(box.id)) continue;

    // Must not overlap an identified multi-column bordered table grid
    if (tableGridBoxes.some((tg) => boxesOverlap(box, tg, -2))) {
      continue;
    }

    // Check internal vertical dividers inside this panel (if >= 2 columns exist, it's a table box)
    const internalVDividers = vSegments.filter(
      (v) =>
        v.x > box.minX + 12 &&
        v.x < box.maxX - 12 &&
        Math.min(v.y2, box.maxY) - Math.max(v.y1, box.minY) >= box.height * 0.45
    );
    if (internalVDividers.length >= 1) continue;

    // Check for an adjacent thin vertical left accent bar (e.g. blue 3-6pt strip on left edge of callout)
    const accentPrim = primitives.find(
      (p) =>
        !consumedPrimitiveIds.has(p.id) &&
        p.id !== box.id &&
        p.kind === 'thin-bar' &&
        p.height >= box.height * 0.72 &&
        Math.abs(p.minY - box.minY) <= box.height * 0.18 &&
        p.maxX >= box.minX - 6 &&
        p.minX <= box.minX + 12
    );

    // Check text items inside this callout box
    const enclosedIndices: number[] = [];
    let totalChars = 0;
    let monoChars = 0;
    const coarseRows = new Map<number, typeof itemBoxes>();

    for (let idx = 0; idx < itemBoxes.length; idx++) {
      const ib = itemBoxes[idx];
      if (
        ib.cx >= box.minX - 3 &&
        ib.cx <= box.maxX + 3 &&
        ib.cy >= box.minY - 4 &&
        ib.cy <= box.maxY + 4
      ) {
        enclosedIndices.push(idx);
        const len = ib.item.str.trim().length;
        totalChars += len;
        const fn = `${ib.item.fontName || ''} ${ib.item.resolvedFontName || ''}`.toLowerCase();
        if (ib.item.isMonospaceFlag || fn.includes('consolas') || fn.includes('courier') || fn.includes('mono')) {
          monoChars += len;
        }
        const yBucket = Math.round(ib.item.y / 6);
        if (!coarseRows.has(yBucket)) coarseRows.set(yBucket, []);
        coarseRows.get(yBucket)!.push(ib);
      }
    }

    if (enclosedIndices.length === 0 || totalChars < 6) continue;

    // Guard 1: Keep shaded monospace CODE BLOCKS handled by codeDetector (never swallow into a callout)
    if (totalChars > 0 && monoChars / totalChars >= 0.65) {
      continue;
    }

    // Guard 2: Do not classify a shaded diagram container that holds other nested boxes/arrows inside as a callout!
    const nestedBoxesInside = primitives.filter(
      (p) =>
        p.id !== box.id &&
        p.id !== accentPrim?.id &&
        (p.kind === 'rect' || p.kind === 'diagonal' || p.kind === 'curve' || p.kind === 'polygon') &&
        p.width >= 14 &&
        p.height >= 12 &&
        isRectInside(p, box, 2) &&
        p.width * p.height < box.width * box.height * 0.72
    );
    if (nestedBoxesInside.length >= 2) {
      continue;
    }

    // Guard 3: Ensure interior rows aren't an aligned multi-column table (3+ chunks/row, OR 2+ chunks/row with internal horizontal grid rules)
    const internalHRulesCount = hSegments.filter(
      (h) =>
        h.y > box.minY + 4 &&
        h.y < box.maxY - 4 &&
        h.x1 <= box.maxX &&
        h.x2 >= box.minX &&
        h.x2 - h.x1 >= box.width * 0.5
    ).length;

    let threeColRows = 0;
    let twoPlusColRows = 0;
    for (const rowItems of coarseRows.values()) {
      const sorted = [...rowItems].sort((a, b) => a.minX - b.minX);
      let chunkCount = 1;
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k].minX - sorted[k - 1].maxX >= 16) chunkCount++;
      }
      if (chunkCount >= 3) threeColRows++;
      if (chunkCount >= 2) twoPlusColRows++;
    }
    if (threeColRows >= 2 || (internalHRulesCount >= 2 && twoPlusColRows >= 2)) continue;

    // Also avoid turning a single isolated shaded table header strip (<= 34pt height) into a callout when tabular data rows sit directly beneath it
    if (box.height <= 36 && twoPlusColRows >= 1) {
      const belowRows = new Map<number, typeof itemBoxes>();
      for (const ib of itemBoxes) {
        if (ib.cx >= box.minX - 6 && ib.cx <= box.maxX + 6 && ib.cy < box.minY && ib.cy >= box.minY - 75) {
          const yB = Math.round(ib.item.y / 6);
          if (!belowRows.has(yB)) belowRows.set(yB, []);
          belowRows.get(yB)!.push(ib);
        }
      }
      let tabularBelow = 0;
      for (const rowItems of belowRows.values()) {
        const sorted = [...rowItems].sort((a, b) => a.minX - b.minX);
        let chunks = 1;
        for (let k = 1; k < sorted.length; k++) {
          if (sorted[k].minX - sorted[k - 1].maxX >= 16) chunks++;
        }
        if (chunks >= 2) tabularBelow++;
      }
      if (tabularBelow >= 2) continue;
    }

    // Guard 4: Protect nested boxes inside outer diagram containers OR boxes attached to external diagram arrows/connectors
    const insideLargerDiagramFrame = primitives.some(
      (p) =>
        p.id !== box.id &&
        p.id !== accentPrim?.id &&
        !consumedPrimitiveIds.has(p.id) &&
        (p.kind === 'rect' || p.kind === 'curve' || p.kind === 'polygon') &&
        p.width > box.width + 12 &&
        p.height > box.height + 12 &&
        isRectInside(box, p, 3)
    );
    if (insideLargerDiagramFrame) continue;

    const hasExternalConnector = primitives.some(
      (conn) =>
        conn.id !== box.id &&
        conn.id !== accentPrim?.id &&
        !consumedPrimitiveIds.has(conn.id) &&
        !underlinePrimitiveIds.has(conn.id) &&
        (conn.kind === 'h-line' ||
          conn.kind === 'v-line' ||
          conn.kind === 'diagonal' ||
          conn.kind === 'curve') &&
        boxesOverlap(box, conn, 10) &&
        !isRectInside(conn, box, -2)
    );
    if (hasExternalConnector) continue;

    // Guard 5: Protect aligned sibling architecture block groups (e.g. stacked tier boxes or peer modules without left accent strip)
    if (!accentPrim) {
      const boxText = enclosedIndices.map((idx) => itemBoxes[idx].item.str).join(' ').trim();
      const boxIsConciseBlockLabel = boxText.length <= 54 && !/[.!?]\s+[A-Z]/.test(boxText);
      const siblingBlocks = primitives.filter((p) => {
        if (
          p.id === box.id ||
          consumedPrimitiveIds.has(p.id) ||
          (p.kind !== 'rect' && p.kind !== 'curve' && p.kind !== 'polygon') ||
          p.width < 24 ||
          p.height < 16 ||
          tableGridBoxes.some((tg) => boxesOverlap(p, tg, -2))
        ) {
          return false;
        }
        const heightRatio =
          Math.max(p.height, box.height) / Math.max(1, Math.min(p.height, box.height));
        if (heightRatio > 1.75) return false;

        // Vertically stacked aligned architecture tier
        const xAlignOverlap =
          Math.min(p.maxX, box.maxX) - Math.max(p.minX, box.minX) >=
          Math.min(p.width, box.width) * 0.55;
        const vGap =
          p.minY > box.maxY ? p.minY - box.maxY : box.minY > p.maxY ? box.minY - p.maxY : 0;
        if (xAlignOverlap && vGap > 0 && vGap <= 62 && Math.abs(p.width - box.width) <= 60) {
          return true;
        }

        // Side-by-side peer architecture module
        const yOverlap =
          Math.min(p.maxY, box.maxY) - Math.max(p.minY, box.minY) >=
          Math.min(p.height, box.height) * 0.55;
        const hGap =
          p.minX > box.maxX ? p.minX - box.maxX : box.minX > p.maxX ? box.minX - p.maxX : 0;
        return yOverlap && hGap > 0 && hGap <= 85;
      });
      if (siblingBlocks.length >= 2 || (siblingBlocks.length >= 1 && boxIsConciseBlockLabel)) {
        continue;
      }
    }

    // Confirmed Callout Box! Mark parent, accent bar, and contained rules/header strips consumed
    consumedPrimitiveIds.add(box.id);
    if (accentPrim) consumedPrimitiveIds.add(accentPrim.id);
    for (const p of primitives) {
      if (
        !consumedPrimitiveIds.has(p.id) &&
        p.id !== box.id &&
        isRectInside(p, box, 2) &&
        (p.kind === 'h-line' || p.kind === 'v-line' || (p.kind === 'rect' && p.width >= box.width * 0.7))
      ) {
        consumedPrimitiveIds.add(p.id);
      }
    }

    const bgColor = box.fillColor && !isNearWhite(box.fillColor) ? box.fillColor : 'F8FAFC';
    const borderColor = box.strokeColor && !isNearWhite(box.strokeColor) ? box.strokeColor : 'CBD5E1';
    const accentColor = accentPrim?.fillColor && !isNearWhite(accentPrim.fillColor)
      ? accentPrim.fillColor
      : box.strokeColor && !isNearWhite(box.strokeColor)
      ? box.strokeColor
      : '3B82F6';

    callouts.push({
      minX: Math.min(box.minX, accentPrim ? accentPrim.minX : box.minX),
      maxX: box.maxX,
      minY: box.minY,
      maxY: box.maxY,
      backgroundColor: bgColor,
      borderColor,
      accentColor,
      itemIndices: enclosedIndices,
    });
  }

  // ---------------------------------------------------------
  // Step 3: Detect Architecture Diagrams / Vector Graphics Clusters
  // ---------------------------------------------------------
  // Remaining vector primitives excluding:
  // - consumed callouts & underline strokes
  // - bordered table grids
  // - isolated page-wide thin horizontal rules (section dividers / header rules)
  const diagramCandidates = primitives.filter((p) => {
    if (consumedPrimitiveIds.has(p.id)) return false;
    if (underlinePrimitiveIds.has(p.id)) return false;
    if (tableGridBoxes.some((tg) => boxesOverlap(p, tg, 2))) return false;
    // Exclude tiny dots or invisible hairline artifacts
    if (p.width < 3 && p.height < 3) return false;
    // Exclude isolated page-wide horizontal divider lines & bottom/top running lines
    if (p.kind === 'h-line' && (p.width >= pageWidthPt * 0.52 || p.minY > pageHeightPt - 55 || p.maxY < 58)) {
      return false;
    }
    return true;
  });

  // Helper: check if two peer diagram shapes should chain across slightly wider layout gaps (architecture blocks without arrows)
  const isDiagramShape = (p: VectorPrimitive) =>
    (p.kind === 'rect' || p.kind === 'curve' || p.kind === 'polygon') &&
    p.width >= 20 &&
    p.height >= 16;

  const hasInterveningUnboxedText = (a: VectorPrimitive, b: VectorPrimitive): boolean => {
    const loY = Math.min(a.maxY, b.maxY);
    const hiY = Math.max(a.minY, b.minY);
    if (hiY - loY < 10) return false;
    const minXSpan = Math.min(a.minX, b.minX) - 6;
    const maxXSpan = Math.max(a.maxX, b.maxX) + 6;
    return itemBoxes.some((ib) => {
      if (!ib.item.str.trim()) return false;
      if (ib.cy <= loY + 2 || ib.cy >= hiY - 2) return false;
      if (ib.maxX < minXSpan || ib.minX > maxXSpan) return false;
      // Ignore small connector labels (<= 18 chars) sitting beside arrows
      const txt = ib.item.str.trim();
      const insideSomeShape = diagramCandidates.some(
        (s) => isDiagramShape(s) && ib.cx >= s.minX - 2 && ib.cx <= s.maxX + 2 && ib.cy >= s.minY - 2 && ib.cy <= s.maxY + 2
      );
      return !insideSomeShape && txt.length >= 20;
    });
  };

  // Cluster spatial neighbors within 22pt OR aligned peer architecture blocks
  const clusterVisited = new Set<number>();
  const diagrams: DetectedDiagramRegion[] = [];

  for (let i = 0; i < diagramCandidates.length; i++) {
    if (clusterVisited.has(i)) continue;
    const cluster = [diagramCandidates[i]];
    clusterVisited.add(i);

    let grown = true;
    while (grown) {
      grown = false;
      for (let j = 0; j < diagramCandidates.length; j++) {
        if (clusterVisited.has(j)) continue;
        const cand = diagramCandidates[j];
        const nearCluster = cluster.some((m) => {
          if (boxesOverlap(m, cand, 22)) return true;
          if (!isDiagramShape(m) || !isDiagramShape(cand)) return false;
          const heightRatio =
            Math.max(m.height, cand.height) / Math.max(1, Math.min(m.height, cand.height));
          if (heightRatio > 1.75) return false;

          // Horizontally aligned architecture blocks (e.g. 3 side-by-side blocks within 85pt gap)
          const yOverlap =
            Math.min(m.maxY, cand.maxY) - Math.max(m.minY, cand.minY) >=
            Math.min(m.height, cand.height) * 0.5;
          const hGap =
            m.minX > cand.maxX ? m.minX - cand.maxX : cand.minX > m.maxX ? cand.minX - m.maxX : 0;
          if (yOverlap && hGap <= 85) return true;

          // Vertically stacked aligned architecture tier blocks within 52pt gap without body prose between
          const xOverlap =
            Math.min(m.maxX, cand.maxX) - Math.max(m.minX, cand.minX) >=
            Math.min(m.width, cand.width) * 0.5;
          const vGap =
            m.minY > cand.maxY ? m.minY - cand.maxY : cand.minY > m.maxY ? cand.minY - m.maxY : 0;
          if (xOverlap && vGap <= 52 && !hasInterveningUnboxedText(m, cand)) return true;

          return false;
        });

        if (nearCluster) {
          cluster.push(cand);
          clusterVisited.add(j);
          grown = true;
        }
      }
    }

    if (cluster.length < 2) continue;

    const minX = Math.min(...cluster.map((p) => p.minX));
    const maxX = Math.max(...cluster.map((p) => p.maxX));
    const minY = Math.min(...cluster.map((p) => p.minY));
    const maxY = Math.max(...cluster.map((p) => p.maxY));
    const width = maxX - minX;
    const height = maxY - minY;

    if (width < 55 || height < 36) continue;
    if (width >= pageWidthPt * 0.90 && height >= pageHeightPt * 0.85) continue;

    const shapes = cluster.filter(
      (p) =>
        (p.kind === 'rect' || p.kind === 'curve' || p.kind === 'polygon') &&
        p.width >= 14 &&
        p.height >= 12
    );
    const connectorsOrDiags = cluster.filter(
      (p) => p.kind === 'h-line' || p.kind === 'v-line' || p.kind === 'diagonal' || p.hasCurves
    );

    const hasDiagramTopology =
      shapes.length >= 2 ||
      (shapes.length >= 1 && connectorsOrDiags.length >= 2) ||
      (cluster.length >= 4 && connectorsOrDiags.length >= 3);

    if (!hasDiagramTopology) continue;

    // Ensure cluster isn't actually a lightly bordered / unmerged text table (e.g. 2 rows of multi-col lines without shapes/connectors)
    if (shapes.length === 0 && connectorsOrDiags.every((c) => c.kind === 'h-line' || c.kind === 'v-line')) {
      const innerRows = new Map<number, typeof itemBoxes>();
      for (const ib of itemBoxes) {
        if (ib.cx >= minX - 2 && ib.cx <= maxX + 2 && ib.cy >= minY - 2 && ib.cy <= maxY + 2) {
          const yKey = Math.round(ib.item.y / 6);
          if (!innerRows.has(yKey)) innerRows.set(yKey, []);
          innerRows.get(yKey)!.push(ib);
        }
      }
      let tabularCount = 0;
      for (const rowItems of innerRows.values()) {
        const sorted = [...rowItems].sort((a, b) => a.minX - b.minX);
        let chunkCount = 1;
        for (let k = 1; k < sorted.length; k++) {
          if (sorted[k].minX - sorted[k - 1].maxX >= 16) chunkCount++;
        }
        if (chunkCount >= 2) tabularCount++;
      }
      if (tabularCount >= 2) continue;
    }

    // Clamp crop padding carefully so external Figure captions & section headings NEVER merge into diagram image
    let topPad = 8;
    let bottomPad = 8;
    for (const ib of itemBoxes) {
      if (ib.maxX >= minX - 18 && ib.minX <= maxX + 18) {
        if (ib.minY >= maxY + 1) {
          const distAbove = ib.minY - maxY;
          if (distAbove < topPad + 2) topPad = Math.max(0.5, distAbove - 1.5);
        }
        if (ib.maxY <= minY - 1) {
          const distBelow = minY - ib.maxY;
          if (distBelow < bottomPad + 2) bottomPad = Math.max(0.5, distBelow - 1.5);
        }
      }
    }

    const cropBboxPt = {
      minX: Math.max(0, minX - 8),
      minY: Math.max(0, minY - bottomPad),
      maxX: Math.min(pageWidthPt, maxX + 8),
      maxY: Math.min(pageHeightPt, maxY + topPad),
    };

    const internalTextBboxPt = {
      minX: minX - 4,
      minY: minY - 0.5,
      maxX: maxX + 4,
      maxY: maxY + 0.5,
    };

    diagrams.push({
      cropBboxPt,
      internalTextBboxPt,
      shapeBboxes: shapes.map((s) => ({
        minX: s.minX,
        minY: s.minY,
        maxX: s.maxX,
        maxY: s.maxY,
      })),
      yTopPt: cropBboxPt.maxY,
      yBottomPt: cropBboxPt.minY,
    });
  }

  return {
    tableHints: {
      hSegments,
      vSegments,
      headerBands,
    },
    callouts,
    diagrams,
    underlineSegments,
  };
}
