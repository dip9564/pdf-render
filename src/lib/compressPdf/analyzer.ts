import * as pdfjsModule from 'pdfjs-dist';
import {
  analyzeDocumentCtmPlacements,
  collectContentAndFormStreamRefs,
  DocumentCtmAnalysis,
  ImagePlacement,
  resolveJsonDict,
  resolveJsonValue,
} from './contentStreamCtm';
import { buildWorkerSafePdfjsParams } from './pdfjsWorkerSafe';
import {
  decryptPdfWithQpdf,
  extractSpecificStreamsWithQpdf,
  inspectPdfWithQpdf,
  QpdfJsonDocument,
  QpdfJsonObjectEntry,
} from './qpdfEngine';
import { CompressionMode } from './config';

export class PdfCompressionError extends Error {
  readonly code:
    | 'PASSWORD_REQUIRED'
    | 'INCORRECT_PASSWORD'
    | 'INVALID_PDF'
    | 'CANCELLED'
    | 'SIGNED_CONFIRMATION_REQUIRED'
    | 'VALIDATION_FAILED'
    | 'UNKNOWN';

  constructor(code: PdfCompressionError['code'], message: string) {
    super(message);
    this.name = 'PdfCompressionError';
    this.code = code;
  }
}

export type PageContentCategory =
  | 'text-only'
  | 'scanned'
  | 'image-heavy'
  | 'mixed-content'
  | 'empty';

export type DocumentClassification =
  | 'text-only'
  | 'scanned'
  | 'image-heavy'
  | 'mixed-content'
  | 'vector-rich';

export interface AnalyzedImageInfo {
  objectRef: string; // e.g. "4 0 R"
  widthPx: number;
  heightPx: number;
  bitsPerComponent: number;
  colorSpace: string;
  filter: string;
  encodedBytes: number;
  hasSMask: boolean;
  sMaskRef?: string;
  hasExplicitMask: boolean;
  isImageMask: boolean;
  placements: ImagePlacement[];
  placementCount: number;
  maxDisplayedWidthPt: number;
  maxDisplayedHeightPt: number;
  /** Lowest DPI among all placements (must satisfy largest display area) */
  minEffectiveDpi: number | null;
  maxEffectiveDpi: number | null;
  /** Fingerprint of raw encoded image bytes + key dict attributes for duplicate detection */
  rawSignature: string;
  duplicateGroupId: string;
}

export interface AnalyzedPageInfo {
  pageNumber: number; // 1-based
  widthPt: number;
  heightPt: number;
  rotation: number;
  category: PageContentCategory;
  textCharCount: number;
  textWordCount: number;
  vectorOpCount: number;
  imageCount: number;
  imageCoverageFraction: number;
  linkCount: number;
  annotationCount: number;
}

export interface PdfAnalysisSummary {
  pageCount: number;
  fileSizeBytes: number;
  pdfVersion: string;
  classification: DocumentClassification;
  recommendedMode: CompressionMode;
  recommendedReason: string;

  // Content breakdown
  pageCategories: Record<PageContentCategory, number>;
  pages: AnalyzedPageInfo[];
  totalTextChars: number;
  totalVectorOps: number;

  // Image breakdown
  totalImagePlacements: number;
  totalPdfjsImageOps: number;
  uniqueImageCount: number;
  duplicateImageCount: number;
  oversizedImageCount150Dpi: number;
  transparentImageCount: number;
  inlineImageCount: number;
  uncompressedOrFlateImageCount: number;
  images: AnalyzedImageInfo[];

  // Fonts & structure
  embeddedFontCount: number;
  unusualFontCount: number;
  fontNames: string[];
  linkCount: number;
  bookmarkCount: number;
  annotationCount: number;
  formFieldCount: number;
  hasAcroForm: boolean;
  attachmentCount: number;
  attachmentNames: string[];

  // Special protections & metadata
  isEncrypted: boolean;
  requiresPassword: boolean;
  encryptionMethod: string;
  isDigitallySigned: boolean;
  signatureCount: number;
  hasMetadata: boolean;
  metadataSummary: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    hasXmpStream: boolean;
  };
  warnings: string[];
}

export interface AnalyzedPdfContext {
  summary: PdfAnalysisSummary;
  /** Decrypted, analysis-ready PDF bytes */
  workingBytes: Uint8Array;
  qpdfJson: QpdfJsonDocument;
  ctmAnalysis: DocumentCtmAnalysis;
  rawImageStreams: Map<string, Uint8Array>;
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

function normalizeColorSpaceLabel(cs: unknown, objs: Record<string, QpdfJsonObjectEntry>): string {
  const resolved = resolveJsonValue(objs, cs);
  if (typeof resolved === 'string') return resolved.replace(/^\//, '');
  if (Array.isArray(resolved) && resolved.length > 0) {
    const first = String(resolved[0]).replace(/^\//, '');
    if (first === 'ICCBased' && resolved.length >= 2) {
      const prof = resolveJsonValue(objs, resolved[1]) as { dict?: Record<string, unknown> } | undefined;
      const n = Number(prof?.dict?.['/N']);
      return Number.isFinite(n) ? `ICCBased(${n})` : 'ICCBased';
    }
    return first;
  }
  return 'Unknown';
}

function normalizeFilterLabel(filterVal: unknown): string {
  if (typeof filterVal === 'string') return filterVal.replace(/^\//, '');
  if (Array.isArray(filterVal)) {
    return filterVal.map((f) => String(f).replace(/^\//, '')).join('+');
  }
  return 'Uncompressed';
}

export function fnv1aHashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${len.toString(16)}_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function countOutlineItems(outline: unknown[] | null | undefined): number {
  if (!Array.isArray(outline)) return 0;
  let total = 0;
  for (const item of outline) {
    total += 1;
    if (item && typeof item === 'object' && 'items' in item && Array.isArray((item as { items?: unknown[] }).items)) {
      total += countOutlineItems((item as { items: unknown[] }).items);
    }
  }
  return total;
}

export function detectDigitalSignaturesInQpdfJson(docJson: QpdfJsonDocument): {
  isSigned: boolean;
  signatureCount: number;
} {
  const objs = docJson.qpdf[1];
  let sigCount = 0;
  for (const entry of Object.values(objs)) {
    const dict = entry?.value ?? entry?.stream?.dict;
    if (!dict || typeof dict !== 'object') continue;
    const isSigType = dict['/Type'] === '/Sig';
    const isSigField = dict['/FT'] === '/Sig' && ('/V' in dict || '/AP' in dict);
    const hasByteRange = Array.isArray(dict['/ByteRange']);
    if (isSigType || hasByteRange) {
      sigCount++;
    } else if (isSigField && !('/Type' in dict && dict['/Type'] === '/Sig')) {
      // Field referencing a signature value
      const vResolved = resolveJsonDict(objs, dict['/V']);
      if (vResolved && (vResolved['/Type'] === '/Sig' || Array.isArray(vResolved['/ByteRange']))) {
        // Already counted via /Sig value
      } else if ('/V' in dict && dict['/V'] !== null) {
        sigCount++;
      }
    }
  }
  return { isSigned: sigCount > 0, signatureCount: sigCount };
}

/**
 * Count inline images (`BI ... ID ... EI`) inside page/form content streams quickly.
 */
function countInlineImagesInStreams(decodedStreams: Map<string, Uint8Array>): number {
  let count = 0;
  for (const bytes of decodedStreams.values()) {
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (
        bytes[i] === 66 && // B
        bytes[i + 1] === 73 && // I
        (i === 0 || bytes[i - 1] <= 32) &&
        bytes[i + 2] <= 32
      ) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Full pre-compression PDF intelligence analyzer.
 */
export async function analyzePdfForCompression(
  originalBytes: Uint8Array,
  options: {
    password?: string;
    pdfjsLibInstance?: typeof pdfjsModule;
    disablePdfjsWorker?: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void;
  } = {}
): Promise<AnalyzedPdfContext> {
  const pdfjs = options.pdfjsLibInstance ?? pdfjsModule;
  const checkCancelled = () => {
    if (options.signal?.aborted) {
      throw new PdfCompressionError('CANCELLED', 'Analysis cancelled by user.');
    }
  };

  checkCancelled();
  options.onProgress?.(5, 'Checking document security and PDF structure...');

  // 1. Probe with PDF.js first so password protection & corruption are caught cleanly
  let pdfjsDoc: pdfjsModule.PDFDocumentProxy;
  try {
    const loadingTask = pdfjs.getDocument(
      buildWorkerSafePdfjsParams({
        data: originalBytes,
        password: options.password,
        inWorkerEnvironment: options.disablePdfjsWorker,
      })
    );
    pdfjsDoc = await loadingTask.promise;
  } catch (err: unknown) {
    const errObj = err as { name?: string; code?: number; message?: string };
    if (errObj?.name === 'PasswordException') {
      if (errObj.code === 2) {
        throw new PdfCompressionError('INCORRECT_PASSWORD', 'The password entered is incorrect.');
      }
      throw new PdfCompressionError(
        'PASSWORD_REQUIRED',
        'This PDF is password-protected. Enter the password to inspect and compress it.'
      );
    }
    throw new PdfCompressionError(
      'INVALID_PDF',
      errObj?.message ? `Unable to open PDF: ${errObj.message}` : 'The file is not a valid PDF.'
    );
  }

  checkCancelled();

  try {
    // 2. Inspect encryption via QPDF JSON and decrypt into workingBytes if encrypted
    let preJson: QpdfJsonDocument;
    try {
      const preInspect = await inspectPdfWithQpdf(originalBytes, {
        password: options.password,
      });
      preJson = preInspect.json;
    } catch {
      pdfjsDoc.destroy();
      throw new PdfCompressionError(
        'PASSWORD_REQUIRED',
        'Password verification failed while parsing PDF structure.'
      );
    }

    const encryptInfo = preJson.encrypt;
    const isEncrypted = Boolean(encryptInfo?.encrypted);
    const encMethod = encryptInfo?.parameters?.method ?? 'none';

    let workingBytes = originalBytes;
    if (isEncrypted) {
      options.onProgress?.(12, 'Unlocking encrypted PDF structure in memory...');
      try {
        workingBytes = await decryptPdfWithQpdf(originalBytes, options.password);
      } catch {
        throw new PdfCompressionError(
          'PASSWORD_REQUIRED',
          'Could not decrypt this PDF with the supplied credentials.'
        );
      }
    }

    checkCancelled();
    options.onProgress?.(20, 'Inspecting embedded images, fonts & objects...');

    // 3. Extract QPDF structural JSON + raw image streams on decrypted bytes
    const rawInspect = await inspectPdfWithQpdf(workingBytes, {
      decodeLevel: 'none',
      extractObjectStreams: (_ref, entry) => {
        const dict = entry.stream?.dict;
        return Boolean(dict && dict['/Subtype'] === '/Image');
      },
    });
    const docJson = rawInspect.json;
    const rawImageStreams = rawInspect.streams;
    const objs = docJson.qpdf[1];

    // Extract decoded content & form streams cleanly for CTM & inline-image walk
    const contentRefs = collectContentAndFormStreamRefs(docJson);
    const decodedContentStreams = await extractSpecificStreamsWithQpdf(
      workingBytes,
      contentRefs,
      'generalized'
    );

    checkCancelled();
    options.onProgress?.(32, 'Calculating exact image display dimensions & DPI...');

    const ctmAnalysis = analyzeDocumentCtmPlacements(docJson, decodedContentStreams);
    const inlineImageCount = countInlineImagesInStreams(decodedContentStreams);

    // 4. Collect unique Image XObjects & duplicates (excluding pure /SMask & explicit /Mask helpers)
    const referencedAsMaskRefs = new Set<string>();
    for (const entry of Object.values(objs)) {
      const d = entry?.stream?.dict;
      if (!d || d['/Subtype'] !== '/Image') continue;
      if (typeof d['/SMask'] === 'string' && /^\d+\s+\d+\s+R$/.test(d['/SMask'])) {
        referencedAsMaskRefs.add(d['/SMask']);
      }
      if (typeof d['/Mask'] === 'string' && /^\d+\s+\d+\s+R$/.test(d['/Mask'])) {
        referencedAsMaskRefs.add(d['/Mask']);
      }
    }

    const imageRefSet = new Set<string>();
    for (const [key, entry] of Object.entries(objs)) {
      if (key.startsWith('obj:') && entry?.stream?.dict?.['/Subtype'] === '/Image') {
        const ref = key.slice(4);
        const hasOwnPlacement = (ctmAnalysis.placementsByImageRef.get(ref)?.length ?? 0) > 0;
        if (!referencedAsMaskRefs.has(ref) || hasOwnPlacement) {
          imageRefSet.add(ref);
        }
      }
    }
    for (const page of docJson.pages) {
      for (const img of page.images) {
        if (img.object) {
          const hasOwnPlacement = (ctmAnalysis.placementsByImageRef.get(img.object)?.length ?? 0) > 0;
          if (!referencedAsMaskRefs.has(img.object) || hasOwnPlacement) {
            imageRefSet.add(img.object);
          }
        }
      }
    }

    const images: AnalyzedImageInfo[] = [];
    const sigGroups = new Map<string, string[]>();

    for (const objectRef of imageRefSet) {
      const entry = objs[`obj:${objectRef}`];
      const dict = entry?.stream?.dict;
      if (!dict) continue;

      const widthPx = Number(dict['/Width']) || 0;
      const heightPx = Number(dict['/Height']) || 0;
      if (widthPx <= 0 || heightPx <= 0) continue;

      const bitsPerComponent = Number(dict['/BitsPerComponent']) || 8;
      const colorSpace = normalizeColorSpaceLabel(dict['/ColorSpace'], objs);
      const filter = normalizeFilterLabel(dict['/Filter']);
      const rawBytes = rawImageStreams.get(objectRef);
      const encodedBytes = rawBytes ? rawBytes.length : Number(dict['/Length']) || 0;
      const sMaskRef =
        typeof dict['/SMask'] === 'string' && /^\d+\s+\d+\s+R$/.test(dict['/SMask'])
          ? dict['/SMask']
          : undefined;
      const hasSMask = Boolean(sMaskRef);
      const hasExplicitMask = Boolean(dict['/Mask']);
      const isImageMask = dict['/ImageMask'] === true;

      const placements = ctmAnalysis.placementsByImageRef.get(objectRef) ?? [];
      let maxDispW = 0;
      let maxDispH = 0;
      let minDpi = Infinity;
      let maxDpi = 0;
      for (const pl of placements) {
        if (pl.displayedWidthPt > maxDispW) maxDispW = pl.displayedWidthPt;
        if (pl.displayedHeightPt > maxDispH) maxDispH = pl.displayedHeightPt;
        const effectiveDpi = Math.max(pl.effectiveDpiX, pl.effectiveDpiY);
        if (effectiveDpi < minDpi) minDpi = effectiveDpi;
        if (effectiveDpi > maxDpi) maxDpi = effectiveDpi;
      }

      const rawHash = rawBytes ? fnv1aHashBytes(rawBytes) : `len_${encodedBytes}`;
      const rawSignature = `${widthPx}x${heightPx}|${bitsPerComponent}|${colorSpace}|${filter}|${sMaskRef ? 'SM' : ''}|${isImageMask ? 'IM' : ''}|${rawHash}`;

      const grp = sigGroups.get(rawSignature);
      if (grp) grp.push(objectRef);
      else sigGroups.set(rawSignature, [objectRef]);

      images.push({
        objectRef,
        widthPx,
        heightPx,
        bitsPerComponent,
        colorSpace,
        filter,
        encodedBytes,
        hasSMask,
        sMaskRef,
        hasExplicitMask,
        isImageMask,
        placements,
        placementCount: placements.length,
        maxDisplayedWidthPt: maxDispW,
        maxDisplayedHeightPt: maxDispH,
        minEffectiveDpi: placements.length > 0 && Number.isFinite(minDpi) ? minDpi : null,
        maxEffectiveDpi: placements.length > 0 && maxDpi > 0 ? maxDpi : null,
        rawSignature,
        duplicateGroupId: rawSignature,
      });
    }

    let duplicateImageCount = 0;
    for (const grp of sigGroups.values()) {
      if (grp.length > 1) duplicateImageCount += grp.length - 1;
    }

    // Check fonts & signatures & metadata in QPDF JSON
    const fontNameSet = new Set<string>();
    let unusualFontCount = 0;
    for (const entry of Object.values(objs)) {
      const dict = entry?.value ?? entry?.stream?.dict;
      if (!dict) continue;
      if (dict['/Type'] === '/Font') {
        const base = typeof dict['/BaseFont'] === 'string' ? dict['/BaseFont'].replace(/^\//, '') : 'EmbeddedFont';
        fontNameSet.add(base);
        const subtype = String(dict['/Subtype'] || '');
        if (subtype === '/Type3' || subtype === '/Type0' || subtype === '/MMType1') {
          unusualFontCount++;
        }
      }
    }

    const { isSigned: isDigitallySigned, signatureCount } = detectDigitalSignaturesInQpdfJson(docJson);

    const catalogDict = resolveJsonDict(objs, docJson.qpdf[1]['trailer']?.value?.['/Root']);
    const hasXmpStream = Boolean(catalogDict?.['/Metadata']);

    // 5. Inspect per-page text, vectors & annotations via PDF.js
    const pages: AnalyzedPageInfo[] = [];
    const pageCategories: Record<PageContentCategory, number> = {
      'text-only': 0,
      scanned: 0,
      'image-heavy': 0,
      'mixed-content': 0,
      empty: 0,
    };

    let totalTextChars = 0;
    let totalVectorOps = 0;
    let totalLinks = 0;
    let totalAnnotations = 0;
    let totalPdfjsImageOps = 0;

    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      checkCancelled();
      if (i === 1 || i % 5 === 0 || i === pdfjsDoc.numPages) {
        const pct = 35 + Math.round((i / pdfjsDoc.numPages) * 55);
        options.onProgress?.(pct, `Analyzing page ${i} of ${pdfjsDoc.numPages}...`);
      }

      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();
      let pageText = '';
      for (const item of textContent.items) {
        if ('str' in item && item.str) pageText += item.str;
      }
      const trimmedText = pageText.trim();
      const textCharCount = trimmedText.length;
      const textWordCount = trimmedText ? trimmedText.split(/\s+/).filter(Boolean).length : 0;

      const opList = await page.getOperatorList();
      let vectorOpCount = 0;
      let paintImageOps = 0;
      for (let k = 0; k < opList.fnArray.length; k++) {
        const fn = opList.fnArray[k];
        if (VECTOR_OPS.has(fn)) vectorOpCount++;
        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintImageXObjectRepeat ||
          fn === OPS.paintImageMaskXObject ||
          fn === OPS.paintInlineImageXObject
        ) {
          paintImageOps++;
        }
      }

      const annots = (await page.getAnnotations({ intent: 'any' })) as Array<{ subtype?: string }>;
      const pageLinks = annots.filter((a) => a.subtype === 'Link').length;

      const ctmSummary = ctmAnalysis.pageSummaries[i - 1];
      const coverage = ctmSummary?.imageAreaCoverageFraction ?? 0;
      const imgCount = Math.max(ctmSummary?.placements.length ?? 0, paintImageOps);

      let category: PageContentCategory;
      if (imgCount === 0 && textCharCount < 5 && vectorOpCount < 3) {
        category = 'empty';
      } else if (imgCount === 0 || (coverage < 0.02 && textCharCount > 15)) {
        category = 'text-only';
      } else if (coverage >= 0.65 && textCharCount <= 80) {
        category = 'scanned';
      } else if (coverage >= 0.4 || (imgCount >= 3 && coverage >= 0.25)) {
        category = 'image-heavy';
      } else {
        category = 'mixed-content';
      }

      pageCategories[category]++;
      totalTextChars += textCharCount;
      totalVectorOps += vectorOpCount;
      totalPdfjsImageOps += paintImageOps;
      totalLinks += pageLinks;
      totalAnnotations += annots.length;

      pages.push({
        pageNumber: i,
        widthPt: ctmSummary?.pageWidthPt ?? viewport.width,
        heightPt: ctmSummary?.pageHeightPt ?? viewport.height,
        rotation: ctmSummary?.pageRotation ?? page.rotate,
        category,
        textCharCount,
        textWordCount,
        vectorOpCount,
        imageCount: imgCount,
        imageCoverageFraction: coverage,
        linkCount: pageLinks,
        annotationCount: annots.length,
      });

      page.cleanup();
    }

    const outline = await pdfjsDoc.getOutline();
    const bookmarkCount = countOutlineItems(outline);
    const meta = await pdfjsDoc.getMetadata().catch(() => null);
    const metaInfo = (meta?.info ?? {}) as Record<string, unknown>;
    const attachments = (await pdfjsDoc.getAttachments().catch(() => null)) as Record<string, unknown> | null;
    const attachmentNames = attachments ? Object.keys(attachments) : Object.keys(docJson.attachments ?? {});

    // Check overall document classification & smart recommendation
    const numPages = pdfjsDoc.numPages;
    let classification: DocumentClassification = 'mixed-content';
    if (pageCategories['text-only'] === numPages && images.length === 0) {
      classification = totalVectorOps >= 20 * numPages ? 'vector-rich' : 'text-only';
    } else if (pageCategories.scanned >= Math.ceil(numPages * 0.6)) {
      classification = 'scanned';
    } else if (pageCategories['image-heavy'] >= Math.ceil(numPages * 0.5)) {
      classification = 'image-heavy';
    } else if (images.length === 0 && totalVectorOps >= 15) {
      classification = 'vector-rich';
    }

    const oversizedImageCount150Dpi = images.filter(
      (im) => im.minEffectiveDpi !== null && im.minEffectiveDpi > 165
    ).length;
    const transparentImageCount = images.filter((im) => im.hasSMask || im.hasExplicitMask).length;
    const uncompressedOrFlateImageCount = images.filter(
      (im) => im.filter === 'FlateDecode' || im.filter === 'Uncompressed' || im.filter === 'LZWDecode'
    ).length;

    let recommendedMode: CompressionMode = 'recommended';
    let recommendedReason =
      'Balances strong image & structural compression while keeping text, vectors, and visual clarity sharp.';
    if (classification === 'text-only' || classification === 'vector-rich') {
      recommendedReason =
        'Applies lossless stream DEFLATE compression, object streams, and unused-object cleanup without touching text or vectors.';
    } else if (classification === 'scanned') {
      recommendedReason =
        'Downsamples high-DPI scanned pages to 150 DPI cleanly while preserving any OCR text layers and bookmarks.';
    }

    const warnings: string[] = [];
    if (isDigitallySigned) {
      warnings.push(
        `This PDF contains ${signatureCount} digital signature${signatureCount > 1 ? 's' : ''}. Compressing or rewriting the PDF structure will invalidate existing cryptographic signatures.`
      );
    }
    if (attachmentNames.length > 0) {
      warnings.push(
        `${attachmentNames.length} embedded file attachment${attachmentNames.length > 1 ? 's' : ''} detected and will be preserved.`
      );
    }
    if (docJson.acroform?.hasacroform) {
      warnings.push(
        `Interactive AcroForm detected (${docJson.acroform.fields.length} field${docJson.acroform.fields.length === 1 ? '' : 's'}). Form fields will be preserved.`
      );
    }
    if (isEncrypted) {
      warnings.push(
        `Document uses ${encMethod} encryption.${options.password ? ' Re-encrypted output will remain protected unless turned off.' : ' Owner restrictions will be processed safely.'}`
      );
    }

    options.onProgress?.(100, 'PDF analysis complete.');

    const summary: PdfAnalysisSummary = {
      pageCount: numPages,
      fileSizeBytes: originalBytes.length,
      pdfVersion: docJson.qpdf[0]?.pdfversion ?? '1.7',
      classification,
      recommendedMode,
      recommendedReason,
      pageCategories,
      pages,
      totalTextChars,
      totalVectorOps,
      totalImagePlacements: images.reduce((acc, im) => acc + im.placementCount, 0),
      totalPdfjsImageOps,
      uniqueImageCount: images.length,
      duplicateImageCount,
      oversizedImageCount150Dpi,
      transparentImageCount,
      inlineImageCount,
      uncompressedOrFlateImageCount,
      images,
      embeddedFontCount: fontNameSet.size,
      unusualFontCount,
      fontNames: Array.from(fontNameSet),
      linkCount: totalLinks,
      bookmarkCount,
      annotationCount: totalAnnotations,
      formFieldCount: docJson.acroform?.fields?.length ?? 0,
      hasAcroForm: Boolean(docJson.acroform?.hasacroform),
      attachmentCount: attachmentNames.length,
      attachmentNames,
      isEncrypted,
      requiresPassword: Boolean(options.password),
      encryptionMethod: encMethod,
      isDigitallySigned,
      signatureCount,
      hasMetadata: Boolean(metaInfo.Title || metaInfo.Author || metaInfo.Subject || hasXmpStream),
      metadataSummary: {
        title: typeof metaInfo.Title === 'string' ? metaInfo.Title : undefined,
        author: typeof metaInfo.Author === 'string' ? metaInfo.Author : undefined,
        subject: typeof metaInfo.Subject === 'string' ? metaInfo.Subject : undefined,
        creator: typeof metaInfo.Creator === 'string' ? metaInfo.Creator : undefined,
        producer: typeof metaInfo.Producer === 'string' ? metaInfo.Producer : undefined,
        hasXmpStream,
      },
      warnings,
    };

    return {
      summary,
      workingBytes,
      qpdfJson: docJson,
      ctmAnalysis,
      rawImageStreams,
    };
  } finally {
    await pdfjsDoc.destroy().catch(() => {});
  }
}
