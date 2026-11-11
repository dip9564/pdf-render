import { pdfjsLib } from '@/lib/pdfWorker';
import { StructuredImage } from './types';

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

function dataUrlToUint8Array(dataUrl: string): Uint8Array | null {
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function resolvePdfObj(page: any, keyOrObj: any): Promise<any> {
  if (!keyOrObj) return Promise.resolve(null);
  if (typeof keyOrObj === 'object' && (keyOrObj.data || keyOrObj.bitmap)) {
    return Promise.resolve(keyOrObj);
  }
  if (typeof keyOrObj !== 'string') {
    return Promise.resolve(keyOrObj);
  }
  return new Promise((resolve) => {
    try {
      if (keyOrObj.startsWith('g_') && page.commonObjs?.has?.(keyOrObj)) {
        resolve(page.commonObjs.get(keyOrObj));
        return;
      }
      if (page.objs?.has?.(keyOrObj)) {
        page.objs.get(keyOrObj, (obj: any) => resolve(obj));
        return;
      }
      page.objs.get(keyOrObj, (obj: any) => resolve(obj));
    } catch {
      resolve(null);
    }
  });
}

function encodePdfImageObjectToPng(imgObj: any, isMask: boolean = false): Uint8Array | null {
  if (typeof document === 'undefined' || !imgObj) return null;
  const imgW = imgObj.width;
  const imgH = imgObj.height;
  if (!imgW || !imgH || imgW < 12 || imgH < 12) return null;

  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (imgObj.bitmap) {
    ctx.drawImage(imgObj.bitmap, 0, 0);
  } else if (imgObj.data) {
    const raw = imgObj.data;
    const imgData = ctx.createImageData(imgW, imgH);
    const dst = imgData.data;

    if (raw.length === imgW * imgH * 4) {
      dst.set(raw);
    } else if (raw.length === imgW * imgH * 3) {
      let srcIdx = 0;
      let dstIdx = 0;
      while (srcIdx < raw.length && dstIdx < dst.length) {
        dst[dstIdx] = raw[srcIdx];
        dst[dstIdx + 1] = raw[srcIdx + 1];
        dst[dstIdx + 2] = raw[srcIdx + 2];
        dst[dstIdx + 3] = 255;
        srcIdx += 3;
        dstIdx += 4;
      }
    } else if (raw.length === imgW * imgH) {
      for (let p = 0; p < raw.length; p++) {
        const val = isMask ? (raw[p] > 0 ? 0 : 255) : raw[p];
        const dstIdx = p * 4;
        dst[dstIdx] = val;
        dst[dstIdx + 1] = val;
        dst[dstIdx + 2] = val;
        dst[dstIdx + 3] = 255;
      }
    } else {
      // Handle 1bpp packed bitmask / GRAYSCALE_1BPP
      const rowBytes = Math.ceil(imgW / 8);
      if (raw.length >= rowBytes * imgH) {
        for (let y = 0; y < imgH; y++) {
          for (let x = 0; x < imgW; x++) {
            const byteVal = raw[y * rowBytes + (x >> 3)];
            const bit = (byteVal >> (7 - (x & 7))) & 1;
            const c = isMask ? (bit ? 0 : 255) : bit ? 255 : 0;
            const dstIdx = (y * imgW + x) * 4;
            dst[dstIdx] = c;
            dst[dstIdx + 1] = c;
            dst[dstIdx + 2] = c;
            dst[dstIdx + 3] = 255;
          }
        }
      } else {
        return null;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    return null;
  }

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

/**
 * Extracts raster images embedded on a PDF page with accurate CTM & Form XObject coordinate tracking
 */
export async function extractImagesFromPage(
  page: any,
  viewport: any
): Promise<StructuredImage[]> {
  const images: StructuredImage[] = [];

  try {
    const operatorList = await page.getOperatorList();
    if (
      !operatorList ||
      !Array.isArray(operatorList.fnArray) ||
      !Array.isArray(operatorList.argsArray)
    ) {
      return images;
    }
    const { fnArray, argsArray } = operatorList;
    const OPS = pdfjsLib.OPS;

    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack: number[][] = [];

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === OPS.save) {
        ctmStack.push([...ctm]);
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop()!;
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiplyCtm(ctm, args);
      } else if (fn === OPS.paintFormXObjectBegin) {
        ctmStack.push([...ctm]);
        const matrix = Array.isArray(args?.[0]) ? args[0] : null;
        if (matrix && matrix.length >= 6) {
          ctm = multiplyCtm(ctm, matrix);
        }
      } else if (fn === OPS.paintFormXObjectEnd) {
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop()!;
        }
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject
      ) {
        try {
          const isMask = fn === OPS.paintImageMaskXObject;
          const imgObj =
            fn === OPS.paintInlineImageXObject
              ? args[0]
              : isMask
              ? await resolvePdfObj(page, args?.[0]?.data || args?.[0])
              : await resolvePdfObj(page, args?.[0]);

          if (imgObj && (imgObj.data || imgObj.bitmap)) {
            const pngBytes = encodePdfImageObjectToPng(imgObj, isMask);
            if (!pngBytes) continue;

            // Compute exact axis-aligned bounds of unit image quad [0,1]x[0,1] after CTM
            const p00 = applyCtmPoint(ctm, 0, 0);
            const p10 = applyCtmPoint(ctm, 1, 0);
            const p01 = applyCtmPoint(ctm, 0, 1);
            const p11 = applyCtmPoint(ctm, 1, 1);

            const minX = Math.min(p00[0], p10[0], p01[0], p11[0]);
            const maxX = Math.max(p00[0], p10[0], p01[0], p11[0]);
            const minY = Math.min(p00[1], p10[1], p01[1], p11[1]);
            const maxY = Math.max(p00[1], p10[1], p01[1], p11[1]);

            const renderedWidth = Math.round(maxX - minX) || imgObj.width;
            const renderedHeight = Math.round(maxY - minY) || imgObj.height;

            // Skip tiny UI bullet/decoration bitmaps
            if (renderedWidth < 14 || renderedHeight < 14) continue;

            const posX = Math.round(minX);
            const posY = Math.round(minY);
            const pageWidth = viewport.width;

            let alignment: 'left' | 'center' | 'right' = 'left';
            const centerX = posX + renderedWidth / 2;
            if (Math.abs(centerX - pageWidth / 2) < 42) {
              alignment = 'center';
            } else if (posX > pageWidth * 0.5) {
              alignment = 'right';
            }

            const widthPt = Math.min(renderedWidth, 510);
            const aspectScale = renderedWidth > 0 ? widthPt / renderedWidth : 1;
            const heightPt = Math.min(Math.round(renderedHeight * aspectScale), 680);

            images.push({
              type: 'image',
              data: pngBytes,
              widthPt,
              heightPt,
              xPt: posX,
              yPt: posY,
              alignment,
              yTopPt: maxY,
              yBottomPt: minY,
            });
          }
        } catch {
          // ignore individual image decode issues
        }
      }
    }
  } catch (e) {
    console.warn('Image extraction warning:', e);
  }

  return images;
}

const cachedPageCanvasMap = new WeakMap<any, { scale: number; canvas: HTMLCanvasElement; viewport: any }>();

/**
 * Crops a high-DPI vector diagram region cleanly from a PDF page into a PNG image.
 * Caches full-page high-DPI render per page so multiple diagrams render with zero overhead.
 */
export async function cropPageRegionToPng(
  page: any,
  bboxPt: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number = 3.0
): Promise<{ data: Uint8Array; widthPt: number; heightPt: number } | null> {
  if (typeof document === 'undefined' || !page) return null;

  try {
    let cached = cachedPageCanvasMap.get(page);
    if (!cached || cached.scale < scale) {
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      cached = { scale, canvas, viewport };
      cachedPageCanvasMap.set(page, cached);
    }

    const { canvas: fullCanvas, viewport } = cached;
    const [vx0, vy0, vx1, vy1] = viewport.convertToViewportRectangle([
      bboxPt.minX,
      bboxPt.minY,
      bboxPt.maxX,
      bboxPt.maxY,
    ]);

    const cropX = Math.max(0, Math.floor(Math.min(vx0, vx1)));
    const cropY = Math.max(0, Math.floor(Math.min(vy0, vy1)));
    const cropMaxX = Math.min(fullCanvas.width, Math.ceil(Math.max(vx0, vx1)));
    const cropMaxY = Math.min(fullCanvas.height, Math.ceil(Math.max(vy0, vy1)));
    const cropW = cropMaxX - cropX;
    const cropH = cropMaxY - cropY;

    if (cropW < 16 || cropH < 16) return null;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return null;
    cropCtx.fillStyle = '#FFFFFF';
    cropCtx.fillRect(0, 0, cropW, cropH);
    cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const pngBytes = dataUrlToUint8Array(cropCanvas.toDataURL('image/png'));
    if (!pngBytes) return null;

    const rawW = bboxPt.maxX - bboxPt.minX;
    const rawH = bboxPt.maxY - bboxPt.minY;
    const cappedW = Math.min(Math.round(rawW), 500);
    const ratio = rawW > 0 ? cappedW / rawW : 1;
    const cappedH = Math.min(Math.round(rawH * ratio), 640);

    return {
      data: pngBytes,
      widthPt: Math.max(24, cappedW),
      heightPt: Math.max(24, cappedH),
    };
  } catch (err) {
    console.warn('Diagram crop warning:', err);
    return null;
  }
}

/**
 * High-resolution full page rasterizer for Visual Layout Preservation (Mode B)
 */
export async function rasterizePageToPng(
  page: any,
  scale: number = 2.0
): Promise<Uint8Array> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const bytes = dataUrlToUint8Array(canvas.toDataURL('image/png'));
  return bytes || new Uint8Array();
}
