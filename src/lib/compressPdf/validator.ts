import * as pdfjsModule from 'pdfjs-dist';
import { AnalyzedPdfContext, countOutlineItems } from './analyzer';
import { CompressionSettings } from './config';
import {
  WorkerSafeCanvasFactory,
  buildWorkerSafePdfjsParams,
  canRenderInCurrentEnvironment,
} from './pdfjsWorkerSafe';
import { checkPdfIntegrityWithQpdf, inspectPdfWithQpdf } from './qpdfEngine';

export { WorkerSafeCanvasFactory };

export interface PageVisualMetrics {
  pageNumber: number;
  ssim: number;
  psnrDb: number;
}

export interface CompressionValidationReport {
  passed: boolean;
  failureReasons: string[];
  warnings: string[];
  qpdfValid: boolean;
  pdfjsOpenable: boolean;
  pageCountMatch: boolean;
  dimensionsMatch: boolean;
  rotationsMatch: boolean;
  textPreserved: boolean;
  originalTextChars: number;
  compressedTextChars: number;
  vectorOpsPreserved: boolean;
  imagesPreserved: boolean;
  linksPreserved: boolean;
  bookmarksPreserved: boolean;
  annotationsPreserved: boolean;
  formsPreserved: boolean;
  attachmentsPreserved: boolean;
  metadataPreserved: boolean;
  visualCheckPerformed: boolean;
  visualPagesCompared: PageVisualMetrics[];
  averageSsim: number | null;
  minPsnrDb: number | null;
}

const OPS = pdfjsModule.OPS;

const VECTOR_OPS = new Set<number>([
  OPS.constructPath,
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
  OPS.shadingFill,
  OPS.rectangle,
]);

function canRenderPagesOnCanvas(): boolean {
  return canRenderInCurrentEnvironment();
}

async function renderPageLumaPixels(
  page: pdfjsModule.PDFPageProxy,
  targetWidthPx: number,
  factory: WorkerSafeCanvasFactory
): Promise<{ width: number; height: number; luma: Float32Array } | null> {
  const unscaled = page.getViewport({ scale: 1.0 });
  if (unscaled.width <= 0 || unscaled.height <= 0) return null;
  const scale = Math.min(2.0, Math.max(0.25, targetWidthPx / unscaled.width));
  const viewport = page.getViewport({ scale });
  const w = Math.max(8, Math.round(viewport.width));
  const h = Math.max(8, Math.round(viewport.height));

  const surf = factory.create(w, h);
  if (!surf.context) return null;
  try {
    const ctx = surf.context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    await page.render({
      canvasContext: ctx as CanvasRenderingContext2D,
      viewport,
      // Use 'print' inside Web Workers so PDF.js schedules via Promise microtask instead of window.requestAnimationFrame
      intent: typeof window !== 'undefined' ? 'display' : 'print',
    }).promise;

    const rgba = ctx.getImageData(0, 0, w, h).data;
    const luma = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return { width: w, height: h, luma };
  } finally {
    factory.destroy(surf);
  }
}

/**
 * Compute windowed SSIM (8x8 blocks, Wang et al. 2004) and PSNR (dB) on luminance planes.
 */
export function computeSsimAndPsnr(
  refLuma: Float32Array,
  cmpLuma: Float32Array,
  width: number,
  height: number
): { ssim: number; psnrDb: number; refStd: number; cmpStd: number } {
  const n = width * height;
  if (n === 0 || refLuma.length < n || cmpLuma.length < n) {
    return { ssim: 0, psnrDb: 0, refStd: 0, cmpStd: 0 };
  }

  let mse = 0;
  let refMean = 0;
  let cmpMean = 0;
  for (let i = 0; i < n; i++) {
    const a = refLuma[i];
    const b = cmpLuma[i];
    const d = a - b;
    mse += d * d;
    refMean += a;
    cmpMean += b;
  }
  mse /= n;
  refMean /= n;
  cmpMean /= n;

  let refVar = 0;
  let cmpVar = 0;
  for (let i = 0; i < n; i++) {
    const da = refLuma[i] - refMean;
    const db = cmpLuma[i] - cmpMean;
    refVar += da * da;
    cmpVar += db * db;
  }
  const refStd = Math.sqrt(refVar / n);
  const cmpStd = Math.sqrt(cmpVar / n);

  const psnrDb = mse <= 1e-6 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse));

  // Blockwise 8x8 SSIM
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const blockSize = 8;
  let ssimSum = 0;
  let blockCount = 0;

  for (let by = 0; by + blockSize <= height; by += blockSize) {
    for (let bx = 0; bx + blockSize <= width; bx += blockSize) {
      let mx = 0;
      let my = 0;
      const bn = blockSize * blockSize;
      for (let dy = 0; dy < blockSize; dy++) {
        const off = (by + dy) * width + bx;
        for (let dx = 0; dx < blockSize; dx++) {
          mx += refLuma[off + dx];
          my += cmpLuma[off + dx];
        }
      }
      mx /= bn;
      my /= bn;

      let vx = 0;
      let vy = 0;
      let vxy = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        const off = (by + dy) * width + bx;
        for (let dx = 0; dx < blockSize; dx++) {
          const ddx = refLuma[off + dx] - mx;
          const ddy = cmpLuma[off + dx] - my;
          vx += ddx * ddx;
          vy += ddy * ddy;
          vxy += ddx * ddy;
        }
      }
      vx /= bn;
      vy /= bn;
      vxy /= bn;

      const num = (2 * mx * my + C1) * (2 * vxy + C2);
      const den = (mx * mx + my * my + C1) * (vx + vy + C2);
      ssimSum += den > 0 ? num / den : 1;
      blockCount++;
    }
  }

  const ssim = blockCount > 0 ? Math.max(0, Math.min(1, ssimSum / blockCount)) : 1;
  return { ssim, psnrDb, refStd, cmpStd };
}

function selectRepresentativePages(context: AnalyzedPdfContext, maxCount: number): number[] {
  const numPages = context.summary.pageCount;
  if (numPages <= maxCount) {
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }
  const scored = context.summary.pages
    .map((p) => ({
      pageNumber: p.pageNumber,
      score:
        p.imageCoverageFraction * 10 +
        (p.imageCount > 0 ? 2 : 0) +
        (p.pageNumber === 1 ? 100 : 0) +
        (p.pageNumber === numPages ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = new Set<number>([1]);
  for (const item of scored) {
    if (selected.size >= maxCount) break;
    selected.add(item.pageNumber);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Validate compressed PDF against original working document across structure,
 * text, vector graphics, images, links, bookmarks, forms, annotations,
 * attachments, metadata, and rendered visual fidelity.
 */
export async function validateCompressedPdf(
  originalContext: AnalyzedPdfContext,
  candidateBytes: Uint8Array,
  settings: CompressionSettings,
  options: {
    outputPassword?: string;
    pdfjsLibInstance?: typeof pdfjsModule;
    disablePdfjsWorker?: boolean;
    skipVisualCheck?: boolean;
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<CompressionValidationReport> {
  const pdfjs = options.pdfjsLibInstance ?? pdfjsModule;
  const disableWorker = options.disablePdfjsWorker ?? false;
  const factory = new WorkerSafeCanvasFactory();
  const failureReasons: string[] = [];
  const warnings: string[] = [];

  options.onProgress?.(86, 'Validating compressed PDF structure and content...');

  // 1. QPDF structural check
  let qpdfValid = false;
  try {
    const chk = await checkPdfIntegrityWithQpdf(candidateBytes, options.outputPassword);
    qpdfValid = chk.valid;
    if (!qpdfValid) {
      failureReasons.push(`QPDF structural check returned error code ${chk.exitCode}.`);
    }
  } catch (err) {
    failureReasons.push(
      `QPDF validation error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2. QPDF JSON check for AcroForm & attachments
  let candHasAcroForm = false;
  let candFormFieldCount = 0;
  let candJsonAttachmentCount = 0;
  try {
    const inspect = await inspectPdfWithQpdf(candidateBytes, {
      password: options.outputPassword,
    });
    candHasAcroForm = Boolean(inspect.json.acroform?.hasacroform);
    candFormFieldCount = inspect.json.acroform?.fields?.length ?? 0;
    candJsonAttachmentCount = Object.keys(inspect.json.attachments ?? {}).length;
  } catch (err) {
    failureReasons.push(
      `QPDF structure parse failed on compressed output: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 3. PDF.js document integrity & deep content audit
  let pdfjsOpenable = false;
  let candPdfDoc: pdfjsModule.PDFDocumentProxy | null = null;
  let origPdfDoc: pdfjsModule.PDFDocumentProxy | null = null;

  let pageCountMatch = false;
  let dimensionsMatch = true;
  let rotationsMatch = true;
  let compressedTextChars = 0;
  let candVectorOps = 0;
  let candImageOps = 0;
  let candLinks = 0;
  let candAnnotations = 0;
  let candBookmarks = 0;
  let candAttachments = 0;
  let metadataPreserved = true;

  const visualPagesCompared: PageVisualMetrics[] = [];
  let visualCheckPerformed = false;

  try {
    candPdfDoc = await pdfjs.getDocument(
      buildWorkerSafePdfjsParams({
        data: candidateBytes,
        password: options.outputPassword,
        inWorkerEnvironment: disableWorker,
        canvasFactory: factory,
      })
    ).promise;
    pdfjsOpenable = true;

    const origSummary = originalContext.summary;
    pageCountMatch = candPdfDoc.numPages === origSummary.pageCount;
    if (!pageCountMatch) {
      failureReasons.push(
        `Page count mismatch (expected ${origSummary.pageCount}, got ${candPdfDoc.numPages}).`
      );
    }

    const pagesToCheck = Math.min(origSummary.pageCount, candPdfDoc.numPages);
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await candPdfDoc.getPage(i);
      try {
        const vp = page.getViewport({ scale: 1.0 });
        const origPage = origSummary.pages[i - 1];
        if (origPage) {
          const sameOrient =
            Math.abs(vp.width - origPage.widthPt) <= 1.0 &&
            Math.abs(vp.height - origPage.heightPt) <= 1.0;
          const rotatedOrient =
            Math.abs(vp.width - origPage.heightPt) <= 1.0 &&
            Math.abs(vp.height - origPage.widthPt) <= 1.0;
          if (!sameOrient && !rotatedOrient) {
            dimensionsMatch = false;
          }
          const rDiff = Math.abs((((page.rotate - origPage.rotation) % 360) + 360) % 360);
          if (rDiff !== 0) {
            rotationsMatch = false;
          }
        }

        const tc = await page.getTextContent();
        let pageText = '';
        for (const item of tc.items) {
          if ('str' in item && item.str) pageText += item.str;
        }
        compressedTextChars += pageText.trim().length;

        const opList = await page.getOperatorList();
        for (let k = 0; k < opList.fnArray.length; k++) {
          const fn = opList.fnArray[k];
          if (VECTOR_OPS.has(fn)) candVectorOps++;
          if (
            fn === OPS.paintImageXObject ||
            fn === OPS.paintImageXObjectRepeat ||
            fn === OPS.paintImageMaskXObject ||
            fn === OPS.paintInlineImageXObject
          ) {
            candImageOps++;
          }
        }

        const annots = (await page.getAnnotations({ intent: 'any' })) as Array<{ subtype?: string }>;
        candAnnotations += annots.length;
        candLinks += annots.filter((a) => a.subtype === 'Link').length;
      } finally {
        page.cleanup();
      }
    }

    if (!dimensionsMatch) {
      failureReasons.push('Page dimensions deviated after compression.');
    }
    if (!rotationsMatch) {
      failureReasons.push('Page rotation changed after compression.');
    }

    const textPreserved =
      origSummary.totalTextChars === 0 ||
      compressedTextChars >= Math.floor(origSummary.totalTextChars * 0.99);
    if (!textPreserved) {
      failureReasons.push(
        `Selectable text count dropped unexpectedly (${compressedTextChars} vs ${origSummary.totalTextChars} original chars).`
      );
    }

    const vectorOpsPreserved =
      origSummary.totalVectorOps === 0 || candVectorOps >= Math.floor(origSummary.totalVectorOps * 0.98);
    if (!vectorOpsPreserved) {
      failureReasons.push(
        `Vector graphics operators decreased (${candVectorOps} vs ${origSummary.totalVectorOps}).`
      );
    }

    // Visual check on representative sample pages
    const canVisual =
      !options.skipVisualCheck &&
      canRenderPagesOnCanvas() &&
      pageCountMatch &&
      candPdfDoc.numPages > 0;

    if (canVisual) {
      options.onProgress?.(93, 'Running rendered visual quality check...');
      origPdfDoc = await pdfjs.getDocument(
        buildWorkerSafePdfjsParams({
          data: originalContext.workingBytes,
          inWorkerEnvironment: disableWorker,
          canvasFactory: factory,
        })
      ).promise;

      const samplePages = selectRepresentativePages(
        originalContext,
        settings.validation.maxRenderSamplePages
      );

      for (const pageNum of samplePages) {
        const [pRef, pCmp] = await Promise.all([
          origPdfDoc.getPage(pageNum),
          candPdfDoc.getPage(pageNum),
        ]);
        try {
          const [refImg, cmpImg] = await Promise.all([
            renderPageLumaPixels(pRef, settings.validation.compareRenderMaxWidthPx, factory),
            renderPageLumaPixels(pCmp, settings.validation.compareRenderMaxWidthPx, factory),
          ]);
          if (refImg && cmpImg && refImg.width === cmpImg.width && refImg.height === cmpImg.height) {
            visualCheckPerformed = true;
            const metrics = computeSsimAndPsnr(
              refImg.luma,
              cmpImg.luma,
              refImg.width,
              refImg.height
            );
            visualPagesCompared.push({
              pageNumber: pageNum,
              ssim: metrics.ssim,
              psnrDb: metrics.psnrDb,
            });

            if (metrics.refStd > 2.5 && metrics.cmpStd < 0.4) {
              failureReasons.push(`Rendered page ${pageNum} became blank after compression.`);
            } else if (metrics.ssim < settings.validation.minSsim) {
              failureReasons.push(
                `Page ${pageNum} visual similarity SSIM=${metrics.ssim.toFixed(3)} fell below minimum ${settings.validation.minSsim.toFixed(2)}.`
              );
            } else if (metrics.psnrDb < settings.validation.minPsnrDb) {
              failureReasons.push(
                `Page ${pageNum} PSNR=${metrics.psnrDb.toFixed(1)} dB fell below minimum ${settings.validation.minPsnrDb} dB.`
              );
            }
          }
        } finally {
          pRef.cleanup();
          pCmp.cleanup();
        }
      }
    }

    const outline = await candPdfDoc.getOutline().catch(() => null);
    candBookmarks = countOutlineItems(outline);

    const attachments = (await candPdfDoc.getAttachments().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    candAttachments = attachments ? Object.keys(attachments).length : candJsonAttachmentCount;

    if (!settings.removeMetadata && origSummary.hasMetadata) {
      const candMeta = await candPdfDoc.getMetadata().catch(() => null);
      const info = (candMeta?.info ?? {}) as Record<string, unknown>;
      const hadTitle = Boolean(origSummary.metadataSummary.title);
      const hadAuthor = Boolean(origSummary.metadataSummary.author);
      if (
        (hadTitle && info.Title !== origSummary.metadataSummary.title) ||
        (hadAuthor && info.Author !== origSummary.metadataSummary.author)
      ) {
        metadataPreserved = false;
        warnings.push('Some document metadata fields differed slightly in output.');
      }
    }

    const expectedImageOps = origSummary.totalPdfjsImageOps;
    const imagesPreserved =
      expectedImageOps === 0 || candImageOps >= Math.max(1, expectedImageOps);
    if (!imagesPreserved) {
      failureReasons.push(
        `Embedded image draw operations missing (${candImageOps} vs ${expectedImageOps}).`
      );
    }

    const linksPreserved = !settings.preserveLinks || candLinks >= origSummary.linkCount;
    if (!linksPreserved) {
      failureReasons.push(
        `Hyperlink annotations missing (${candLinks} vs ${origSummary.linkCount}).`
      );
    }

    const bookmarksPreserved =
      !settings.preserveBookmarks || candBookmarks >= origSummary.bookmarkCount;
    if (!bookmarksPreserved) {
      failureReasons.push(
        `Bookmarks/outlines missing (${candBookmarks} vs ${origSummary.bookmarkCount}).`
      );
    }

    const annotationsPreserved =
      !settings.preserveAnnotations || candAnnotations >= origSummary.annotationCount;
    if (!annotationsPreserved) {
      failureReasons.push(
        `Annotations missing (${candAnnotations} vs ${origSummary.annotationCount}).`
      );
    }

    const formsPreserved =
      !settings.preserveForms ||
      !origSummary.hasAcroForm ||
      (candHasAcroForm && candFormFieldCount >= origSummary.formFieldCount);
    if (!formsPreserved) {
      failureReasons.push(
        `Interactive AcroForm fields missing (${candFormFieldCount} vs ${origSummary.formFieldCount}).`
      );
    }

    const attachmentsPreserved =
      !settings.preserveAttachments || candAttachments >= origSummary.attachmentCount;
    if (!attachmentsPreserved) {
      failureReasons.push(
        `Embedded attachments missing (${candAttachments} vs ${origSummary.attachmentCount}).`
      );
    }

    const averageSsim =
      visualPagesCompared.length > 0
        ? visualPagesCompared.reduce((s, p) => s + p.ssim, 0) / visualPagesCompared.length
        : null;
    const minPsnrDb =
      visualPagesCompared.length > 0
        ? Math.min(...visualPagesCompared.map((p) => p.psnrDb))
        : null;

    return {
      passed: failureReasons.length === 0 && qpdfValid && pdfjsOpenable,
      failureReasons,
      warnings,
      qpdfValid,
      pdfjsOpenable,
      pageCountMatch,
      dimensionsMatch,
      rotationsMatch,
      textPreserved,
      originalTextChars: origSummary.totalTextChars,
      compressedTextChars,
      vectorOpsPreserved,
      imagesPreserved,
      linksPreserved,
      bookmarksPreserved,
      annotationsPreserved,
      formsPreserved,
      attachmentsPreserved,
      metadataPreserved,
      visualCheckPerformed,
      visualPagesCompared,
      averageSsim,
      minPsnrDb,
    };
  } catch (err) {
    failureReasons.push(
      `PDF.js validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      passed: false,
      failureReasons,
      warnings,
      qpdfValid,
      pdfjsOpenable: false,
      pageCountMatch: false,
      dimensionsMatch: false,
      rotationsMatch: false,
      textPreserved: false,
      originalTextChars: originalContext.summary.totalTextChars,
      compressedTextChars: 0,
      vectorOpsPreserved: false,
      imagesPreserved: false,
      linksPreserved: false,
      bookmarksPreserved: false,
      annotationsPreserved: false,
      formsPreserved: false,
      attachmentsPreserved: false,
      metadataPreserved: false,
      visualCheckPerformed: false,
      visualPagesCompared: [],
      averageSsim: null,
      minPsnrDb: null,
    };
  } finally {
    await candPdfDoc?.destroy().catch(() => {});
    await origPdfDoc?.destroy().catch(() => {});
  }
}
