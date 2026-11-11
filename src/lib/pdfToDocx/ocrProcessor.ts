import {
  ConversionOptions,
  ExtractedPageData,
  PositionedItem,
} from './types';
import { VectorTableHints, HSegment, VSegment } from './vectorExtractor';
import { buildPageDataFromLines, groupItemsIntoLines } from './layoutAnalyzer';

export interface OcrWordInput {
  text: string;
  confidence: number;
  minSymbolConfidence?: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baselineY?: number;
  rowHeightPx?: number;
  isBold?: boolean;
  paragraphId?: number;
  scriptType?: 'super' | 'sub';
}

export interface DetectedPixelTableGrid {
  minXPx: number;
  maxXPx: number;
  minYPx: number;
  maxYPx: number;
  colXsPx: number[];
  rowYsPx: number[];
}

export interface PixelGridAnalysisResult {
  cleanedGray: Uint8Array;
  tableHints: VectorTableHints;
  tables: DetectedPixelTableGrid[];
}

/**
 * Normalizes illumination, removes light background shading / scan shadows,
 * auto-inverts dark top title banners, stretches contrast [2%..98%],
 * and applies mild unsharp masking without destructive hard binarization.
 */
export function preprocessImageBuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const n = width * height;
  const lum = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const off = i * 4;
    // Standard perceptual luminance preserves colored blue/red ink contrast vs pale tint
    lum[i] = Math.min(
      255,
      Math.max(0, Math.round(0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2]))
    );
  }

  // Step 1: Detect dark-background inverted top header/title banners (top ~28% of page)
  const topLimit = Math.floor(height * 0.28);
  let bandStart = -1;
  for (let y = 0; y < topLimit; y++) {
    let darkCount = 0;
    let brightCount = 0;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const v = lum[rowOff + x];
      if (v < 110) darkCount++;
      else if (v > 185) brightCount++;
    }
    const isDarkRow = darkCount > width * 0.24 && brightCount < width * 0.78;
    if (isDarkRow && bandStart === -1) {
      bandStart = y;
    }
    const atEnd = y === topLimit - 1;
    if ((!isDarkRow || atEnd) && bandStart !== -1) {
      const bandEnd = isDarkRow && atEnd ? y + 1 : y;
      if (bandEnd - bandStart >= 18) {
        // Find horizontal span of dark banner
        let bx0 = width;
        let bx1 = 0;
        for (let yy = bandStart; yy < bandEnd; yy++) {
          const rOff = yy * width;
          for (let xx = 0; xx < width; xx++) {
            if (lum[rOff + xx] < 115) {
              if (xx < bx0) bx0 = xx;
              if (xx > bx1) bx1 = xx;
            }
          }
        }
        if (bx1 - bx0 >= width * 0.25) {
          let innerBright = 0;
          let totalBox = 0;
          for (let yy = bandStart; yy < bandEnd; yy++) {
            const rOff = yy * width;
            for (let xx = bx0; xx <= bx1; xx++) {
              totalBox++;
              if (lum[rOff + xx] > 180) innerBright++;
            }
          }
          // Invert only if light text sits on dark banner (>=0.8% bright glyph pixels)
          if (totalBox > 0 && innerBright / totalBox >= 0.008 && innerBright / totalBox <= 0.65) {
            for (let yy = bandStart; yy < bandEnd; yy++) {
              const rOff = yy * width;
              for (let xx = bx0; xx <= bx1; xx++) {
                lum[rOff + xx] = 255 - lum[rOff + xx];
              }
            }
          }
        }
      }
      bandStart = -1;
    }
  }

  // Step 2: Fast coarse block local-background estimation (24px tiles -> 85th percentile background)
  const blockSize = Math.max(16, Math.min(32, Math.round(width / 80)));
  const gxCount = Math.max(1, Math.ceil(width / blockSize));
  const gyCount = Math.max(1, Math.ceil(height / blockSize));
  const bgGrid = new Float32Array(gxCount * gyCount);
  const blockHistogram = new Uint16Array(256);

  for (let by = 0; by < gyCount; by++) {
    const y0 = by * blockSize;
    const y1 = Math.min(height, y0 + blockSize);
    for (let bx = 0; bx < gxCount; bx++) {
      const x0 = bx * blockSize;
      const x1 = Math.min(width, x0 + blockSize);
      blockHistogram.fill(0);
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        const rOff = y * width;
        for (let x = x0; x < x1; x += 2) {
          blockHistogram[lum[rOff + x]]++;
          count++;
        }
      }
      const targetRank = Math.max(1, Math.floor(count * 0.85));
      let acc = 0;
      let p85 = 245;
      for (let v = 0; v < 256; v++) {
        acc += blockHistogram[v];
        if (acc >= targetRank) {
          p85 = v;
          break;
        }
      }
      bgGrid[by * gxCount + bx] = Math.max(135, p85);
    }
  }

  // Lightly max-smooth bgGrid so thin dark boxes don't distort paper background
  const smoothBg = new Float32Array(bgGrid.length);
  for (let by = 0; by < gyCount; by++) {
    for (let bx = 0; bx < gxCount; bx++) {
      let mx = bgGrid[by * gxCount + bx];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = by + dy;
        if (ny < 0 || ny >= gyCount) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          if (nx < 0 || nx >= gxCount) continue;
          const nbVal = bgGrid[ny * gxCount + nx];
          if (nbVal > mx) mx = nbVal * 0.65 + mx * 0.35;
        }
      }
      smoothBg[by * gxCount + bx] = mx;
    }
  }

  // Normalize pixels against bilinear local background illumination
  const norm = new Uint8Array(n);
  const hist = new Uint32Array(256);

  for (let y = 0; y < height; y++) {
    const gyf = (y + 0.5) / blockSize - 0.5;
    const gy0 = Math.max(0, Math.min(gyCount - 1, Math.floor(gyf)));
    const gy1 = Math.min(gyCount - 1, gy0 + 1);
    const wy = Math.max(0, Math.min(1, gyf - gy0));
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const gxf = (x + 0.5) / blockSize - 0.5;
      const gx0 = Math.max(0, Math.min(gxCount - 1, Math.floor(gxf)));
      const gx1 = Math.min(gxCount - 1, gx0 + 1);
      const wx = Math.max(0, Math.min(1, gxf - gx0));

      const b00 = smoothBg[gy0 * gxCount + gx0];
      const b10 = smoothBg[gy0 * gxCount + gx1];
      const b01 = smoothBg[gy1 * gxCount + gx0];
      const b11 = smoothBg[gy1 * gxCount + gx1];
      const localBg =
        (b00 * (1 - wx) + b10 * wx) * (1 - wy) +
        (b01 * (1 - wx) + b11 * wx) * wy;

      const idx = rowOff + x;
      const nv = Math.min(255, Math.max(0, Math.round((lum[idx] / Math.max(100, localBg)) * 250)));
      norm[idx] = nv;
      if ((y & 1) === 0 && (x & 1) === 0) hist[nv]++;
    }
  }

  // Step 3: Stretch black point without crushing soft anti-aliasing
  let totalSampled = 0;
  for (let v = 0; v < 256; v++) totalSampled += hist[v];
  let darkAcc = 0;
  let blackPoint = 0;
  const darkTarget = Math.max(1, Math.round(totalSampled * 0.005));
  for (let v = 0; v < 140; v++) {
    darkAcc += hist[v];
    if (darkAcc >= darkTarget) {
      blackPoint = Math.min(85, Math.max(0, v - 8));
      break;
    }
  }
  const whitePoint = 238;
  const range = Math.max(80, whitePoint - blackPoint);

  const stretched = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = (norm[i] - blackPoint) / range;
    if (t <= 0) stretched[i] = 0;
    else if (t >= 1) stretched[i] = 255;
    else stretched[i] = Math.round((t < 0.72 ? Math.pow(t, 1.05) : Math.pow(t, 0.92)) * 255);
  }

  // Step 4: Gentle 3x3 unsharp mask to sharpen thin strokes (₹ bars, α/β curves, punctuation) without haloing clean paper
  const sharpened = new Uint8Array(stretched);
  for (let y = 1; y < height - 1; y++) {
    const r = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = r + x;
      const c = stretched[idx];
      if (c >= 238) continue;
      const orthoAvg =
        (stretched[idx - 1] + stretched[idx + 1] + stretched[idx - width] + stretched[idx + width]) *
        0.25;
      const val = c + 0.42 * (c - orthoAvg);
      sharpened[idx] = val <= 0 ? 0 : val >= 255 ? 255 : Math.round(val);
    }
  }

  return sharpened;
}

/**
 * Estimates page skew angle in degrees over [-6°, +6°] using horizontal ink projection gradient energy.
 * Positive returned angle means lines slope downward to the right; rotate canvas by -angle to deskew.
 */
export function detectSkewAngleDeg(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  const strideX = Math.max(1, Math.floor(width / 460));
  const strideY = Math.max(1, Math.floor(height / 600));
  const halfW = width / 2;
  const halfH = height / 2;

  const inkX: number[] = [];
  const inkY: number[] = [];
  for (let y = Math.floor(height * 0.04); y < Math.floor(height * 0.96); y += strideY) {
    const rowOff = y * width;
    for (let x = Math.floor(width * 0.04); x < Math.floor(width * 0.96); x += strideX) {
      if (gray[rowOff + x] < 165) {
        inkX.push((x - halfW) / strideY);
        inkY.push((y - halfH) / strideY);
      }
    }
  }

  if (inkX.length < 150) return 0;

  const projH = Math.ceil(height / strideY) + 120;
  const offset = 60;
  const hist = new Int32Array(projH);

  const scoreAngle = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    hist.fill(0);

    for (let i = 0; i < inkX.length; i++) {
      const ry = Math.round(-inkX[i] * sin + inkY[i] * cos + halfH / strideY) + offset;
      if (ry >= 1 && ry < projH - 1) {
        hist[ry]++;
      }
    }

    let gradEnergy = 0;
    let sumSq = 0;
    for (let r = 1; r < projH; r++) {
      const diff = hist[r] - hist[r - 1];
      gradEnergy += diff * diff;
      sumSq += hist[r] * hist[r];
    }
    return gradEnergy * 0.7 + sumSq * 0.3;
  };

  let bestAngle = 0;
  let bestScore = -1;
  for (let a = -6.0; a <= 6.001; a += 0.4) {
    const s = scoreAngle(a);
    if (s > bestScore) {
      bestScore = s;
      bestAngle = a;
    }
  }

  let fineBest = bestAngle;
  let fineScore = bestScore;
  for (let a = bestAngle - 0.5; a <= bestAngle + 0.501; a += 0.1) {
    const s = scoreAngle(a);
    if (s > fineScore) {
      fineScore = s;
      fineBest = a;
    }
  }

  return Math.abs(fineBest) >= 0.25 ? Math.round(fineBest * 10) / 10 : 0;
}

/**
 * Detects straight horizontal/vertical table rules directly on the deskewed grayscale bitmap,
 * builds VectorTableHints for tableDetector.ts, AND erases border pixels safely from a copy for OCR
 * so vertical borders touching narrow glyphs (like "1" or "₹") never fuse into "Aq" or garbage.
 */
export function detectBitmapTableGridAndRemoveRules(
  gray: Uint8Array,
  width: number,
  height: number,
  scale: number,
  pageHeightPt: number
): PixelGridAnalysisResult {
  const cleanedGray = new Uint8Array(gray);
  // Tolerate anti-aliased and scanned gray grid rules up to ~185 luminance on Tier A
  const inkThresh = 185;

  interface RawSeg {
    pos: number;
    start: number;
    end: number;
    inkLen: number;
  }

  const rawH: RawSeg[] = [];
  const captureMinHLen = Math.max(48, Math.round(width * 0.05));
  const finalMinHLen = Math.max(75, Math.round(width * 0.12));

  for (let y = 2; y < height - 2; y++) {
    const rowOff = y * width;
    let runStart = -1;
    let gapCount = 0;
    for (let x = 0; x < width; x++) {
      if (gray[rowOff + x] < inkThresh) {
        if (runStart === -1) runStart = x;
        gapCount = 0;
      } else if (runStart !== -1) {
        gapCount++;
        if (gapCount > 1) {
          const end = x - gapCount;
          if (end - runStart + 1 >= captureMinHLen) {
            rawH.push({ pos: y, start: runStart, end, inkLen: end - runStart + 1 });
          }
          runStart = -1;
          gapCount = 0;
        }
      }
    }
    if (runStart !== -1) {
      const end = width - 1 - gapCount;
      if (end - runStart + 1 >= captureMinHLen) {
        rawH.push({ pos: y, start: runStart, end, inkLen: end - runStart + 1 });
      }
    }
  }

  const rawV: RawSeg[] = [];
  const captureMinVLen = Math.max(24, Math.round(height * 0.015));
  const finalMinVLen = Math.max(48, Math.round(height * 0.045));

  for (let x = 2; x < width - 2; x++) {
    let runStart = -1;
    let gapCount = 0;
    for (let y = 0; y < height; y++) {
      if (gray[y * width + x] < inkThresh) {
        if (runStart === -1) runStart = y;
        gapCount = 0;
      } else if (runStart !== -1) {
        gapCount++;
        if (gapCount > 1) {
          const end = y - gapCount;
          if (end - runStart + 1 >= captureMinVLen) {
            rawV.push({ pos: x, start: runStart, end, inkLen: end - runStart + 1 });
          }
          runStart = -1;
          gapCount = 0;
        }
      }
    }
    if (runStart !== -1) {
      const end = height - 1 - gapCount;
      if (end - runStart + 1 >= captureMinVLen) {
        rawV.push({ pos: x, start: runStart, end, inkLen: end - runStart + 1 });
      }
    }
  }

  interface ClusteredLine {
    pos: number;
    pos0: number;
    pos1: number;
    start: number;
    end: number;
    intervals: [number, number][];
  }

  const computeIntervalCoverage = (intervals: [number, number][]): number => {
    if (intervals.length === 0) return 0;
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    let cov = 0;
    let ca = sorted[0][0];
    let cb = sorted[0][1];
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k][0] <= cb + 3) {
        cb = Math.max(cb, sorted[k][1]);
      } else {
        cov += cb - ca + 1;
        ca = sorted[k][0];
        cb = sorted[k][1];
      }
    }
    cov += cb - ca + 1;
    return cov;
  };

  const clusterSegs = (
    segs: RawSeg[],
    minFinalLen: number,
    maxThickness: number = 9,
    collinearGapTol: number = 22
  ): ClusteredLine[] => {
    const sortedSegs = [...segs].sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.start - b.start));
    const out: ClusteredLine[] = [];
    for (const s of sortedSegs) {
      // Accumulate contiguous overlapping thickness BEFORE filtering maxThickness so thick bars/text blocks
      // do not slice into stacked fake thin borders.
      const prev = out.find((c) => {
        const overlapsSpan = Math.min(s.end, c.end) - Math.max(s.start, c.start) >= 8;
        if (s.pos <= c.pos1 + 1 && overlapsSpan) return true;
        const isCollinear = !(s.end < c.start - collinearGapTol || s.start > c.end + collinearGapTol);
        return isCollinear && Math.abs(s.pos - c.pos1) <= 2 && c.pos1 - c.pos0 <= 4;
      });
      if (prev) {
        prev.pos0 = Math.min(prev.pos0, s.pos);
        prev.pos1 = Math.max(prev.pos1, s.pos);
        prev.pos = (prev.pos0 + prev.pos1) / 2;
        prev.start = Math.min(prev.start, s.start);
        prev.end = Math.max(prev.end, s.end);
        prev.intervals.push([s.start, s.end]);
      } else {
        out.push({
          pos: s.pos,
          pos0: s.pos,
          pos1: s.pos,
          start: s.start,
          end: s.end,
          intervals: [[s.start, s.end]],
        });
      }
    }
    return out.filter((c) => {
      if (c.pos1 - c.pos0 + 1 > maxThickness) return false;
      const span = c.end - c.start + 1;
      if (span < minFinalLen) return false;
      const covered = computeIntervalCoverage(c.intervals);
      return covered / Math.max(1, span) >= 0.72;
    });
  };

  const hLines = clusterSegs(rawH, finalMinHLen, 9, 24);
  const vLines = clusterSegs(rawV, finalMinVLen, 9, 20);

  // Tier B: Inside detected horizontal-rule table bands (e.g. faint gray inner vertical grid borders),
  // look for continuous light-gray vertical dividers up to ~220 luminance so 4x4 tables never degrade to 4x2.
  const sortedHTopDown = [...hLines].sort((a, b) => a.pos - b.pos);
  const hBands: { minX: number; maxX: number; minY: number; maxY: number; hRows: ClusteredLine[] }[] = [];
  for (const h of sortedHTopDown) {
    const matchBand = hBands.find(
      (b) =>
        Math.min(b.maxX, h.end) - Math.max(b.minX, h.start) >=
          Math.min(b.maxX - b.minX, h.end - h.start) * 0.65 &&
        h.pos - b.maxY <= Math.max(95, Math.round(height * 0.14))
    );
    if (matchBand) {
      matchBand.minX = Math.min(matchBand.minX, h.start);
      matchBand.maxX = Math.max(matchBand.maxX, h.end);
      matchBand.maxY = Math.max(matchBand.maxY, h.pos);
      matchBand.hRows.push(h);
    } else {
      hBands.push({ minX: h.start, maxX: h.end, minY: h.pos, maxY: h.pos, hRows: [h] });
    }
  }

  for (const band of hBands) {
    const bandMinX = Math.round(band.minX);
    const bandMaxX = Math.round(band.maxX);
    const bandMinY = Math.round(band.minY);
    const bandMaxY = Math.round(band.maxY);
    const bandH = bandMaxY - bandMinY;
    if (band.hRows.length < 2 || bandH < Math.max(40, Math.round(scale * 26))) continue;

    // Scan vertical lines inside band using lighter gray threshold (< 226) with strict integer pixel coords
    const faintThresh = 226;
    const faintXs: number[] = [];
    const scanY0 = Math.max(0, bandMinY + 2);
    const scanY1 = Math.min(height - 1, bandMaxY - 2);
    for (let x = Math.max(0, bandMinX + 1); x <= Math.min(width - 1, bandMaxX - 1); x++) {
      let darkCount = 0;
      let maxContigGap = 0;
      let curGap = 0;
      for (let y = scanY0; y <= scanY1; y++) {
        if (gray[y * width + x] < faintThresh) {
          darkCount++;
          curGap = 0;
        } else {
          curGap++;
          if (curGap > maxContigGap) maxContigGap = curGap;
        }
      }
      const effSpan = Math.max(1, scanY1 - scanY0 + 1);
      if (darkCount / effSpan >= 0.78 && maxContigGap <= Math.max(10, Math.round(effSpan * 0.14))) {
        faintXs.push(x);
      }
    }

    // Group adjacent faintXs into thin rule columns (<= 7px thick) and avoid duplicating existing vLines
    let gxStart = -1;
    let gxPrev = -1;
    const flushFaintCol = (x0: number, x1: number) => {
      if (x1 - x0 + 1 > 7) return;
      const cx = (x0 + x1) / 2;
      const alreadyExists = vLines.some(
        (v) => Math.abs(v.pos - cx) <= 6 && v.end >= bandMinY + 10 && v.start <= bandMaxY - 10
      );
      if (!alreadyExists) {
        vLines.push({
          pos: cx,
          pos0: x0,
          pos1: x1,
          start: bandMinY,
          end: bandMaxY,
          intervals: [[bandMinY, bandMaxY]],
        });
      }
    };
    for (const fx of faintXs) {
      if (gxStart === -1) {
        gxStart = fx;
        gxPrev = fx;
      } else if (fx <= gxPrev + 2) {
        gxPrev = fx;
      } else {
        flushFaintCol(gxStart, gxPrev);
        gxStart = fx;
        gxPrev = fx;
      }
    }
    if (gxStart !== -1) flushFaintCol(gxStart, gxPrev);
  }

  const hSegments: HSegment[] = hLines.map((h) => ({
    x1: h.start / scale,
    x2: h.end / scale,
    y: pageHeightPt - h.pos / scale,
    lineWidth: Math.max(0.6, (h.pos1 - h.pos0 + 1) / scale),
    color: '000000',
  }));

  const vSegments: VSegment[] = vLines.map((v) => {
    const yTopPt = pageHeightPt - v.start / scale;
    const yBotPt = pageHeightPt - v.end / scale;
    return {
      x: v.pos / scale,
      y1: Math.min(yTopPt, yBotPt),
      y2: Math.max(yTopPt, yBotPt),
      lineWidth: Math.max(0.6, (v.pos1 - v.pos0 + 1) / scale),
      color: '000000',
    };
  });

  // Erase detected thin line rules on OCR copy WITHOUT clipping glyph stems crossing lines
  for (const h of hLines) {
    const yMin = Math.max(3, h.pos0 - 1);
    const yMax = Math.min(height - 4, h.pos1 + 1);
    for (let x = h.start; x <= h.end; x++) {
      const aboveInk = gray[(yMin - 2) * width + x] < 145 || gray[(yMin - 3) * width + x] < 145;
      const belowInk = gray[(yMax + 2) * width + x] < 145 || gray[(yMax + 3) * width + x] < 145;
      if (aboveInk && belowInk) continue;
      for (let y = h.pos0; y <= h.pos1; y++) {
        cleanedGray[y * width + x] = 252;
      }
    }
  }

  for (const v of vLines) {
    const xMin = Math.max(3, v.pos0 - 1);
    const xMax = Math.min(width - 4, v.pos1 + 1);
    for (let y = v.start; y <= v.end; y++) {
      const rOff = y * width;
      const leftInk = gray[rOff + (xMin - 2)] < 145 || gray[rOff + (xMin - 3)] < 145;
      const rightInk = gray[rOff + (xMax + 2)] < 145 || gray[rOff + (xMax + 3)] < 145;
      if (leftInk && rightInk) continue;
      for (let x = v.pos0; x <= v.pos1; x++) {
        cleanedGray[rOff + x] = 252;
      }
    }
  }

  // Group intersecting H/V lines into bounded table grids for targeted cell OCR
  const tables: DetectedPixelTableGrid[] = [];
  if (hLines.length >= 2 && vLines.length >= 2) {
    const usedV = new Set<number>();
    for (let vi = 0; vi < vLines.length; vi++) {
      if (usedV.has(vi)) continue;
      const compV = [vLines[vi]];
      usedV.add(vi);
      const compH: ClusteredLine[] = [];
      let changed = true;
      while (changed) {
        changed = false;
        for (const h of hLines) {
          if (compH.includes(h)) continue;
          if (
            compV.some(
              (v) =>
                v.pos >= h.start - 10 &&
                v.pos <= h.end + 10 &&
                h.pos >= v.start - 10 &&
                h.pos <= v.end + 10
            )
          ) {
            compH.push(h);
            changed = true;
          }
        }
        for (let vj = 0; vj < vLines.length; vj++) {
          if (usedV.has(vj)) continue;
          const v = vLines[vj];
          if (
            compH.some(
              (h) =>
                v.pos >= h.start - 10 &&
                v.pos <= h.end + 10 &&
                h.pos >= v.start - 10 &&
                h.pos <= v.end + 10
            )
          ) {
            compV.push(v);
            usedV.add(vj);
            changed = true;
          }
        }
      }

      if (compH.length >= 2 && compV.length >= 2) {
        const colXsPx = compV
          .map((v) => Math.round(v.pos))
          .sort((a, b) => a - b)
          .filter((x, idx, arr) => idx === 0 || x - arr[idx - 1] >= 12);
        const rowYsPx = compH
          .map((h) => Math.round(h.pos))
          .sort((a, b) => a - b)
          .filter((y, idx, arr) => idx === 0 || y - arr[idx - 1] >= 12);

        if (colXsPx.length >= 3 && rowYsPx.length >= 3) {
          tables.push({
            minXPx: colXsPx[0],
            maxXPx: colXsPx[colXsPx.length - 1],
            minYPx: rowYsPx[0],
            maxYPx: rowYsPx[rowYsPx.length - 1],
            colXsPx,
            rowYsPx,
          });
        }
      }
    }
  }

  // Pixel-Valley Column Segmentation for Horizontal-Rule Tables OR Coarse Tables with < 2 interior V-rules
  const columnSplitHints: { minY: number; maxY: number; xs: number[] }[] = [];
  for (const band of hBands) {
    if (band.hRows.length < 3) continue;
    const distinctRowYs = band.hRows
      .map((h) => Math.round(h.pos))
      .sort((a, b) => a - b)
      .filter((y, idx, arr) => idx === 0 || y - arr[idx - 1] >= 14);
    if (distinctRowYs.length < 3) continue;

    // Collect any existing V-lines intersecting this band
    const existingBandV = vLines
      .filter((v) => v.pos >= band.minX - 6 && v.pos <= band.maxX + 6 && v.end >= band.minY && v.start <= band.maxY)
      .map((v) => Math.round(v.pos))
      .sort((a, b) => a - b)
      .filter((x, idx, arr) => idx === 0 || x - arr[idx - 1] >= 12);

    const interiorExistingV = existingBandV.filter(
      (x) => x > band.minX + 12 && x < band.maxX - 12
    );
    // Only synthesize pixel valleys if table lacks full multi-column V-rules (< 2 interior rules)
    if (interiorExistingV.length >= 2) continue;

    // Inspect row strips inside the band for vertical ink-free whitespace gutters
    const stripYs: [number, number][] = [];
    for (let r = 0; r < distinctRowYs.length - 1; r++) {
      const sy0 = distinctRowYs[r] + 4;
      const sy1 = distinctRowYs[r + 1] - 4;
      if (sy1 - sy0 < 8) continue;
      let inkCount = 0;
      for (let y = sy0; y <= sy1; y++) {
        const rOff = y * width;
        for (let x = band.minX + 4; x <= band.maxX - 4; x++) {
          if (cleanedGray[rOff + x] < 175) inkCount++;
        }
      }
      if (inkCount >= 18) stripYs.push([sy0, sy1]);
    }
    if (stripYs.length < 2) continue;

    // Build per-column occupancy across active row strips
    const xStart = band.minX + 4;
    const xEnd = band.maxX - 4;
    const xSpan = xEnd - xStart + 1;
    if (xSpan < 60) continue;

    const colOccRows = new Uint16Array(xSpan);
    for (const [sy0, sy1] of stripYs) {
      for (let xi = 0; xi < xSpan; xi++) {
        const x = xStart + xi;
        let hasDark = false;
        for (let y = sy0; y <= sy1; y++) {
          if (cleanedGray[y * width + x] < 175) {
            hasDark = true;
            break;
          }
        }
        if (hasDark) colOccRows[xi]++;
      }
    }

    const minValleyPx = Math.max(Math.round(scale * 4.5), 11);
    const maxOverhang = stripYs.length >= 4 ? 1 : 0;
    const valleys: number[] = [];
    let inV = false;
    let vStart = 0;

    const recordValley = (vs: number, ve: number) => {
      if (ve - vs + 1 < minValleyPx) return;
      // Prefer pure zero-ink center inside the valley
      let pureS = -1;
      let pureE = -1;
      for (let k = vs; k <= ve; k++) {
        if (colOccRows[k] === 0) {
          if (pureS === -1) pureS = k;
          pureE = k;
        }
      }
      const centerPx = Math.round(xStart + (pureS !== -1 ? (pureS + pureE) / 2 : (vs + ve) / 2));
      if (existingBandV.some((vx) => Math.abs(vx - centerPx) <= 12)) return;

      // Verify at least 60% of strips have ink on BOTH sides of centerPx (rules out outer padding)
      const ci = centerPx - xStart;
      let leftInkCols = 0;
      let rightInkCols = 0;
      const searchReachPx = Math.max(95, Math.round(scale * 105));
      for (let k = Math.max(0, ci - searchReachPx); k < ci; k++) {
        if (colOccRows[k] > 0) leftInkCols++;
      }
      for (let k = ci + 1; k < Math.min(xSpan, ci + searchReachPx); k++) {
        if (colOccRows[k] > 0) rightInkCols++;
      }
      if (leftInkCols < 4 || rightInkCols < 4) return;

      let bothStrips = 0;
      for (const [sy0, sy1] of stripYs) {
        let hasL = false;
        let hasR = false;
        for (let y = sy0; y <= sy1 && !(hasL && hasR); y++) {
          const rOff = y * width;
          if (!hasL) {
            for (let x = Math.max(xStart, centerPx - searchReachPx); x < centerPx - 2; x++) {
              if (cleanedGray[rOff + x] < 175) {
                hasL = true;
                break;
              }
            }
          }
          if (!hasR) {
            for (let x = centerPx + 3; x <= Math.min(xEnd, centerPx + searchReachPx); x++) {
              if (cleanedGray[rOff + x] < 175) {
                hasR = true;
                break;
              }
            }
          }
        }
        if (hasL && hasR) bothStrips++;
      }

      if (bothStrips >= Math.max(2, Math.ceil(stripYs.length * 0.6))) {
        valleys.push(centerPx);
      }
    };

    for (let xi = 0; xi < xSpan; xi++) {
      if (colOccRows[xi] <= maxOverhang) {
        if (!inV) {
          inV = true;
          vStart = xi;
        }
      } else if (inV) {
        inV = false;
        recordValley(vStart, xi - 1);
      }
    }

    if (valleys.length >= 1) {
      const bandTopPt = pageHeightPt - band.minY / scale;
      const bandBotPt = pageHeightPt - band.maxY / scale;
      columnSplitHints.push({
        minY: Math.min(bandTopPt, bandBotPt),
        maxY: Math.max(bandTopPt, bandBotPt),
        xs: valleys.map((px) => px / scale),
      });

      const mergedColsPx = [band.minX, ...existingBandV, ...valleys, band.maxX]
        .sort((a, b) => a - b)
        .filter((x, idx, arr) => idx === 0 || x - arr[idx - 1] >= 12);

      if (mergedColsPx.length >= 3) {
        // Upgrade existing coarse PixelGrid table or register new one for targeted single-cell OCR!
        const existingTbl = tables.find(
          (t) =>
            Math.abs(t.minYPx - distinctRowYs[0]) <= 15 &&
            Math.abs(t.maxYPx - distinctRowYs[distinctRowYs.length - 1]) <= 15
        );
        if (existingTbl) {
          if (mergedColsPx.length > existingTbl.colXsPx.length) {
            existingTbl.colXsPx = mergedColsPx;
          }
        } else {
          tables.push({
            minXPx: mergedColsPx[0],
            maxXPx: mergedColsPx[mergedColsPx.length - 1],
            minYPx: distinctRowYs[0],
            maxYPx: distinctRowYs[distinctRowYs.length - 1],
            colXsPx: mergedColsPx,
            rowYsPx: distinctRowYs,
          });
        }
      }
    }
  }

  return {
    cleanedGray,
    tableHints: {
      hSegments,
      vSegments,
      headerBands: [],
      ...(columnSplitHints.length > 0 ? { columnSplitHints } : {}),
    },
    tables,
  };
}

/**
 * Estimates whether a recognized OCR word uses a bold typeface by measuring
 * foreground ink fill density inside the word's bounding box.
 */
function estimateWordBoldness(
  gray: Uint8Array,
  imgW: number,
  imgH: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  fontName?: string
): boolean {
  if (fontName && /bold|black|heavy|demi/i.test(fontName)) return true;
  const x0 = Math.max(0, Math.floor(bbox.x0));
  const y0 = Math.max(0, Math.floor(bbox.y0));
  const x1 = Math.min(imgW - 1, Math.ceil(bbox.x1));
  const y1 = Math.min(imgH - 1, Math.ceil(bbox.y1));
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < 12 || bh < 8) return false;

  let darkPixels = 0;
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const rOff = y * imgW;
    for (let x = x0; x <= x1; x++) {
      total++;
      if (gray[rOff + x] < 145) darkPixels++;
    }
  }
  const density = total > 0 ? darkPixels / total : 0;
  return density >= 0.345;
}

/**
 * Converts recognized OCR words (plus pixel coordinates & confidence scores) into full
 * ExtractedPageData through the shared layout classification & table reconstruction engine.
 * Never alters or guesses OCR characters; uncertain words (conf < 74 or low per-symbol conf < 64) remain flagged for review.
 */
export function buildPageDataFromOcrWords(
  words: OcrWordInput[],
  params: {
    pageNumber: number;
    pageWidthPt: number;
    pageHeightPt: number;
    scale: number;
    options: ConversionOptions;
    tableHints?: VectorTableHints;
  }
): ExtractedPageData {
  const { pageNumber, pageWidthPt, pageHeightPt, scale, options, tableHints } = params;

  const validWords = words.filter((w) => w.text && w.text.trim().length > 0);

  // Calibrate modal body font height in PDF pt using row heights across normal non-script words
  const baseWordsForCalib = validWords.some((w) => !w.scriptType)
    ? validWords.filter((w) => !w.scriptType)
    : validWords;
  const heightsPt = baseWordsForCalib
    .map((w) => ((w.rowHeightPx && w.rowHeightPx > 6 ? w.rowHeightPx : w.bbox.y1 - w.bbox.y0) / scale) * 0.92)
    .filter((h) => h >= 6 && h <= 42)
    .sort((a, b) => a - b);
  const medianWordPt = heightsPt.length > 0 ? heightsPt[Math.floor(heightsPt.length * 0.45)] : 11;
  // Clamp nominal body baseline so slightly taller OCR glyph boxes stay centered around ~10.5-11.5pt
  const bodyNormScale = medianWordPt >= 8.5 && medianWordPt <= 13.5 ? 11 / medianWordPt : 1.0;

  let ocrReviewCount = 0;
  const items: PositionedItem[] = validWords.map((w) => {
    const rawHeightPt = w.scriptType
      ? ((w.bbox.y1 - w.bbox.y0) / scale) * 0.92
      : ((w.rowHeightPx && w.rowHeightPx > 6 ? w.rowHeightPx : w.bbox.y1 - w.bbox.y0) / scale) * 0.92;
    const calibratedHeight = Math.max(
      w.scriptType ? 5.8 : 7.5,
      Math.min(34, rawHeightPt * bodyNormScale)
    );
    const conf = Math.round(w.confidence);
    const minSymConf =
      w.minSymbolConfidence !== undefined ? Math.round(w.minSymbolConfidence) : conf;
    const lowConfidence = conf < 74 || minSymConf < 64;
    if (lowConfidence) ocrReviewCount++;

    const xPt = w.bbox.x0 / scale;
    const widthPt = Math.max(2, (w.bbox.x1 - w.bbox.x0) / scale);
    const baselinePx = w.baselineY ?? w.bbox.y1;
    const yPt = pageHeightPt - baselinePx / scale;

    return {
      str: w.text.trim(),
      x: xPt,
      y: yPt,
      width: widthPt,
      height: calibratedHeight,
      fontName: options.defaultFontFamily,
      transform: [calibratedHeight, 0, 0, calibratedHeight, xPt, yPt],
      isBoldFlag: Boolean(w.isBold),
      ...(w.scriptType === 'super' ? { isSuperScriptFlag: true } : {}),
      ...(w.scriptType === 'sub' ? { isSubScriptFlag: true } : {}),
      confidence: conf,
      lowConfidence,
      ocrParagraphId: w.paragraphId,
    };
  });

  const allLines = groupItemsIntoLines(items, options.defaultFontFamily);
  return buildPageDataFromLines(allLines, options, {
    pageNumber,
    widthPt: pageWidthPt,
    heightPt: pageHeightPt,
    pageImages: [],
    vectorTableHints: tableHints,
    hasDiagramsOrImages: false,
    ocrReviewCount,
  });
}

function grayBufferToCanvas(gray: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  const dst = imgData.data;
  for (let i = 0; i < width * height; i++) {
    const v = gray[i];
    const off = i * 4;
    dst[off] = v;
    dst[off + 1] = v;
    dst[off + 2] = v;
    dst[off + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function rotateCanvas(srcCanvas: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.drawImage(srcCanvas, -w / 2, -h / 2);
  return out;
}

export function extractWordsFromTesseractResult(
  data: any,
  gray: Uint8Array,
  imgW: number,
  imgH: number,
  offsetX: number = 0,
  offsetY: number = 0,
  cropScale: number = 1
): OcrWordInput[] {
  const words: OcrWordInput[] = [];
  if (!data || !Array.isArray(data.blocks)) return words;

  let globalParaId = 1;
  for (const block of data.blocks) {
    for (const para of block?.paragraphs || []) {
      const paraId = globalParaId++;
      for (const line of para?.lines || []) {
        const lineHeightPx =
          line?.rowAttributes?.rowHeight ||
          (line?.bbox ? Math.max(8, (line.bbox.y1 - line.bbox.y0) * 0.9) : undefined);
        const baselineY = line?.baseline
          ? offsetY + ((line.baseline.y0 + line.baseline.y1) * 0.5) / cropScale
          : undefined;
        const scaledLineH = lineHeightPx ? lineHeightPx / cropScale : undefined;

        for (const w of line?.words || []) {
          const txt = (w?.text || '').trim();
          if (!txt) continue;
          const b = w.bbox || line.bbox;
          if (!b) continue;
          const mappedBbox = {
            x0: offsetX + b.x0 / cropScale,
            y0: offsetY + b.y0 / cropScale,
            x1: offsetX + b.x1 / cropScale,
            y1: offsetY + b.y1 / cropScale,
          };
          const rawWordConf = typeof w.confidence === 'number' ? w.confidence : 75;
          const isWordBold = estimateWordBoldness(gray, imgW, imgH, mappedBbox, w.font_name);

          // Track per-symbol minimum confidence across alphanumeric/currency/math symbols so one uncertain
          // misread glyph (e.g. 'B' in 'B12,500' or '3' for 'β') cannot be hidden by surrounding digits.
          const syms: any[] = Array.isArray(w.symbols) ? w.symbols : [];
          const coreSymConfs = syms
            .filter(
              (s) =>
                typeof s?.confidence === 'number' &&
                /[A-Za-z0-9₹$€£¥%&#@*+\-=<>\/α-ωΑ-Ωπ]/.test((s?.text || '').trim())
            )
            .map((s) => s.confidence as number);
          const allSymConfs = syms
            .filter((s) => typeof s?.confidence === 'number')
            .map((s) => s.confidence as number);
          const minCoreSymConf =
            coreSymConfs.length > 0
              ? Math.min(...coreSymConfs)
              : allSymConfs.length > 0
              ? Math.min(...allSymConfs)
              : rawWordConf;
          const wordConf =
            minCoreSymConf < 68
              ? Math.round(Math.min(rawWordConf, rawWordConf * 0.55 + minCoreSymConf * 0.45))
              : Math.round(rawWordConf);

          // Split word into normal + superscript/subscript segments using Tesseract symbol attributes & geometry
          // while NEVER altering or guessing any recognized character or raising low confidence scores.
          if (syms.length >= 2) {
            const symMeta = syms.map((s) => {
              const sb = s?.bbox;
              const sTxt = (s?.text || '').replace(/\s+/g, '');
              const my0 = sb ? offsetY + sb.y0 / cropScale : mappedBbox.y0;
              const my1 = sb ? offsetY + sb.y1 / cropScale : mappedBbox.y1;
              const mx0 = sb ? offsetX + sb.x0 / cropScale : mappedBbox.x0;
              const mx1 = sb ? offsetX + sb.x1 / cropScale : mappedBbox.x1;
              return {
                sym: s,
                text: sTxt,
                x0: mx0,
                y0: my0,
                x1: mx1,
                y1: my1,
                h: Math.max(1, my1 - my0),
                conf: typeof s?.confidence === 'number' ? s.confidence : wordConf,
              };
            });

            // Compute median baseline & height from non-flagged alphanumeric anchors in this word
            const anchorCands = symMeta.filter(
              (m) =>
                !m.sym?.is_superscript &&
                !m.sym?.is_subscript &&
                /[A-Za-z0-9]/.test(m.text)
            );
            const sortedAnchorH = anchorCands.map((a) => a.h).sort((a, b) => a - b);
            const wordAnchorH =
              sortedAnchorH.length > 0
                ? sortedAnchorH[Math.floor(sortedAnchorH.length * 0.65)]
                : scaledLineH || mappedBbox.y1 - mappedBbox.y0;
            const refBaselineY = baselineY ?? mappedBbox.y1;

            const taggedSyms = symMeta.map((m, idx) => {
              let kind: 'normal' | 'super' | 'sub' = 'normal';
              if (m.sym?.is_superscript) {
                kind = 'super';
              } else if (m.sym?.is_subscript) {
                kind = 'sub';
              } else if (
                m.sym?.bbox &&
                wordAnchorH >= 10 &&
                idx > 0 &&
                /^[0-9a-zA-Z+\-=()]$/.test(m.text)
              ) {
                const isSmallScriptSize = m.h <= wordAnchorH * 0.78 && m.h >= wordAnchorH * 0.28;
                const isNotDescenderChar = !/[gjpqy]/.test(m.text) || m.h <= wordAnchorH * 0.64;
                if (
                  isSmallScriptSize &&
                  m.y1 <= refBaselineY - Math.max(2.2, wordAnchorH * 0.16) &&
                  m.y0 <= refBaselineY - wordAnchorH * 0.42
                ) {
                  kind = 'super';
                } else if (
                  isSmallScriptSize &&
                  isNotDescenderChar &&
                  m.y1 >= refBaselineY + Math.max(1.6, wordAnchorH * 0.10) &&
                  m.y0 >= refBaselineY - wordAnchorH * 0.65
                ) {
                  kind = 'sub';
                }
              }
              return { ...m, kind };
            });

            const hasAnyScript = taggedSyms.some((t) => t.kind !== 'normal');
            if (hasAnyScript) {
              interface SegAcc {
                kind: 'normal' | 'super' | 'sub';
                parts: typeof taggedSyms;
              }
              const segs: SegAcc[] = [];
              for (const ts of taggedSyms) {
                if (!ts.text) continue;
                const lastSeg = segs[segs.length - 1];
                if (lastSeg && lastSeg.kind === ts.kind) {
                  lastSeg.parts.push(ts);
                } else {
                  segs.push({ kind: ts.kind, parts: [ts] });
                }
              }

              const rebuiltTxt = segs.map((sg) => sg.parts.map((p) => p.text).join('')).join('');
              if (segs.length >= 2 && rebuiltTxt.length > 0) {
                for (const sg of segs) {
                  const segText = sg.parts.map((p) => p.text).join('');
                  if (!segText) continue;
                  const segMinSymConf = Math.min(...sg.parts.map((p) => p.conf));
                  const segConf = Math.round(
                    Math.min(
                      wordConf < 74 ? wordConf : 100,
                      segMinSymConf
                    )
                  );
                  const segBox = {
                    x0: Math.min(...sg.parts.map((p) => p.x0)),
                    y0: Math.min(...sg.parts.map((p) => p.y0)),
                    x1: Math.max(...sg.parts.map((p) => p.x1)),
                    y1: Math.max(...sg.parts.map((p) => p.y1)),
                  };
                  words.push({
                    text: segText,
                    confidence: segConf,
                    minSymbolConfidence: Math.round(segMinSymConf),
                    bbox: segBox,
                    baselineY: refBaselineY,
                    rowHeightPx: scaledLineH,
                    isBold: isWordBold,
                    paragraphId: paraId,
                    ...(sg.kind !== 'normal' ? { scriptType: sg.kind } : {}),
                  });
                }
                continue;
              }
            }
          }

          // Standalone short script token on a baseline (e.g. Tesseract split "x" and "1" into separate words)
          let standaloneScript: 'super' | 'sub' | undefined;
          const wH = mappedBbox.y1 - mappedBbox.y0;
          const refBase = baselineY ?? mappedBbox.y1;
          const refH = scaledLineH || wH;
          if (
            refH >= 10 &&
            baselineY !== undefined &&
            txt.length <= 3 &&
            /^[0-9+\-=()a-zA-Z]+$/.test(txt) &&
            wH <= refH * 0.78
          ) {
            if (
              mappedBbox.y1 <= refBase - Math.max(2.4, refH * 0.16) &&
              mappedBbox.y0 <= refBase - refH * 0.42
            ) {
              standaloneScript = 'super';
            } else if (
              mappedBbox.y1 >= refBase + Math.max(1.8, refH * 0.10) &&
              mappedBbox.y0 >= refBase - refH * 0.65 &&
              (!/[gjpqy]/.test(txt) || wH <= refH * 0.64)
            ) {
              standaloneScript = 'sub';
            }
          }

          words.push({
            text: txt,
            confidence: wordConf,
            minSymbolConfidence: Math.round(minCoreSymConf),
            bbox: mappedBbox,
            baselineY,
            rowHeightPx: scaledLineH,
            isBold: isWordBold,
            paragraphId: paraId,
            ...(standaloneScript ? { scriptType: standaloneScript } : {}),
          });
        }
      }
    }
  }
  return words;
}

/**
 * Full structured OCR pipeline for a scanned PDF page:
 * - High-DPI rendering (~280-300 DPI)
 * - Background shading removal, top dark-banner auto-inversion, contrast enhancement & sharpening
 * - Projection-based image deskewing
 * - Pixel table grid detection + border-rule suppression for clean digit/symbol reads
 * - Multi-pass targeted cell & top-title OCR recovery with confidence preservation
 * - Semantic classification into Word Title, Headings, Tables, Lists, and Paragraphs
 */
export async function runStructuredOcrOnPage(
  pdfPage: any,
  worker: any,
  options: ConversionOptions
): Promise<ExtractedPageData> {
  const baseViewport = pdfPage.getViewport({ scale: 1.0 });
  const pageWidthPt = baseViewport.width;
  const pageHeightPt = baseViewport.height;

  // Render cleanly around ~300-320 DPI while keeping memory bounded for oversized pages
  const scale = Math.min(4.5, Math.max(3.4, 2550 / Math.max(400, pageWidthPt)));
  const viewport = pdfPage.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = width;
  rawCanvas.height = height;
  const rawCtx = rawCanvas.getContext('2d')!;
  rawCtx.fillStyle = '#FFFFFF';
  rawCtx.fillRect(0, 0, width, height);
  await pdfPage.render({ canvasContext: rawCtx, viewport }).promise;

  // Preprocess contrast & illumination first, then measure and correct page skew
  const rawImgData = rawCtx.getImageData(0, 0, width, height);
  const preGray = preprocessImageBuffer(rawImgData.data, width, height);
  const skewDeg = detectSkewAngleDeg(preGray, width, height);

  let deskewedGray = preGray;
  let deskewedCanvas = grayBufferToCanvas(preGray, width, height);
  if (Math.abs(skewDeg) >= 0.25) {
    deskewedCanvas = rotateCanvas(deskewedCanvas, skewDeg);
    const rotData = deskewedCanvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    deskewedGray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      deskewedGray[i] = rotData[i * 4];
    }
  }

  // Detect bitmap table rules & prepare rule-cleaned OCR bitmap
  const gridAnalysis = detectBitmapTableGridAndRemoveRules(
    deskewedGray,
    width,
    height,
    scale,
    pageHeightPt
  );
  const ocrCanvas = grayBufferToCanvas(gridAnalysis.cleanedGray, width, height);

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '3', // PSM.AUTO
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
  } catch {
    // non-fatal if mock/worker skips parameters
  }

  const fullRet = await worker.recognize(ocrCanvas, {}, { blocks: true, text: true });
  let pageWords = extractWordsFromTesseractResult(
    fullRet?.data,
    deskewedGray,
    width,
    height
  );

  // Fallback ONLY if blocks unexpectedly came back empty while text exists
  if (pageWords.length === 0 && fullRet?.data?.text?.trim()) {
    const fallbackLines = fullRet.data.text
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    const stepY = (height * 0.78) / Math.max(1, fallbackLines.length);
    fallbackLines.forEach((lineText: string, idx: number) => {
      const wordsInLine = lineText.split(/\s+/).filter(Boolean);
      const yPx = Math.round(height * 0.1 + idx * stepY);
      wordsInLine.forEach((wt: string, wIdx: number) => {
        const x0 = Math.round(width * 0.09 + wIdx * Math.max(40, (width * 0.8) / Math.max(4, wordsInLine.length)));
        pageWords.push({
          text: wt,
          confidence: 68,
          bbox: { x0, y0: yPx - 24, x1: x0 + wt.length * 14, y1: yPx },
          baselineY: yPx,
          rowHeightPx: 26,
          isBold: false,
          paragraphId: idx + 1,
        });
      });
    });
  }

  // Top Title Strip Recovery: if top 17% of page has substantial dark ink yet returned 0 words,
  // crop that top strip and run dedicated header/title recognition.
  const topBandMaxY = Math.floor(height * 0.17);
  const hasTopWords = pageWords.some((w) => w.bbox.y1 <= topBandMaxY && w.confidence >= 45);
  if (!hasTopWords) {
    let minInkY = height;
    let maxInkY = -1;
    let darkTotal = 0;
    for (let y = 12; y < topBandMaxY; y++) {
      const rOff = y * width;
      for (let x = Math.floor(width * 0.05); x < Math.floor(width * 0.95); x++) {
        if (deskewedGray[rOff + x] < 160) {
          darkTotal++;
          if (y < minInkY) minInkY = y;
          if (y > maxInkY) maxInkY = y;
        }
      }
    }
    if (darkTotal >= 180 && maxInkY - minInkY >= 14) {
      const cropY0 = Math.max(0, minInkY - 12);
      const cropY1 = Math.min(height, maxInkY + 12);
      const pad = 24;
      const tCanvas = document.createElement('canvas');
      tCanvas.width = width + pad * 2;
      tCanvas.height = cropY1 - cropY0 + pad * 2;
      const tCtx = tCanvas.getContext('2d')!;
      tCtx.fillStyle = '#FFFFFF';
      tCtx.fillRect(0, 0, tCanvas.width, tCanvas.height);
      tCtx.drawImage(
        ocrCanvas,
        0,
        cropY0,
        width,
        cropY1 - cropY0,
        pad,
        pad,
        width,
        cropY1 - cropY0
      );
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        const titleRet = await worker.recognize(tCanvas, {}, { blocks: true, text: true });
        const titleWords = extractWordsFromTesseractResult(
          titleRet?.data,
          deskewedGray,
          width,
          height,
          -pad,
          cropY0 - pad,
          1
        );
        if (titleWords.length > 0) {
          pageWords.push(...titleWords);
        }
      } catch {
        // non-fatal
      }
    }
  }

  // Targeted Border-Free Table Cell Recovery for missed, low-confidence, or column-crossing table cells
  for (const tbl of gridAnalysis.tables) {
    for (let r = 0; r < tbl.rowYsPx.length - 1; r++) {
      const rowOrigWords = pageWords.filter((w) => {
        const wcy = (w.bbox.y0 + w.bbox.y1) / 2;
        return (
          wcy >= tbl.rowYsPx[r] &&
          wcy <= tbl.rowYsPx[r + 1] &&
          w.bbox.x1 >= tbl.minXPx - 6 &&
          w.bbox.x0 <= tbl.maxXPx + 6
        );
      });
      const rowBaselines = rowOrigWords
        .map((w) => w.baselineY)
        .filter((y): y is number => typeof y === 'number')
        .sort((a, b) => a - b);
      const rowAnchorBaseline =
        rowBaselines.length > 0 ? rowBaselines[Math.floor(rowBaselines.length / 2)] : undefined;

      for (let c = 0; c < tbl.colXsPx.length - 1; c++) {
        const inset = Math.max(3, Math.round(scale * 1.1));
        const cx0 = tbl.colXsPx[c] + inset;
        const cx1 = tbl.colXsPx[c + 1] - inset;
        const cy0 = tbl.rowYsPx[r] + inset;
        const cy1 = tbl.rowYsPx[r + 1] - inset;
        const cw = cx1 - cx0;
        const ch = cy1 - cy0;
        if (cw < 10 || ch < 10) continue;

        // Check if cell interior contains ink pixels
        let inkCount = 0;
        for (let y = cy0; y <= cy1; y++) {
          const rOff = y * width;
          for (let x = cx0; x <= cx1; x++) {
            if (gridAnalysis.cleanedGray[rOff + x] < 165) inkCount++;
          }
        }
        if (inkCount < 18 || inkCount / Math.max(1, cw * ch) < 0.0015) continue;

        const existingCellWords = pageWords.filter((w) => {
          const wcx = (w.bbox.x0 + w.bbox.x1) / 2;
          const wcy = (w.bbox.y0 + w.bbox.y1) / 2;
          return (
            wcx >= tbl.colXsPx[c] &&
            wcx <= tbl.colXsPx[c + 1] &&
            wcy >= tbl.rowYsPx[r] &&
            wcy <= tbl.rowYsPx[r + 1]
          );
        });

        // Also catch words merged across vertical column boundaries on this row
        const crossingWords = pageWords.filter((w) => {
          const wcy = (w.bbox.y0 + w.bbox.y1) / 2;
          if (wcy < tbl.rowYsPx[r] || wcy > tbl.rowYsPx[r + 1]) return false;
          const overlapsInterior = w.bbox.x0 < cx1 - 3 && w.bbox.x1 > cx0 + 3;
          const crossesColBorder =
            w.bbox.x0 < tbl.colXsPx[c] - 4 || w.bbox.x1 > tbl.colXsPx[c + 1] + 4;
          return overlapsInterior && crossesColBorder;
        });

        const minConf =
          existingCellWords.length > 0
            ? Math.min(
                ...existingCellWords.map((w) =>
                  Math.min(w.confidence, w.minSymbolConfidence ?? w.confidence)
                )
              )
            : 0;
        if (crossingWords.length === 0 && existingCellWords.length > 0 && minConf >= 78) {
          continue;
        }

        // Crop clean interior onto padded upscaled white canvas for crisp LSTM read
        const upScale = ch < 48 ? Math.min(2.5, Math.max(1.5, 54 / ch)) : 1.4;
        const pad = 20;
        const cCanvas = document.createElement('canvas');
        cCanvas.width = Math.ceil(cw * upScale) + pad * 2;
        cCanvas.height = Math.ceil(ch * upScale) + pad * 2;
        const cCtx = cCanvas.getContext('2d')!;
        cCtx.fillStyle = '#FFFFFF';
        cCtx.fillRect(0, 0, cCanvas.width, cCanvas.height);
        cCtx.imageSmoothingEnabled = true;
        cCtx.imageSmoothingQuality = 'high';
        cCtx.drawImage(
          ocrCanvas,
          cx0,
          cy0,
          cw,
          ch,
          pad,
          pad,
          Math.ceil(cw * upScale),
          Math.ceil(ch * upScale)
        );

        try {
          const isSingleRowCell = ch < Math.round(scale * 24);
          await worker.setParameters({
            tessedit_pageseg_mode: isSingleRowCell ? '7' : '6', // SINGLE_LINE or SINGLE_BLOCK
            preserve_interword_spaces: '1',
          });
          const cellRet = await worker.recognize(cCanvas, {}, { blocks: true, text: true });
          const cellWords = extractWordsFromTesseractResult(
            cellRet?.data,
            deskewedGray,
            width,
            height,
            cx0 - pad / upScale,
            cy0 - pad / upScale,
            upScale
          );
          if (cellWords.length > 0) {
            const oldMean =
              existingCellWords.length > 0
                ? existingCellWords.reduce((a, b) => a + b.confidence, 0) / existingCellWords.length
                : 0;
            const newMean =
              cellWords.reduce((a, b) => a + b.confidence, 0) / cellWords.length;

            if (
              crossingWords.length > 0 ||
              existingCellWords.length === 0 ||
              newMean >= oldMean - 1
            ) {
              const refBaseline =
                crossingWords.find((w) => w.baselineY !== undefined)?.baselineY ??
                existingCellWords.find((w) => w.baselineY !== undefined)?.baselineY ??
                rowAnchorBaseline;
              const cellLineCount = Array.isArray(cellRet?.data?.blocks)
                ? cellRet.data.blocks.reduce(
                    (acc: number, b: any) =>
                      acc +
                      (b?.paragraphs || []).reduce(
                        (pAcc: number, p: any) => pAcc + (p?.lines?.length || 0),
                        0
                      ),
                    0
                  )
                : 0;
              const alignedCellWords =
                refBaseline !== undefined && cellLineCount <= 1
                  ? cellWords.map((cwItem) =>
                      cwItem.baselineY === undefined
                        ? { ...cwItem, baselineY: refBaseline }
                        : cwItem
                    )
                  : cellWords;
              const removeSet = new Set([...existingCellWords, ...crossingWords]);
              pageWords = pageWords.filter((w) => !removeSet.has(w));
              pageWords.push(...alignedCellWords);
            }
          }
        } catch {
          // keep original full-page cell read on fallback
        }
      }
    }
  }

  // Targeted Non-Table Uncertain Token Retry (upscaled padded single-word pass without dictionary forcing)
  // Never guesses or substitutes characters; keeps whichever read has strictly stronger genuine OCR confidence.
  const isWordInsideAnyTable = (w: OcrWordInput): boolean => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    return gridAnalysis.tables.some(
      (t) => cx >= t.minXPx && cx <= t.maxXPx && cy >= t.minYPx && cy <= t.maxYPx
    );
  };

  const uncertainCandidates = pageWords
    .filter((w) => {
      if (isWordInsideAnyTable(w)) return false;
      const bw = w.bbox.x1 - w.bbox.x0;
      const bh = w.bbox.y1 - w.bbox.y0;
      if (bw < 6 || bh < 8 || bw > width * 0.65 || bh > height * 0.15) return false;
      const worstConf = Math.min(w.confidence, w.minSymbolConfidence ?? w.confidence);
      return worstConf < 74;
    })
    .sort(
      (a, b) =>
        Math.min(a.confidence, a.minSymbolConfidence ?? a.confidence) -
        Math.min(b.confidence, b.minSymbolConfidence ?? b.confidence)
    )
    .slice(0, 10);

  if (uncertainCandidates.length > 0) {
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '8', // PSM.SINGLE_WORD
        preserve_interword_spaces: '1',
        load_system_dawg: '0',
        load_freq_dawg: '0',
      });

      for (const uw of uncertainCandidates) {
        const marginX = Math.max(8, Math.round((uw.bbox.y1 - uw.bbox.y0) * 0.35));
        const marginY = Math.max(6, Math.round((uw.bbox.y1 - uw.bbox.y0) * 0.25));
        const rx0 = Math.max(0, Math.floor(uw.bbox.x0) - marginX);
        const ry0 = Math.max(0, Math.floor(uw.bbox.y0) - marginY);
        const rx1 = Math.min(width, Math.ceil(uw.bbox.x1) + marginX);
        const ry1 = Math.min(height, Math.ceil(uw.bbox.y1) + marginY);
        const rw = rx1 - rx0;
        const rh = ry1 - ry0;
        if (rw < 8 || rh < 8) continue;

        const retryScale = rh < 44 ? Math.min(2.8, Math.max(1.8, 62 / rh)) : 1.6;
        const pad = 22;
        const rCanvas = document.createElement('canvas');
        rCanvas.width = Math.ceil(rw * retryScale) + pad * 2;
        rCanvas.height = Math.ceil(rh * retryScale) + pad * 2;
        const rCtx = rCanvas.getContext('2d')!;
        rCtx.fillStyle = '#FFFFFF';
        rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);
        rCtx.imageSmoothingEnabled = true;
        rCtx.imageSmoothingQuality = 'high';
        rCtx.drawImage(
          ocrCanvas,
          rx0,
          ry0,
          rw,
          rh,
          pad,
          pad,
          Math.ceil(rw * retryScale),
          Math.ceil(rh * retryScale)
        );

        const retryRet = await worker.recognize(rCanvas, {}, { blocks: true, text: true });
        const retryWords = extractWordsFromTesseractResult(
          retryRet?.data,
          deskewedGray,
          width,
          height,
          rx0 - pad / retryScale,
          ry0 - pad / retryScale,
          retryScale
        );
        if (retryWords.length > 0) {
          const oldScore = Math.min(uw.confidence, uw.minSymbolConfidence ?? uw.confidence);
          const newScore = Math.min(
            ...retryWords.map((w) => Math.min(w.confidence, w.minSymbolConfidence ?? w.confidence))
          );
          if (newScore >= oldScore + 3) {
            const idx = pageWords.indexOf(uw);
            if (idx !== -1) {
              const preservedMeta = retryWords.map((rwItem) => ({
                ...rwItem,
                baselineY: uw.baselineY ?? rwItem.baselineY,
                rowHeightPx: uw.rowHeightPx ?? rwItem.rowHeightPx,
                paragraphId: uw.paragraphId ?? rwItem.paragraphId,
                ...(uw.scriptType ? { scriptType: uw.scriptType } : {}),
              }));
              pageWords.splice(idx, 1, ...preservedMeta);
            }
          }
        }
      }
    } catch {
      // keep initial read on fallback
    } finally {
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '3',
          preserve_interword_spaces: '1',
          load_system_dawg: '1',
          load_freq_dawg: '1',
        });
      } catch {
        // non-fatal
      }
    }
  }

  return buildPageDataFromOcrWords(pageWords, {
    pageNumber: pdfPage.pageNumber,
    pageWidthPt,
    pageHeightPt,
    scale,
    options,
    tableHints: gridAnalysis.tableHints,
  });
}
