import * as pdfjsModule from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import pako from 'pako';
import { computeOtsuThreshold, encodeCcittGroup4 } from './ccittG4';
import { CompressionSettings } from './config';
import { AnalyzedPdfContext, fnv1aHashBytes } from './analyzer';
import { QpdfJsonDocument, QpdfJsonObjectEntry, extractSpecificStreamsWithQpdf } from './qpdfEngine';
import { resolveJsonDict, resolveJsonValue } from './contentStreamCtm';
import { buildWorkerSafePdfjsParams } from './pdfjsWorkerSafe';

export type ImageOptimizationAction =
  | 'kept-original'
  | 'kept-already-optimized'
  | 'recompressed-jpeg'
  | 'downsampled-jpeg'
  | 'converted-grayscale-jpeg'
  | 'converted-ccitt-g4'
  | 'lossless-indexed-flate'
  | 'lossless-flate-predictor'
  | 'dropped-redundant-smask'
  | 'kept-mask-lossless';

export interface OptimizedImageResult {
  objectRef: string;
  action: ImageOptimizationAction;
  originalWidthPx: number;
  originalHeightPx: number;
  newWidthPx: number;
  newHeightPx: number;
  originalBytes: number;
  newBytes: number;
  replacedDict?: Record<string, unknown>;
  replacedBytes?: Uint8Array;
  sMaskAction?: 'unchanged' | 'dropped' | 'updated';
  sMaskRef?: string;
  replacedSMaskDict?: Record<string, unknown>;
  replacedSMaskBytes?: Uint8Array;
  /** Hash of final effective stream + key dict attributes for post-opt deduplication */
  canonicalContentHash: string;
}

export interface ImageOptimizationSummary {
  resultsByRef: Map<string, OptimizedImageResult>;
  optimizedCount: number;
  downsampledCount: number;
  convertedToCcittCount: number;
  convertedToGrayscaleCount: number;
  droppedOpaqueSmaskCount: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface CanvasRasterAdapter {
  decodeJpegToRgba: (
    jpegBytes: Uint8Array
  ) => Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
  encodeRgbaToJpeg: (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    quality01: number
  ) => Promise<Uint8Array>;
  resampleRgba: (
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number
  ) => Promise<Uint8ClampedArray>;
}

function createSurface(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }
  throw new Error('No Canvas/OffscreenCanvas raster backend available in this environment.');
}

function get2dContext(
  surface: OffscreenCanvas | HTMLCanvasElement
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = surface.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('Unable to acquire 2D canvas context.');
  return ctx;
}

async function surfaceToJpegBytes(
  surface: OffscreenCanvas | HTMLCanvasElement,
  quality01: number
): Promise<Uint8Array> {
  if ('convertToBlob' in surface && typeof surface.convertToBlob === 'function') {
    const blob = await surface.convertToBlob({ type: 'image/jpeg', quality: quality01 });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const htmlCanvas = surface as HTMLCanvasElement;
  const blob = await new Promise<Blob>((resolve, reject) => {
    htmlCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality01
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export function createBrowserRasterAdapter(): CanvasRasterAdapter {
  const decodeJpegToRgba = async (
    jpegBytes: Uint8Array
  ): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> => {
    const blob = new Blob([jpegBytes as unknown as BlobPart], { type: 'image/jpeg' });
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      try {
        const w = bitmap.width;
        const h = bitmap.height;
        const surf = createSurface(w, h);
        const ctx = get2dContext(surf);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        return { width: w, height: h, rgba: imgData.data };
      } finally {
        bitmap.close();
      }
    }

    // Fallback via HTMLImageElement on main thread
    if (typeof Image !== 'undefined') {
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('JPEG Image decode failed'));
          el.src = url;
        });
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const surf = createSurface(w, h);
        const ctx = get2dContext(surf);
        ctx.drawImage(img, 0, 0, w, h);
        return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    throw new Error('No JPEG decode backend available');
  };

  const resampleRgba = async (
    rgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number
  ): Promise<Uint8ClampedArray> => {
    if (srcW === dstW && srcH === dstH) return rgba;

    let currW = srcW;
    let currH = srcH;
    let currSurf = createSurface(currW, currH);
    const initCtx = get2dContext(currSurf);
    const imgData = new ImageData(new Uint8ClampedArray(rgba), currW, currH);
    initCtx.putImageData(imgData, 0, 0);

    // Progressive 2x mipmap halving for crisp, alias-free downsampling
    while (currW * 0.5 > dstW && currH * 0.5 > dstH) {
      const nextW = Math.max(dstW, Math.round(currW * 0.5));
      const nextH = Math.max(dstH, Math.round(currH * 0.5));
      const nextSurf = createSurface(nextW, nextH);
      const ctx = get2dContext(nextSurf);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(currSurf as CanvasImageSource, 0, 0, currW, currH, 0, 0, nextW, nextH);
      currSurf = nextSurf;
      currW = nextW;
      currH = nextH;
    }

    if (currW !== dstW || currH !== dstH) {
      const finalSurf = createSurface(dstW, dstH);
      const ctx = get2dContext(finalSurf);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(currSurf as CanvasImageSource, 0, 0, currW, currH, 0, 0, dstW, dstH);
      return ctx.getImageData(0, 0, dstW, dstH).data;
    }

    return get2dContext(currSurf).getImageData(0, 0, dstW, dstH).data;
  };

  const encodeRgbaToJpeg = async (
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    quality01: number
  ): Promise<Uint8Array> => {
    const surf = createSurface(width, height);
    const ctx = get2dContext(surf);
    const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imgData, 0, 0);
    return surfaceToJpegBytes(surf, quality01);
  };

  return {
    decodeJpegToRgba,
    encodeRgbaToJpeg,
    resampleRgba,
  };
}

export interface JpegHeaderInfo {
  width: number;
  height: number;
  numComponents: number;
  hasAdobeTransform: boolean;
  adobeTransform?: number;
}

/**
 * Inspect JPEG SOF & APP14 Adobe markers without decoding full bitmap.
 */
export function inspectJpegHeader(bytes: Uint8Array): JpegHeaderInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  let hasAdobeTransform = false;
  let adobeTransform: number | undefined;

  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) break;
    const marker = bytes[pos++];

    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }
    if (pos + 1 >= bytes.length) break;
    const segLen = (bytes[pos] << 8) | bytes[pos + 1];
    if (segLen < 2 || pos + segLen > bytes.length) break;

    if (marker === 0xee && segLen >= 14) {
      // APP14 "Adobe"
      if (
        bytes[pos + 2] === 0x41 &&
        bytes[pos + 3] === 0x64 &&
        bytes[pos + 4] === 0x6f &&
        bytes[pos + 5] === 0x62 &&
        bytes[pos + 6] === 0x65
      ) {
        hasAdobeTransform = true;
        adobeTransform = bytes[pos + 13];
      }
    }

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7
    ) {
      if (segLen >= 8) {
        const height = (bytes[pos + 3] << 8) | bytes[pos + 4];
        const width = (bytes[pos + 5] << 8) | bytes[pos + 6];
        const numComponents = bytes[pos + 7];
        return { width, height, numComponents, hasAdobeTransform, adobeTransform };
      }
    }

    pos += segLen;
  }

  return null;
}

function normalizeFilterList(filterVal: unknown): string[] {
  if (typeof filterVal === 'string') return [filterVal];
  if (Array.isArray(filterVal)) return filterVal.map((x) => String(x));
  return [];
}

function getDecodeParmsDict(
  objs: Record<string, QpdfJsonObjectEntry>,
  rawParms: unknown
): Record<string, unknown> | undefined {
  if (!rawParms) return undefined;
  if (Array.isArray(rawParms)) {
    return resolveJsonDict(objs, rawParms[0]);
  }
  return resolveJsonDict(objs, rawParms);
}

function decodeQpdfBinaryString(val: unknown): Uint8Array | null {
  if (typeof val !== 'string') return null;
  if (val.startsWith('b:')) {
    const hex = val.slice(2);
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return out;
  }
  if (val.startsWith('u:')) {
    return new TextEncoder().encode(val.slice(2));
  }
  const bytes = new Uint8Array(val.length);
  for (let i = 0; i < val.length; i++) bytes[i] = val.charCodeAt(i) & 0xff;
  return bytes;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyPredictorDecode(
  raw: Uint8Array,
  predictor: number,
  columns: number,
  colors: number,
  bpc: number,
  rows: number
): Uint8Array | null {
  if (predictor <= 1) return raw;
  const bytesPerSampleRow = Math.ceil((columns * colors * bpc) / 8);

  if (predictor >= 10 && predictor <= 15) {
    const stride = bytesPerSampleRow + 1;
    if (raw.length < stride * rows) return null;
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const out = new Uint8Array(bytesPerSampleRow * rows);
    let prevRow: Uint8Array | null = null;

    for (let y = 0; y < rows; y++) {
      const srcOff = y * stride;
      const dstOff = y * bytesPerSampleRow;
      const filterType = raw[srcOff];
      const currRow = out.subarray(dstOff, dstOff + bytesPerSampleRow);

      for (let x = 0; x < bytesPerSampleRow; x++) {
        const val = raw[srcOff + 1 + x];
        const left = x >= bpp ? currRow[x - bpp] : 0;
        const up = prevRow ? prevRow[x] : 0;
        const upLeft = prevRow && x >= bpp ? prevRow[x - bpp] : 0;

        let decoded: number;
        switch (filterType) {
          case 0:
            decoded = val;
            break;
          case 1:
            decoded = (val + left) & 0xff;
            break;
          case 2:
            decoded = (val + up) & 0xff;
            break;
          case 3:
            decoded = (val + ((left + up) >> 1)) & 0xff;
            break;
          case 4:
            decoded = (val + paethPredictor(left, up, upLeft)) & 0xff;
            break;
          default:
            return null;
        }
        currRow[x] = decoded;
      }
      prevRow = currRow;
    }
    return out;
  }

  if (predictor === 2 && bpc === 8) {
    if (raw.length < bytesPerSampleRow * rows) return null;
    const out = new Uint8Array(bytesPerSampleRow * rows);
    for (let y = 0; y < rows; y++) {
      const off = y * bytesPerSampleRow;
      for (let x = 0; x < bytesPerSampleRow; x++) {
        const left = x >= colors ? out[off + x - colors] : 0;
        out[off + x] = (raw[off + x] + left) & 0xff;
      }
    }
    return out;
  }

  return null;
}

function readPackedSample(
  rowBytes: Uint8Array,
  sampleIndex: number,
  bpc: number
): number {
  if (bpc === 8) return rowBytes[sampleIndex] ?? 0;
  if (bpc === 1) {
    const byte = rowBytes[sampleIndex >> 3] ?? 0;
    return (byte >> (7 - (sampleIndex & 7))) & 1;
  }
  if (bpc === 2) {
    const byte = rowBytes[sampleIndex >> 2] ?? 0;
    return (byte >> (6 - (sampleIndex & 3) * 2)) & 3;
  }
  if (bpc === 4) {
    const byte = rowBytes[sampleIndex >> 1] ?? 0;
    return (sampleIndex & 1) === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
  }
  return 0;
}

function isDefaultDecodeArray(decode: unknown, numComponents: number, maxSampleVal: number): boolean {
  if (!Array.isArray(decode) || decode.length !== numComponents * 2) return true;
  for (let i = 0; i < numComponents; i++) {
    if (Number(decode[i * 2]) !== 0 || Number(decode[i * 2 + 1]) !== maxSampleVal) {
      return false;
    }
  }
  return true;
}

function mapSampleWithDecode(
  rawVal: number,
  maxCode: number,
  decodeArr: number[] | null,
  compIdx: number
): number {
  if (!decodeArr) return Math.round((rawVal / maxCode) * 255);
  const dMin = Number(decodeArr[compIdx * 2]) || 0;
  const dMax = Number(decodeArr[compIdx * 2 + 1]);
  const v = dMin + (rawVal / maxCode) * (dMax - dMin);
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/**
 * Decode single-channel gray/alpha Flate or uncompressed stream via pure TS.
 */
function tryDecodeSingleChannelToGray(
  dict: Record<string, unknown>,
  encodedBytes: Uint8Array,
  objs: Record<string, QpdfJsonObjectEntry>
): Uint8Array | null {
  const filters = normalizeFilterList(dict['/Filter']);
  let inflated: Uint8Array;
  if (filters.length === 0) {
    inflated = encodedBytes;
  } else if (filters.length === 1 && filters[0] === '/FlateDecode') {
    try {
      inflated = pako.inflate(encodedBytes);
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const w = Number(dict['/Width']) || 0;
  const h = Number(dict['/Height']) || 0;
  const bpc = Number(dict['/BitsPerComponent']) || 8;
  if (w <= 0 || h <= 0 || ![1, 2, 4, 8].includes(bpc)) return null;

  const parms = getDecodeParmsDict(objs, dict['/DecodeParms']);
  const predictor = Number(parms?.['/Predictor']) || 1;
  const columns = Number(parms?.['/Columns']) || w;
  const colors = Number(parms?.['/Colors']) || 1;
  const parmsBpc = Number(parms?.['/BitsPerComponent']) || bpc;

  const decoded = applyPredictorDecode(inflated, predictor, columns, colors, parmsBpc, h);
  if (!decoded) return null;

  const rowStride = Math.ceil((w * bpc) / 8);
  if (decoded.length < rowStride * h) return null;

  const decodeArr = Array.isArray(dict['/Decode']) && dict['/Decode'].length === 2
    ? [Number(dict['/Decode'][0]), Number(dict['/Decode'][1])]
    : null;
  const maxCode = (1 << bpc) - 1;

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = decoded.subarray(y * rowStride, y * rowStride + rowStride);
    const outOff = y * w;
    for (let x = 0; x < w; x++) {
      const sample = readPackedSample(row, x, bpc);
      out[outOff + x] = decodeArr
        ? mapSampleWithDecode(sample, maxCode, decodeArr, 0)
        : Math.round((sample / maxCode) * 255);
    }
  }
  return out;
}

/**
 * Pure-TS fast decode path for standard PDF image streams (/DCTDecode RGB/Gray or /FlateDecode/Raw RGB/Gray/Indexed).
 */
async function tryFastDecodeImage(
  objectRef: string,
  dict: Record<string, unknown>,
  rawBytes: Uint8Array,
  objs: Record<string, QpdfJsonObjectEntry>,
  raster: CanvasRasterAdapter,
  allStreams: Map<string, Uint8Array>
): Promise<{
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  minAlpha: number;
} | null> {
  const width = Number(dict['/Width']) || 0;
  const height = Number(dict['/Height']) || 0;
  if (width <= 0 || height <= 0) return null;
  if (dict['/ImageMask'] === true || dict['/Mask']) return null;

  const filters = normalizeFilterList(dict['/Filter']);
  const csResolved = resolveJsonValue(objs, dict['/ColorSpace']);
  const sMaskRef =
    typeof dict['/SMask'] === 'string' && /^\d+\s+\d+\s+R$/.test(dict['/SMask'])
      ? dict['/SMask']
      : undefined;

  // If SMask has /Matte pre-blending, defer to PDF.js universal decoder so matte unblending matches PDF spec
  if (sMaskRef) {
    const smDict = objs[`obj:${sMaskRef}`]?.stream?.dict;
    if (!smDict || smDict['/Matte']) return null;
  }

  let rgbPixels: Uint8ClampedArray | null = null;

  // Path A1: Single /DCTDecode JPEG (/DeviceRGB or /DeviceGray with default /Decode)
  if (filters.length === 1 && filters[0] === '/DCTDecode') {
    if (csResolved !== '/DeviceRGB' && csResolved !== '/DeviceGray') return null;
    if (dict['/Decode'] && !isDefaultDecodeArray(dict['/Decode'], csResolved === '/DeviceRGB' ? 3 : 1, 1)) {
      return null;
    }
    const header = inspectJpegHeader(rawBytes);
    if (!header || header.width !== width || header.height !== height) return null;
    if (csResolved === '/DeviceRGB' && header.numComponents !== 3) return null;
    if (csResolved === '/DeviceGray' && header.numComponents !== 1) return null;
    if (header.hasAdobeTransform && header.adobeTransform === 0 && header.numComponents === 3) {
      // Adobe RGB-marked transform=0 vs standard YCbCr is safe in Chromium, still guard unusual cases
    }

    try {
      const dec = await raster.decodeJpegToRgba(rawBytes);
      if (dec.width !== width || dec.height !== height) return null;
      rgbPixels = dec.rgba;
    } catch {
      return null;
    }
  }

  // Path A2: Single /FlateDecode or Uncompressed (/DeviceRGB, /DeviceGray, /Indexed on RGB/Gray)
  if (!rgbPixels && (filters.length === 0 || (filters.length === 1 && filters[0] === '/FlateDecode'))) {
    const bpc = Number(dict['/BitsPerComponent']) || 8;
    if (![1, 2, 4, 8].includes(bpc)) return null;

    let inflated: Uint8Array;
    if (filters.length === 0) {
      inflated = rawBytes;
    } else {
      try {
        inflated = pako.inflate(rawBytes);
      } catch {
        return null;
      }
    }

    const parms = getDecodeParmsDict(objs, dict['/DecodeParms']);
    const predictor = Number(parms?.['/Predictor']) || 1;
    const columns = Number(parms?.['/Columns']) || width;

    if (csResolved === '/DeviceGray') {
      const colors = Number(parms?.['/Colors']) || 1;
      const decoded = applyPredictorDecode(inflated, predictor, columns, colors, bpc, height);
      if (!decoded) return null;
      const rowStride = Math.ceil((width * bpc) / 8);
      if (decoded.length < rowStride * height) return null;
      const decodeArr = Array.isArray(dict['/Decode']) && dict['/Decode'].length === 2
        ? [Number(dict['/Decode'][0]), Number(dict['/Decode'][1])]
        : null;
      const maxCode = (1 << bpc) - 1;
      rgbPixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const row = decoded.subarray(y * rowStride, y * rowStride + rowStride);
        for (let x = 0; x < width; x++) {
          const s = readPackedSample(row, x, bpc);
          const v = decodeArr
            ? mapSampleWithDecode(s, maxCode, decodeArr, 0)
            : Math.round((s / maxCode) * 255);
          const p = (y * width + x) * 4;
          rgbPixels[p] = v;
          rgbPixels[p + 1] = v;
          rgbPixels[p + 2] = v;
          rgbPixels[p + 3] = 255;
        }
      }
    } else if (csResolved === '/DeviceRGB') {
      const colors = Number(parms?.['/Colors']) || 3;
      const decoded = applyPredictorDecode(inflated, predictor, columns, colors, bpc, height);
      if (!decoded) return null;
      const rowStride = Math.ceil((width * 3 * bpc) / 8);
      if (decoded.length < rowStride * height) return null;
      const decodeArr =
        Array.isArray(dict['/Decode']) && dict['/Decode'].length === 6 && !isDefaultDecodeArray(dict['/Decode'], 3, 1)
          ? (dict['/Decode'] as unknown[]).map((v) => Number(v))
          : null;
      const maxCode = (1 << bpc) - 1;
      rgbPixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const row = decoded.subarray(y * rowStride, y * rowStride + rowStride);
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4;
          if (bpc === 8 && !decodeArr) {
            const s = x * 3;
            rgbPixels[p] = row[s];
            rgbPixels[p + 1] = row[s + 1];
            rgbPixels[p + 2] = row[s + 2];
          } else {
            const s0 = readPackedSample(row, x * 3, bpc);
            const s1 = readPackedSample(row, x * 3 + 1, bpc);
            const s2 = readPackedSample(row, x * 3 + 2, bpc);
            rgbPixels[p] = mapSampleWithDecode(s0, maxCode, decodeArr, 0);
            rgbPixels[p + 1] = mapSampleWithDecode(s1, maxCode, decodeArr, 1);
            rgbPixels[p + 2] = mapSampleWithDecode(s2, maxCode, decodeArr, 2);
          }
          rgbPixels[p + 3] = 255;
        }
      }
    } else if (Array.isArray(csResolved) && csResolved[0] === '/Indexed' && csResolved.length >= 4) {
      const baseCs = resolveJsonValue(objs, csResolved[1]);
      if (baseCs !== '/DeviceRGB' && baseCs !== '/DeviceGray') return null;
      if (dict['/Decode']) return null;

      let lutBytes: Uint8Array | null = null;
      const lutRaw = csResolved[3];
      if (typeof lutRaw === 'string' && /^\d+\s+\d+\s+R$/.test(lutRaw)) {
        lutBytes = allStreams.get(lutRaw) ?? null;
      } else {
        lutBytes = decodeQpdfBinaryString(lutRaw);
      }
      if (!lutBytes) return null;

      const baseComps = baseCs === '/DeviceRGB' ? 3 : 1;
      const hival = Number(csResolved[2]) || 0;
      if (lutBytes.length < (hival + 1) * baseComps) return null;

      const colors = Number(parms?.['/Colors']) || 1;
      const decoded = applyPredictorDecode(inflated, predictor, columns, colors, bpc, height);
      if (!decoded) return null;
      const rowStride = Math.ceil((width * bpc) / 8);
      if (decoded.length < rowStride * height) return null;

      rgbPixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const row = decoded.subarray(y * rowStride, y * rowStride + rowStride);
        for (let x = 0; x < width; x++) {
          const idx = Math.min(hival, readPackedSample(row, x, bpc));
          const p = (y * width + x) * 4;
          if (baseComps === 3) {
            rgbPixels[p] = lutBytes[idx * 3];
            rgbPixels[p + 1] = lutBytes[idx * 3 + 1];
            rgbPixels[p + 2] = lutBytes[idx * 3 + 2];
          } else {
            const g = lutBytes[idx];
            rgbPixels[p] = g;
            rgbPixels[p + 1] = g;
            rgbPixels[p + 2] = g;
          }
          rgbPixels[p + 3] = 255;
        }
      }
    }
  }

  if (!rgbPixels) return null;

  let minAlpha = 255;
  if (sMaskRef) {
    const smDict = objs[`obj:${sMaskRef}`]?.stream?.dict;
    const smRaw = allStreams.get(sMaskRef);
    if (!smDict || !smRaw) return null;
    const smGray = tryDecodeSingleChannelToGray(smDict, smRaw, objs);
    if (!smGray || smGray.length !== width * height) {
      // Wait: if SMask dimensions differ from base image in PDF, defer to PDF.js fallback for exact scaling
      return null;
    }
    for (let i = 0; i < width * height; i++) {
      const a = smGray[i];
      if (a < minAlpha) minAlpha = a;
      rgbPixels[i * 4 + 3] = a;
    }
  }

  void objectRef;
  return { width, height, rgba: rgbPixels, minAlpha };
}

/**
 * Universal fallback decoder using pdf-lib + PDF.js so CMYK, ICCBased, JPXDecode,
 * JBIG2Decode, CCITTFaxDecode, LZWDecode, Lab, Separation, and scaled SMasks decode cleanly.
 */
async function decodeFallbackImagesViaPdfjs(
  workingBytes: Uint8Array,
  targetRefs: string[],
  qpdfJson: QpdfJsonDocument,
  pdfjsLib: typeof pdfjsModule,
  disableWorker: boolean
): Promise<Map<string, { width: number; height: number; rgba: Uint8ClampedArray; minAlpha: number }>> {
  const decoded = new Map<
    string,
    { width: number; height: number; rgba: Uint8ClampedArray; minAlpha: number }
  >();
  if (targetRefs.length === 0) return decoded;

  const objs = qpdfJson.qpdf[1];
  const srcDoc = await PDFDocument.load(workingBytes, { ignoreEncryption: true });

  // Remove original page list cleanly while preserving every object/stream in srcDoc.context
  while (srcDoc.getPageCount() > 0) {
    srcDoc.removePage(0);
  }

  const validRefs: string[] = [];
  for (const refStr of targetRefs) {
    const m = refStr.match(/^(\d+)\s+(\d+)\s+R$/);
    if (!m) continue;
    const dict = objs[`obj:${refStr}`]?.stream?.dict;
    if (!dict) continue;

    const pdfRef = PDFRef.of(Number(m[1]), Number(m[2]));
    const page = srcDoc.addPage([100, 100]);
    page.node.set(
      PDFName.of('Resources'),
      srcDoc.context.obj({
        XObject: { ProbeIm: pdfRef },
      })
    );
    const stream = srcDoc.context.flateStream('q 100 0 0 100 0 0 cm /ProbeIm Do Q');
    page.node.set(PDFName.of('Contents'), srcDoc.context.register(stream));
    validRefs.push(refStr);
  }

  if (validRefs.length === 0) return decoded;

  const probeBytes = await srcDoc.save({ useObjectStreams: false });
  const pdfDoc = await pdfjsLib.getDocument(
    buildWorkerSafePdfjsParams({
      data: probeBytes,
      inWorkerEnvironment: disableWorker,
    })
  ).promise;

  try {
    const OPS = pdfjsLib.OPS;
    for (let pIdx = 0; pIdx < validRefs.length; pIdx++) {
      const refStr = validRefs[pIdx];
      const page = await pdfDoc.getPage(pIdx + 1);
      try {
        const opList = await page.getOperatorList();
        let imgArgName: string | null = null;
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
            const firstArg = opList.argsArray[i]?.[0];
            if (typeof firstArg === 'string') {
              imgArgName = firstArg;
              break;
            }
          }
        }
        if (!imgArgName) continue;

        const imgObj = await new Promise<{
          width: number;
          height: number;
          kind: number;
          data: Uint8Array | Uint8ClampedArray;
        } | null>((resolve) => {
          page.objs.get(imgArgName!, (val: unknown) => {
            resolve((val as { width: number; height: number; kind: number; data: Uint8Array }) ?? null);
          });
        });

        if (!imgObj || !imgObj.data || imgObj.width <= 0 || imgObj.height <= 0) continue;

        const w = imgObj.width;
        const h = imgObj.height;
        const n = w * h;
        const rgba = new Uint8ClampedArray(n * 4);
        let minAlpha = 255;

        if (imgObj.kind === 3 && imgObj.data.length >= n * 4) {
          rgba.set(imgObj.data.subarray(0, n * 4));
          for (let i = 3; i < n * 4; i += 4) {
            if (rgba[i] < minAlpha) minAlpha = rgba[i];
          }
        } else if (imgObj.kind === 2 && imgObj.data.length >= n * 3) {
          const src = imgObj.data;
          for (let i = 0; i < n; i++) {
            rgba[i * 4] = src[i * 3];
            rgba[i * 4 + 1] = src[i * 3 + 1];
            rgba[i * 4 + 2] = src[i * 3 + 2];
            rgba[i * 4 + 3] = 255;
          }
        } else if (imgObj.kind === 1) {
          // GRAYSCALE_1BPP: packed MSB-first bits, 1 = white (255), 0 = black (0)
          const rowBytes = Math.ceil(w / 8);
          const src = imgObj.data;
          if (src.length >= rowBytes * h) {
            for (let y = 0; y < h; y++) {
              const rOff = y * rowBytes;
              for (let x = 0; x < w; x++) {
                const bit = (src[rOff + (x >> 3)] >> (7 - (x & 7))) & 1;
                const v = bit ? 255 : 0;
                const p = (y * w + x) * 4;
                rgba[p] = v;
                rgba[p + 1] = v;
                rgba[p + 2] = v;
                rgba[p + 3] = 255;
              }
            }
          } else {
            continue;
          }
        } else {
          continue;
        }

        decoded.set(refStr, { width: w, height: h, rgba, minAlpha });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdfDoc.destroy().catch(() => {});
  }

  return decoded;
}

export interface PixelClassification {
  kind: 'bilevel' | 'diagram' | 'photo';
  isGrayscale: boolean;
  meanChroma: number;
  colorFrac: number;
}

/**
 * Sample pixels to distinguish scanned B&W text/line-art, flat vector-like diagrams, and continuous-tone photos.
 */
export function classifyRgbaPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): PixelClassification {
  const totalPixels = width * height;
  const maxSamples = 65536;
  const stride = Math.max(1, Math.floor(totalPixels / maxSamples));

  let sampled = 0;
  let coloredCount = 0;
  let chromaSum = 0;
  let extremeBWCount = 0;
  let flatPairs = 0;
  let pairSamples = 0;

  const quantSet = new Set<number>();
  const lumaHist = new Uint32Array(256);

  for (let i = 0; i < totalPixels; i += stride) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const a = rgba[p + 3];

    // Composite over white for classification
    const cr = a >= 253 ? r : Math.round((r * a + 255 * (255 - a)) / 255);
    const cg = a >= 253 ? g : Math.round((g * a + 255 * (255 - a)) / 255);
    const cb = a >= 253 ? b : Math.round((b * a + 255 * (255 - a)) / 255);

    const maxC = cr > cg ? (cr > cb ? cr : cb) : (cg > cb ? cg : cb);
    const minC = cr < cg ? (cr < cb ? cr : cb) : (cg < cb ? cg : cb);
    const chroma = maxC - minC;
    chromaSum += chroma;
    if (chroma > 14) coloredCount++;

    const y = Math.round(0.299 * cr + 0.587 * cg + 0.114 * cb);
    lumaHist[y]++;
    if (y <= 92 || y >= 188) extremeBWCount++;

    if (quantSet.size <= 160) {
      const qKey = ((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3);
      quantSet.add(qKey);
    }

    if ((i % width) + 1 < width) {
      const np = p + 4;
      const dr = Math.abs(rgba[np] - r);
      const dg = Math.abs(rgba[np + 1] - g);
      const db = Math.abs(rgba[np + 2] - b);
      pairSamples++;
      if (dr <= 3 && dg <= 3 && db <= 3) flatPairs++;
    }

    sampled++;
  }

  const meanChroma = sampled > 0 ? chromaSum / sampled : 0;
  const colorFrac = sampled > 0 ? coloredCount / sampled : 0;
  const isGrayscale = colorFrac <= 0.03;
  const flatFrac = pairSamples > 0 ? flatPairs / pairSamples : 0;
  const extremeFrac = sampled > 0 ? extremeBWCount / sampled : 0;

  // Check peak paper background bin (+-18 around brightest peak above 160) & dark stroke presence
  let maxBgPeak = 0;
  let maxBgBin = 255;
  for (let t = 165; t < 256; t++) {
    if (lumaHist[t] > maxBgPeak) {
      maxBgPeak = lumaHist[t];
      maxBgBin = t;
    }
  }
  let nearBgCount = 0;
  for (let t = Math.max(0, maxBgBin - 20); t <= Math.min(255, maxBgBin + 20); t++) {
    nearBgCount += lumaHist[t];
  }
  let midtoneCount = 0;
  for (let t = 95; t <= 180; t++) midtoneCount += lumaHist[t];

  const bgPeakFrac = sampled > 0 ? nearBgCount / sampled : 0;
  const midtoneFrac = sampled > 0 ? midtoneCount / sampled : 0;

  const isBilevel =
    colorFrac <= 0.015 &&
    meanChroma <= 6 &&
    ((extremeFrac >= 0.90 && midtoneFrac <= 0.10) ||
      (bgPeakFrac >= 0.65 && midtoneFrac <= 0.10 && extremeFrac >= 0.85));

  if (isBilevel) {
    return { kind: 'bilevel', isGrayscale: true, meanChroma, colorFrac };
  }

  const isDiagram = quantSet.size <= 96 && flatFrac >= 0.54;
  if (isDiagram) {
    return { kind: 'diagram', isGrayscale, meanChroma, colorFrac };
  }

  return { kind: 'photo', isGrayscale, meanChroma, colorFrac };
}

function encodePngPredictorFlate(
  rawPixelRows: Uint8Array,
  rowByteLen: number,
  height: number,
  bpp: number
): Uint8Array {
  // Try None (0), Sub (1), Up (2), Paeth (4) row filtering via per-row min-SAD adaptive selection (/Predictor 15)
  const stride = rowByteLen + 1;
  const adaptiveBuf = new Uint8Array(stride * height);
  const candidates = [new Uint8Array(rowByteLen), new Uint8Array(rowByteLen), new Uint8Array(rowByteLen), new Uint8Array(rowByteLen), new Uint8Array(rowByteLen)];

  let prevRow: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const currRow = rawPixelRows.subarray(y * rowByteLen, (y + 1) * rowByteLen);
    let bestType = 0;
    let bestSad = Infinity;

    const filterTypes = [0, 1, 2, 4];
    for (const fType of filterTypes) {
      const buf = candidates[fType];
      let sad = 0;
      for (let x = 0; x < rowByteLen; x++) {
        const val = currRow[x];
        const left = x >= bpp ? currRow[x - bpp] : 0;
        const up = prevRow ? prevRow[x] : 0;
        const upLeft = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
        let enc: number;
        if (fType === 0) enc = val;
        else if (fType === 1) enc = (val - left) & 0xff;
        else if (fType === 2) enc = (val - up) & 0xff;
        else enc = (val - paethPredictor(left, up, upLeft)) & 0xff;
        buf[x] = enc;
        sad += enc < 128 ? enc : 256 - enc;
      }
      if (sad < bestSad) {
        bestSad = sad;
        bestType = fType;
      }
    }

    const dstOff = y * stride;
    adaptiveBuf[dstOff] = bestType;
    adaptiveBuf.set(candidates[bestType], dstOff + 1);
    prevRow = currRow;
  }

  return pako.deflate(adaptiveBuf, { level: 9 });
}

function tryEncodeLosslessIndexedFlate(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { bytes: Uint8Array; dict: Record<string, unknown> } | null {
  const n = width * height;
  const colorToIdx = new Map<number, number>();
  const paletteRgb: number[] = [];
  const indices = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    let idx = colorToIdx.get(key);
    if (idx === undefined) {
      idx = paletteRgb.length / 3;
      if (idx >= 256) return null;
      colorToIdx.set(key, idx);
      paletteRgb.push(rgba[p], rgba[p + 1], rgba[p + 2]);
    }
    indices[i] = idx;
  }

  const numColors = paletteRgb.length / 3;
  const bpc = numColors <= 2 ? 1 : numColors <= 4 ? 2 : numColors <= 16 ? 4 : 8;
  const rowByteLen = Math.ceil((width * bpc) / 8);
  const packed = new Uint8Array(rowByteLen * height);

  if (bpc === 8) {
    packed.set(indices);
  } else {
    const shiftStep = bpc;
    const perByte = 8 / bpc;
    for (let y = 0; y < height; y++) {
      const rOff = y * rowByteLen;
      const srcOff = y * width;
      for (let x = 0; x < width; x++) {
        const idx = indices[srcOff + x];
        const byteIdx = rOff + Math.floor(x / perByte);
        const bitPos = (perByte - 1 - (x % perByte)) * shiftStep;
        packed[byteIdx] |= idx << bitPos;
      }
    }
  }

  const compressed = encodePngPredictorFlate(packed, rowByteLen, height, 1);
  const lutHex =
    'b:' + paletteRgb.map((v) => v.toString(16).padStart(2, '0')).join('');

  return {
    bytes: compressed,
    dict: {
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': width,
      '/Height': height,
      '/BitsPerComponent': bpc,
      '/ColorSpace': ['/Indexed', '/DeviceRGB', numColors - 1, lutHex],
      '/Filter': '/FlateDecode',
      '/DecodeParms': {
        '/Predictor': 15,
        '/Colors': 1,
        '/BitsPerComponent': bpc,
        '/Columns': width,
      },
    },
  };
}

function encodeLosslessRawPredictorFlate(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  isGrayscale: boolean
): { bytes: Uint8Array; dict: Record<string, unknown> } {
  const n = width * height;
  const colors = isGrayscale ? 1 : 3;
  const rowByteLen = width * colors;
  const raw = new Uint8Array(rowByteLen * height);

  if (isGrayscale) {
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      raw[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      raw[i * 3] = rgba[p];
      raw[i * 3 + 1] = rgba[p + 1];
      raw[i * 3 + 2] = rgba[p + 2];
    }
  }

  const compressed = encodePngPredictorFlate(raw, rowByteLen, height, colors);
  return {
    bytes: compressed,
    dict: {
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': width,
      '/Height': height,
      '/BitsPerComponent': 8,
      '/ColorSpace': isGrayscale ? '/DeviceGray' : '/DeviceRGB',
      '/Filter': '/FlateDecode',
      '/DecodeParms': {
        '/Predictor': 15,
        '/Colors': colors,
        '/BitsPerComponent': 8,
        '/Columns': width,
      },
    },
  };
}

function extractSMaskAlphaBytes(rgba: Uint8ClampedArray, width: number, height: number): {
  bytes: Uint8Array;
  dict: Record<string, unknown>;
} {
  const n = width * height;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3];
  const compressed = encodePngPredictorFlate(alpha, width, height, 1);
  return {
    bytes: compressed,
    dict: {
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': width,
      '/Height': height,
      '/BitsPerComponent': 8,
      '/ColorSpace': '/DeviceGray',
      '/Filter': '/FlateDecode',
      '/DecodeParms': {
        '/Predictor': 15,
        '/Colors': 1,
        '/BitsPerComponent': 8,
        '/Columns': width,
      },
    },
  };
}

/**
 * Strip alpha and composite over pure white so JPEG & CCITT G4 encoders never encode black halo around semi-transparent/opaque edges.
 */
function flattenRgbaOverWhite(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a >= 255) {
      out[i] = rgba[i];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i + 2];
      out[i + 3] = 255;
    } else if (a === 0) {
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = 255;
    } else {
      const inv = 255 - a;
      out[i] = Math.round((rgba[i] * a + 255 * inv) / 255);
      out[i + 1] = Math.round((rgba[i + 1] * a + 255 * inv) / 255);
      out[i + 2] = Math.round((rgba[i + 2] * a + 255 * inv) / 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Extract pure RGB into RGBA with opaque 255 alpha so SMask stays independent of RGB colors.
 */
function toOpaqueRgbRgba(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

function convertRgbaToGrayscaleRgb(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const y = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    out[i] = y;
    out[i + 1] = y;
    out[i + 2] = y;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

function encodeBilevelCcittG4(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { bytes: Uint8Array; dict: Record<string, unknown> } {
  const n = width * height;
  const luma = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = rgba[p + 3];
    const r = a >= 253 ? rgba[p] : Math.round((rgba[p] * a + 255 * (255 - a)) / 255);
    const g = a >= 253 ? rgba[p + 1] : Math.round((rgba[p + 1] * a + 255 * (255 - a)) / 255);
    const b = a >= 253 ? rgba[p + 2] : Math.round((rgba[p + 2] * a + 255 * (255 - a)) / 255);
    luma[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  const threshold = computeOtsuThreshold(luma);
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // CCITT /BlackIs1 false -> 0 = white, 1 = black
    binary[i] = luma[i] < threshold ? 1 : 0;
  }
  const ccittBytes = encodeCcittGroup4(binary, width, height);
  return {
    bytes: ccittBytes,
    dict: {
      '/Type': '/XObject',
      '/Subtype': '/Image',
      '/Width': width,
      '/Height': height,
      '/BitsPerComponent': 1,
      '/ColorSpace': '/DeviceGray',
      '/Filter': '/CCITTFaxDecode',
      '/DecodeParms': {
        '/K': -1,
        '/Columns': width,
        '/Rows': height,
        '/BlackIs1': false,
      },
    },
  };
}

function preserveStructuralKeys(
  origDict: Record<string, unknown>,
  nextDict: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...nextDict };
  if (origDict['/OC'] !== undefined) merged['/OC'] = origDict['/OC'];
  if (origDict['/StructParent'] !== undefined) merged['/StructParent'] = origDict['/StructParent'];
  if (origDict['/Interpolate'] !== undefined) merged['/Interpolate'] = origDict['/Interpolate'];
  return merged;
}

function computeCanonicalImageHash(
  dict: Record<string, unknown>,
  streamBytes: Uint8Array | undefined,
  sMaskBytes: Uint8Array | undefined,
  sMaskRef: string | undefined
): string {
  const keyDict = {
    w: dict['/Width'],
    h: dict['/Height'],
    bpc: dict['/BitsPerComponent'],
    cs: dict['/ColorSpace'],
    f: dict['/Filter'],
    dp: dict['/DecodeParms'],
    dec: dict['/Decode'],
    im: dict['/ImageMask'],
    m: dict['/Mask'],
    oc: dict['/OC'],
  };
  const hMain = streamBytes ? fnv1aHashBytes(streamBytes) : 'empty';
  const hMask = sMaskRef ? `sm:${sMaskBytes ? fnv1aHashBytes(sMaskBytes) : sMaskRef}` : 'nosm';
  return `${JSON.stringify(keyDict)}|${hMain}|${hMask}`;
}

/**
 * Optimize all unique embedded image XObjects intelligently while strictly guaranteeing:
 * - Zero upscaling, zero distortion on shared multi-size placements (uses max displayed dimensions / min effective DPI)
 * - Bilevel CCITT G4, lossless Indexed/Predictor Flate diagrams, high-quality/grayscale/progressive-mipmap JPEG
 * - Full /SMask transparency preservation (or opaque mask pruning)
 * - Strict byte-size guard (never replaces an image unless strictly smaller)
 */
export async function optimizeEmbeddedImages(
  context: AnalyzedPdfContext,
  settings: CompressionSettings,
  options: {
    raster?: CanvasRasterAdapter;
    pdfjsLibInstance?: typeof pdfjsModule;
    disablePdfjsWorker?: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<ImageOptimizationSummary> {
  const raster = options.raster ?? createBrowserRasterAdapter();
  const pdfjs = options.pdfjsLibInstance ?? pdfjsModule;
  const disableWorker = options.disablePdfjsWorker ?? false;

  const objs = context.qpdfJson.qpdf[1];
  const images = context.summary.images;
  const resultsByRef = new Map<string, OptimizedImageResult>();

  // Track which base images reference each SMask & Indexed LUT stream
  const sMaskOwners = new Map<string, string[]>();
  const neededExtraRefs = new Set<string>();
  const rawStreams = new Map(context.rawImageStreams);

  for (const img of images) {
    const dict = objs[`obj:${img.objectRef}`]?.stream?.dict;
    if (!dict) continue;
    if (img.sMaskRef) {
      const arr = sMaskOwners.get(img.sMaskRef);
      if (arr) arr.push(img.objectRef);
      else sMaskOwners.set(img.sMaskRef, [img.objectRef]);
      if (!rawStreams.has(img.sMaskRef)) neededExtraRefs.add(img.sMaskRef);
    }
    const cs = resolveJsonValue(objs, dict['/ColorSpace']);
    if (Array.isArray(cs) && cs[0] === '/Indexed' && typeof cs[3] === 'string' && /^\d+\s+\d+\s+R$/.test(cs[3])) {
      neededExtraRefs.add(cs[3]);
    }
  }

  if (neededExtraRefs.size > 0) {
    // Extract Indexed LUT streams uncompressed via generalized decodeLevel, and SMask raw streams
    const smaskIds = new Set<string>();
    const lutIds = new Set<string>();
    for (const ref of neededExtraRefs) {
      if (sMaskOwners.has(ref)) smaskIds.add(ref);
      else lutIds.add(ref);
    }
    if (smaskIds.size > 0) {
      const extractedSmasks = await extractSpecificStreamsWithQpdf(context.workingBytes, smaskIds, 'none');
      for (const [k, v] of extractedSmasks) rawStreams.set(k, v);
    }
    if (lutIds.size > 0) {
      const extractedLuts = await extractSpecificStreamsWithQpdf(context.workingBytes, lutIds, 'generalized');
      for (const [k, v] of extractedLuts) rawStreams.set(k, v);
    }
  }

  const checkCancelled = () => {
    if (options.signal?.aborted) {
      throw new Error('CANCELLED');
    }
  };

  // Pre-decode pass: fast TS/WebCodec path first, collect any remaining images for batch PDF.js universal decode
  interface DecodedCandidate {
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
    minAlpha: number;
  }
  const fastDecoded = new Map<string, DecodedCandidate>();
  const fallbackRefs: string[] = [];

  for (let idx = 0; idx < images.length; idx++) {
    checkCancelled();
    const img = images[idx];
    const dict = objs[`obj:${img.objectRef}`]?.stream?.dict;
    const raw = rawStreams.get(img.objectRef);

    if (!dict || !raw) {
      continue;
    }

    // Handle stencil ImageMask or color-keyed explicit Mask conservatively (keep losslessly intact unless raw uncompressed stencil mask)
    if (img.isImageMask || img.hasExplicitMask) {
      continue;
    }

    // Quick skip optimization check before decoding:
    // If JPEG in Low mode without excessive DPI -> avoid wasted decode when clearly optimal!
    const isJpeg = img.filter === 'DCTDecode';
    const minEffDpi = img.minEffectiveDpi;
    const canDownsampleStandard =
      minEffDpi !== null && minEffDpi > settings.targetDpi * settings.minDownsampleDpiRatio;
    const canDownsampleMono =
      minEffDpi !== null &&
      settings.useCcittGroup4ForBilevel &&
      minEffDpi > settings.monochromeTargetDpi * settings.minDownsampleDpiRatio;
    const needsBilevelCheck =
      settings.useCcittGroup4ForBilevel && (img.bitsPerComponent === 1 || img.colorSpace === 'DeviceGray');

    if (
      isJpeg &&
      !canDownsampleStandard &&
      !canDownsampleMono &&
      !needsBilevelCheck &&
      !img.hasSMask &&
      (!settings.recompressExistingJpeg ||
        (raw.length * 8) / (img.widthPx * img.heightPx) <= settings.alreadyOptimizedJpegMaxBpp)
    ) {
      continue;
    }

    const res = await tryFastDecodeImage(img.objectRef, dict, raw, objs, raster, rawStreams);
    if (res) {
      fastDecoded.set(img.objectRef, res);
    } else {
      fallbackRefs.push(img.objectRef);
    }
  }

  let fallbackDecoded = new Map<string, DecodedCandidate>();
  if (fallbackRefs.length > 0) {
    options.onProgress?.(40, `Decoding ${fallbackRefs.length} specialized embedded image${fallbackRefs.length > 1 ? 's' : ''}...`);
    fallbackDecoded = await decodeFallbackImagesViaPdfjs(
      context.workingBytes,
      fallbackRefs,
      context.qpdfJson,
      pdfjs,
      disableWorker
    ).catch((err) => {
      console.warn('Fallback image decode warning:', err);
      return new Map<string, DecodedCandidate>();
    });
  }

  let optimizedCount = 0;
  let downsampledCount = 0;
  let convertedToCcittCount = 0;
  let convertedToGrayscaleCount = 0;
  let droppedOpaqueSmaskCount = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  // Optimize each unique image XObject
  for (let idx = 0; idx < images.length; idx++) {
    checkCancelled();
    const img = images[idx];
    const dict = objs[`obj:${img.objectRef}`]?.stream?.dict ?? {};
    const origRaw = rawStreams.get(img.objectRef);
    const origBaseBytes = origRaw?.length ?? img.encodedBytes;
    const origSMaskRaw = img.sMaskRef ? rawStreams.get(img.sMaskRef) : undefined;
    const sMaskOwnerList = img.sMaskRef ? sMaskOwners.get(img.sMaskRef) ?? [] : [];
    const sMaskSoleOwner = img.sMaskRef ? sMaskOwnerList.length === 1 : false;
    const origMaskBytes = sMaskSoleOwner && origSMaskRaw ? origSMaskRaw.length : 0;
    const origCombinedBytes = origBaseBytes + origMaskBytes;

    bytesBefore += origBaseBytes;

    if (images.length > 0 && (idx === 0 || idx % 4 === 0 || idx === images.length - 1)) {
      const pct = 42 + Math.round(((idx + 1) / images.length) * 35);
      options.onProgress?.(pct, `Optimizing image ${idx + 1} of ${images.length}...`);
    }

    const decoded = fastDecoded.get(img.objectRef) ?? fallbackDecoded.get(img.objectRef);
    if (!decoded || !origRaw) {
      // Stencil mask, color-keyed mask, or skipped optimal JPEG
      const keptReason: ImageOptimizationAction =
        img.isImageMask || img.hasExplicitMask ? 'kept-mask-lossless' : 'kept-already-optimized';
      bytesAfter += origBaseBytes;
      resultsByRef.set(img.objectRef, {
        objectRef: img.objectRef,
        action: keptReason,
        originalWidthPx: img.widthPx,
        originalHeightPx: img.heightPx,
        newWidthPx: img.widthPx,
        newHeightPx: img.heightPx,
        originalBytes: origBaseBytes,
        newBytes: origBaseBytes,
        canonicalContentHash: computeCanonicalImageHash(dict, origRaw, origSMaskRaw, img.sMaskRef),
      });
      continue;
    }

    const { width: srcW, height: srcH, rgba: srcRgba, minAlpha } = decoded;
    const hasMeaningfulAlpha = img.hasSMask && minAlpha < 253;
    const canDropOpaqueSMask = img.hasSMask && minAlpha >= 253;
    const isAlreadyJpeg = img.filter === 'DCTDecode';

    // Classify pixels (photo / diagram / bilevel)
    const pixelClass = classifyRgbaPixels(srcRgba, srcW, srcH);

    // Determine target DPI & whether downsampling is warranted
    const useCcitt =
      pixelClass.kind === 'bilevel' &&
      settings.useCcittGroup4ForBilevel &&
      !hasMeaningfulAlpha;

    const targetDpiForImg = useCcitt ? settings.monochromeTargetDpi : settings.targetDpi;
    const minEffDpi = img.minEffectiveDpi;
    let targetW = srcW;
    let targetH = srcH;
    let isDownsampled = false;

    // Never shrink conflicting shared SMasks to incompatible dimensions
    const sharedSMaskConflict = img.sMaskRef && !sMaskSoleOwner && hasMeaningfulAlpha;
    // Flat/crisp UI diagrams suffer blur + palette explosion from mild bilinear downsampling; require larger excess DPI
    const effectiveRatioGuard =
      pixelClass.kind === 'diagram'
        ? Math.max(settings.minDownsampleDpiRatio, settings.mode === 'extreme' ? 1.25 : 1.5)
        : settings.minDownsampleDpiRatio;

    if (
      !sharedSMaskConflict &&
      minEffDpi !== null &&
      minEffDpi > targetDpiForImg * effectiveRatioGuard
    ) {
      const scale = Math.min(1, targetDpiForImg / minEffDpi);
      if (scale < 0.94) {
        const candW = Math.max(1, Math.round(srcW * scale));
        const candH = Math.max(1, Math.round(srcH * scale));
        if (candW < srcW || candH < srcH) {
          targetW = candW;
          targetH = candH;
          isDownsampled = true;
        }
      }
    }

    // Resample pixels if target dims shrunk
    const workingRgba =
      isDownsampled
        ? await raster.resampleRgba(srcRgba, srcW, srcH, targetW, targetH)
        : srcRgba;

    // Re-evaluate bilevel on downsampled canvas ONLY for clean text/bilevel candidates
    interface EncodedOption {
      action: ImageOptimizationAction;
      bytes: Uint8Array;
      dict: Record<string, unknown>;
      sMaskAction: 'unchanged' | 'dropped' | 'updated';
      sMaskBytes?: Uint8Array;
      sMaskDict?: Record<string, unknown>;
      isLossy: boolean;
      didConvertGray?: boolean;
    }

    const candidates: EncodedOption[] = [];

    // Helper for SMask attachment when transparent
    const buildAlphaPayload = (): {
      sMaskAction: 'unchanged' | 'dropped' | 'updated';
      sMaskRefToSet?: string;
      sMaskBytes?: Uint8Array;
      sMaskDict?: Record<string, unknown>;
      extraBytes: number;
    } => {
      if (!img.hasSMask) {
        return { sMaskAction: 'unchanged', extraBytes: 0 };
      }
      if (canDropOpaqueSMask) {
        return { sMaskAction: 'dropped', extraBytes: 0 };
      }
      if (isDownsampled && sMaskSoleOwner) {
        const alphaOut = extractSMaskAlphaBytes(workingRgba, targetW, targetH);
        return {
          sMaskAction: 'updated',
          sMaskRefToSet: img.sMaskRef,
          sMaskBytes: alphaOut.bytes,
          sMaskDict: alphaOut.dict,
          extraBytes: alphaOut.bytes.length,
        };
      }
      if (!isDownsampled && sMaskSoleOwner && origMaskBytes > 0) {
        const alphaOut = extractSMaskAlphaBytes(workingRgba, targetW, targetH);
        if (alphaOut.bytes.length < origMaskBytes) {
          return {
            sMaskAction: 'updated',
            sMaskRefToSet: img.sMaskRef,
            sMaskBytes: alphaOut.bytes,
            sMaskDict: alphaOut.dict,
            extraBytes: alphaOut.bytes.length,
          };
        }
      }
      return {
        sMaskAction: 'unchanged',
        sMaskRefToSet: img.sMaskRef,
        extraBytes: origMaskBytes,
      };
    };

    const alphaPlan = buildAlphaPayload();

    // Candidate A: CCITT Group 4 (bilevel monochrome scans/text pages)
    if (useCcitt) {
      const ccittOut = encodeBilevelCcittG4(workingRgba, targetW, targetH);
      candidates.push({
        action: 'converted-ccitt-g4',
        bytes: ccittOut.bytes,
        dict: preserveStructuralKeys(dict, ccittOut.dict),
        sMaskAction: canDropOpaqueSMask ? 'dropped' : 'unchanged',
        isLossy: !isDownsampled && img.bitsPerComponent === 1 ? false : true,
      });
    }

    // Candidate B: Lossless Indexed / PNG-Predictor Flate (for crisp diagrams/screenshots/charts, or crisp B&W when CCITT G4 disabled)
    if (
      (pixelClass.kind === 'diagram' || (pixelClass.kind === 'bilevel' && !useCcitt)) &&
      settings.useLosslessDiagramCompression
    ) {
      const indexed = tryEncodeLosslessIndexedFlate(workingRgba, targetW, targetH);
      if (indexed) {
        const d = preserveStructuralKeys(dict, {
          ...indexed.dict,
          ...(alphaPlan.sMaskRefToSet ? { '/SMask': alphaPlan.sMaskRefToSet } : {}),
        });
        candidates.push({
          action: 'lossless-indexed-flate',
          bytes: indexed.bytes,
          dict: d,
          sMaskAction: alphaPlan.sMaskAction,
          sMaskBytes: alphaPlan.sMaskBytes,
          sMaskDict: alphaPlan.sMaskDict,
          isLossy: false,
        });
      } else if (pixelClass.kind === 'diagram') {
        const rawPred = encodeLosslessRawPredictorFlate(
          workingRgba,
          targetW,
          targetH,
          pixelClass.isGrayscale
        );
        const d = preserveStructuralKeys(dict, {
          ...rawPred.dict,
          ...(alphaPlan.sMaskRefToSet ? { '/SMask': alphaPlan.sMaskRefToSet } : {}),
        });
        candidates.push({
          action: 'lossless-flate-predictor',
          bytes: rawPred.bytes,
          dict: d,
          sMaskAction: alphaPlan.sMaskAction,
          sMaskBytes: alphaPlan.sMaskBytes,
          sMaskDict: alphaPlan.sMaskDict,
          isLossy: false,
        });
      }
    }

    // Candidate C: JPEG (Photographic / Scanned / Fallback heavy diagrams in Extreme mode)
    const shouldTryJpeg =
      pixelClass.kind === 'photo' ||
      (pixelClass.kind === 'bilevel' && !useCcitt) ||
      (pixelClass.kind === 'diagram' &&
        (!settings.useLosslessDiagramCompression ||
          (settings.allowLossyForHeavyDiagrams && origBaseBytes > 80 * 1024)));

    if (shouldTryJpeg) {
      const existingBpp = (origBaseBytes * 8) / Math.max(1, srcW * srcH);
      const allowJpegEncode =
        isDownsampled ||
        !isAlreadyJpeg ||
        (settings.recompressExistingJpeg && existingBpp > settings.alreadyOptimizedJpegMaxBpp);

      if (allowJpegEncode) {
        const convertGray =
          pixelClass.isGrayscale ||
          (settings.convertSuitableScansToGrayscale &&
            pixelClass.colorFrac <= 0.04 &&
            pixelClass.meanChroma <= 14);

        let rgbSource = hasMeaningfulAlpha
          ? toOpaqueRgbRgba(workingRgba)
          : flattenRgbaOverWhite(workingRgba);
        if (convertGray) {
          rgbSource = convertRgbaToGrayscaleRgb(rgbSource);
        }

        const jpegBytes = await raster.encodeRgbaToJpeg(
          rgbSource,
          targetW,
          targetH,
          settings.jpegQuality / 100
        );
        const jpegHeader = inspectJpegHeader(jpegBytes);
        const jpegColorSpace =
          jpegHeader?.numComponents === 1 ? '/DeviceGray' : '/DeviceRGB';

        const jpegDict = preserveStructuralKeys(dict, {
          '/Type': '/XObject',
          '/Subtype': '/Image',
          '/Width': targetW,
          '/Height': targetH,
          '/BitsPerComponent': 8,
          '/ColorSpace': jpegColorSpace,
          '/Filter': '/DCTDecode',
          ...(alphaPlan.sMaskRefToSet ? { '/SMask': alphaPlan.sMaskRefToSet } : {}),
        });

        const didConvertGray = convertGray && !img.colorSpace.includes('Gray');
        let action: ImageOptimizationAction = 'recompressed-jpeg';
        if (isDownsampled) action = 'downsampled-jpeg';
        else if (didConvertGray) action = 'converted-grayscale-jpeg';

        candidates.push({
          action,
          bytes: jpegBytes,
          dict: jpegDict,
          sMaskAction: alphaPlan.sMaskAction,
          sMaskBytes: alphaPlan.sMaskBytes,
          sMaskDict: alphaPlan.sMaskDict,
          isLossy: true,
          didConvertGray,
        });
      }
    }

    // Also try SMask-only lossless Flate predictor improvement if transparent & SMask kept unchanged at same size
    if (
      canDropOpaqueSMask &&
      candidates.length === 0 &&
      isAlreadyJpeg
    ) {
      // Drop opaque SMask WITHOUT touching the JPEG stream bytes at all!
      const newDict = { ...dict };
      delete newDict['/SMask'];
      candidates.push({
        action: 'dropped-redundant-smask',
        bytes: origRaw,
        dict: newDict,
        sMaskAction: 'dropped',
        isLossy: false,
      });
    }

    // Pick strictly smallest valid candidate that actually beats original combined bytes
    let best: EncodedOption | null = null;
    let bestTotalBytes = origCombinedBytes;

    for (const cand of candidates) {
      const candMaskCost =
        cand.sMaskAction === 'dropped'
          ? 0
          : cand.sMaskBytes
            ? cand.sMaskBytes.length
            : origMaskBytes;
      const candTotalBytes = cand.bytes.length + candMaskCost;

      if (candTotalBytes >= bestTotalBytes) continue;

      // Require minimum meaningful savings when replacing an existing JPEG at identical dimensions
      if (
        isAlreadyJpeg &&
        !isDownsampled &&
        cand.isLossy &&
        cand.action !== 'dropped-redundant-smask'
      ) {
        const savingsRatio = (origCombinedBytes - candTotalBytes) / Math.max(1, origCombinedBytes);
        if (savingsRatio < settings.minLossyReplacementSavingsRatio) {
          continue;
        }
      }

      // In Low/Recommended modes, don't let Extreme-style lossy diagram overwrite unless it's a huge win
      if (
        pixelClass.kind === 'diagram' &&
        cand.isLossy &&
        settings.useLosslessDiagramCompression &&
        origCombinedBytes > 0
      ) {
        const losslessBest = candidates.find((c) => !c.isLossy);
        if (losslessBest) {
          const losslessCost =
            losslessBest.bytes.length +
            (losslessBest.sMaskAction === 'dropped'
              ? 0
              : losslessBest.sMaskBytes
                ? losslessBest.sMaskBytes.length
                : origMaskBytes);
          if (candTotalBytes > losslessCost * 0.55) {
            continue;
          }
        }
      }

      best = cand;
      bestTotalBytes = candTotalBytes;
    }

    if (best) {
      optimizedCount++;
      if (isDownsampled) downsampledCount++;
      if (best.action === 'converted-ccitt-g4') convertedToCcittCount++;
      if (best.action === 'converted-grayscale-jpeg' || best.didConvertGray) {
        convertedToGrayscaleCount++;
      }
      if (best.sMaskAction === 'dropped') droppedOpaqueSmaskCount++;

      bytesAfter += best.bytes.length;
      const effectiveMaskBytes =
        best.sMaskAction === 'dropped'
          ? undefined
          : best.sMaskBytes ?? origSMaskRaw;
      const effectiveMaskRef = best.sMaskAction === 'dropped' ? undefined : img.sMaskRef;

      resultsByRef.set(img.objectRef, {
        objectRef: img.objectRef,
        action: best.action,
        originalWidthPx: srcW,
        originalHeightPx: srcH,
        newWidthPx: targetW,
        newHeightPx: targetH,
        originalBytes: origBaseBytes,
        newBytes: best.bytes.length,
        replacedDict: best.dict,
        replacedBytes: best.bytes,
        sMaskAction: best.sMaskAction,
        sMaskRef: img.sMaskRef,
        replacedSMaskDict: best.sMaskDict,
        replacedSMaskBytes: best.sMaskBytes,
        canonicalContentHash: computeCanonicalImageHash(
          best.dict,
          best.bytes,
          effectiveMaskBytes,
          effectiveMaskRef
        ),
      });
    } else {
      bytesAfter += origBaseBytes;
      resultsByRef.set(img.objectRef, {
        objectRef: img.objectRef,
        action: isAlreadyJpeg ? 'kept-already-optimized' : 'kept-original',
        originalWidthPx: srcW,
        originalHeightPx: srcH,
        newWidthPx: srcW,
        newHeightPx: srcH,
        originalBytes: origBaseBytes,
        newBytes: origBaseBytes,
        canonicalContentHash: computeCanonicalImageHash(dict, origRaw, origSMaskRaw, img.sMaskRef),
      });
    }
  }

  return {
    resultsByRef,
    optimizedCount,
    downsampledCount,
    convertedToCcittCount,
    convertedToGrayscaleCount,
    droppedOpaqueSmaskCount,
    bytesBefore,
    bytesAfter,
  };
}
