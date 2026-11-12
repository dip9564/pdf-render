import * as pdfjsModule from 'pdfjs-dist';
import {
  AnalyzedPdfContext,
  PdfAnalysisSummary,
  PdfCompressionError,
  analyzePdfForCompression,
} from './analyzer';
import {
  CompressionMode,
  CompressionSettings,
  createCompressionSettings,
} from './config';
import {
  CanvasRasterAdapter,
  ImageOptimizationSummary,
  optimizeEmbeddedImages,
} from './imageOptimizer';
import {
  QpdfJsonPatchDocument,
  QpdfJsonPatchObject,
  encryptPdfAes256WithQpdf,
  extractSpecificStreamsWithQpdf,
  normalizeAndExternalizeWithQpdf,
  patchAndOptimizeWithQpdf,
} from './qpdfEngine';
import {
  CompressionValidationReport,
  validateCompressedPdf,
} from './validator';

export type CompressionStatus =
  | 'compressed'
  | 'minimal-reduction'
  | 'retained-original';

export interface CompressionExecutionResult {
  status: CompressionStatus;
  mode: CompressionMode;
  outputBytes: Uint8Array;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  candidateSizeBytes: number;
  reductionBytes: number;
  reductionPercent: number;
  durationMs: number;
  analysis: PdfAnalysisSummary;
  imageSummary: ImageOptimizationSummary;
  deduplicatedImagesRemoved: number;
  externalizedInlineImages: number;
  reEncrypted: boolean;
  validation: CompressionValidationReport;
  statusMessage: string;
}

export interface CompressPdfOptions {
  mode?: CompressionMode;
  settingsOverrides?: Partial<CompressionSettings>;
  password?: string;
  allowModifyingSignedPdf?: boolean;
  reusedAnalysisContext?: AnalyzedPdfContext;
  raster?: CanvasRasterAdapter;
  pdfjsLibInstance?: typeof pdfjsModule;
  disablePdfjsWorker?: boolean;
  skipVisualValidation?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
}

function deepCloneJson<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

function buildDeduplicationAndImagePatch(
  context: AnalyzedPdfContext,
  imageSummary: ImageOptimizationSummary,
  settings: CompressionSettings
): {
  patch: QpdfJsonPatchDocument;
  mountedFiles: Map<string, Uint8Array>;
  dedupRemovedCount: number;
  extraFormStreamRefs: Set<string>;
} {
  const objs = context.qpdfJson.qpdf[1];
  const mountedFiles = new Map<string, Uint8Array>();
  const patchObjects: Record<string, QpdfJsonPatchObject> = {};
  const extraFormStreamRefs = new Set<string>();

  // 1. Compute canonical ref map for image deduplication (pre/post optimization)
  const imageAliasMap = new Map<string, string>(); // dupRef -> canonicalRef
  if (settings.deduplicateImages && context.summary.images.length > 1) {
    const firstByHash = new Map<string, string>();
    // Deterministic lowest object number becomes canonical representative
    const sortedImgs = [...imageSummary.resultsByRef.values()].sort((a, b) => {
      const na = parseInt(a.objectRef, 10) || 0;
      const nb = parseInt(b.objectRef, 10) || 0;
      return na - nb;
    });
    for (const res of sortedImgs) {
      const canonical = firstByHash.get(res.canonicalContentHash);
      if (canonical && canonical !== res.objectRef) {
        imageAliasMap.set(res.objectRef, canonical);
      } else if (!canonical) {
        firstByHash.set(res.canonicalContentHash, res.objectRef);
      }
    }
  }

  // 2. Remap any /Resources /XObject entries referencing duplicate images
  if (imageAliasMap.size > 0) {
    const remapXObjectDict = (xObjDict: Record<string, unknown>): boolean => {
      let changed = false;
      for (const [name, target] of Object.entries(xObjDict)) {
        if (typeof target === 'string') {
          const canon = imageAliasMap.get(target);
          if (canon) {
            xObjDict[name] = canon;
            changed = true;
          }
        }
      }
      return changed;
    };

    for (const [objKey, entry] of Object.entries(objs)) {
      if (!objKey.startsWith('obj:')) continue;

      if (entry.value && typeof entry.value === 'object') {
        const val = entry.value;
        // Case A: Direct /Resources dictionary (has /XObject inline) OR standalone /XObject dictionary
        if (val['/XObject'] && typeof val['/XObject'] === 'object') {
          const cloned = deepCloneJson(val);
          if (remapXObjectDict(cloned['/XObject'] as Record<string, unknown>)) {
            patchObjects[objKey] = { value: cloned };
          }
        } else if (val['/Resources'] && typeof val['/Resources'] === 'object') {
          const res = val['/Resources'] as Record<string, unknown>;
          if (res['/XObject'] && typeof res['/XObject'] === 'object') {
            const cloned = deepCloneJson(val);
            const clonedXObj = (cloned['/Resources'] as Record<string, unknown>)[
              '/XObject'
            ] as Record<string, unknown>;
            if (remapXObjectDict(clonedXObj)) {
              patchObjects[objKey] = { value: cloned };
            }
          }
        } else if (
          // Standalone /XObject resource dictionary object (all values point to XObject refs)
          !val['/Type'] &&
          !val['/Subtype'] &&
          !val['/FT'] &&
          !val['/S'] &&
          !val['/Parent'] &&
          !val['/Rect'] &&
          Object.values(val).length > 0 &&
          Object.values(val).every((v) => typeof v === 'string' && /^\d+\s+\d+\s+R$/.test(v)) &&
          Object.values(val).some((v) => typeof v === 'string' && imageAliasMap.has(v))
        ) {
          const cloned = deepCloneJson(val);
          if (remapXObjectDict(cloned)) {
            patchObjects[objKey] = { value: cloned };
          }
        }
      } else if (entry.stream?.dict) {
        const dict = entry.stream.dict;
        if (dict['/Resources'] && typeof dict['/Resources'] === 'object') {
          const res = dict['/Resources'] as Record<string, unknown>;
          if (res['/XObject'] && typeof res['/XObject'] === 'object') {
            const hasDup = Object.values(res['/XObject'] as Record<string, unknown>).some(
              (v) => typeof v === 'string' && imageAliasMap.has(v)
            );
            if (hasDup) {
              const ref = objKey.slice(4);
              extraFormStreamRefs.add(ref);
            }
          }
        }
      }
    }
  }

  // 3. Apply image & SMask stream replacements ONLY for surviving canonical images
  let fileIdx = 0;
  const updatedSMaskRefs = new Set<string>();

  for (const res of imageSummary.resultsByRef.values()) {
    if (imageAliasMap.has(res.objectRef)) {
      // Duplicate image will become unreferenced and garbage-collected by QPDF!
      continue;
    }

    if (res.replacedDict && res.replacedBytes) {
      const fPath = `/opt_img_${fileIdx++}.bin`;
      mountedFiles.set(fPath, res.replacedBytes);
      patchObjects[`obj:${res.objectRef}`] = {
        stream: {
          dict: res.replacedDict,
          datafile: fPath,
        },
      };
    }

    if (
      res.sMaskAction === 'updated' &&
      res.sMaskRef &&
      res.replacedSMaskDict &&
      res.replacedSMaskBytes &&
      !updatedSMaskRefs.has(res.sMaskRef)
    ) {
      updatedSMaskRefs.add(res.sMaskRef);
      const smPath = `/opt_smask_${fileIdx++}.bin`;
      mountedFiles.set(smPath, res.replacedSMaskBytes);
      patchObjects[`obj:${res.sMaskRef}`] = {
        stream: {
          dict: res.replacedSMaskDict,
          datafile: smPath,
        },
      };
    }
  }

  return {
    patch: {
      qpdf: [{ jsonversion: 2 }, patchObjects],
    },
    mountedFiles,
    dedupRemovedCount: imageAliasMap.size,
    extraFormStreamRefs,
  };
}

/**
 * Complete smart PDF compression pipeline:
 * 1. Analyze document (or reuse analyzed context) + externalize inline images if beneficial
 * 2. Optimize unique embedded images cleanly (DPI downsample, JPEG/Gray/CCITT G4/Indexed Flate, SMask handling)
 * 3. Deduplicate identical XObjects & apply QPDF structural compression (--remove-unreferenced-resources, Flate-9, /ObjStm)
 * 4. Re-encrypt if originally user-password-protected
 * 5. Run thorough structural + rendered visual validation
 * 6. Guarantee original bytes are returned intact if output is not smaller or validation fails
 */
export async function compressPdfDocument(
  originalBytes: Uint8Array,
  options: CompressPdfOptions = {}
): Promise<CompressionExecutionResult> {
  const startTime = performance.now();
  const mode = options.mode ?? 'recommended';
  const settings = createCompressionSettings(mode, options.settingsOverrides);
  const pdfjs = options.pdfjsLibInstance ?? pdfjsModule;
  const disablePdfjsWorker = options.disablePdfjsWorker ?? false;

  const checkCancelled = () => {
    if (options.signal?.aborted) {
      throw new PdfCompressionError('CANCELLED', 'Compression cancelled by user.');
    }
  };

  checkCancelled();

  // Step 1: Acquire initial analysis context (or run full analysis)
  let context: AnalyzedPdfContext;
  if (options.reusedAnalysisContext) {
    context = options.reusedAnalysisContext;
    options.onProgress?.(20, 'Using inspected PDF structure...');
  } else {
    context = await analyzePdfForCompression(originalBytes, {
      password: options.password,
      pdfjsLibInstance: pdfjs,
      disablePdfjsWorker,
      signal: options.signal,
      onProgress: (p, msg) => options.onProgress?.(Math.round(p * 0.3), msg),
    });
  }

  checkCancelled();

  // Signature protection guard
  if (context.summary.isDigitallySigned && !options.allowModifyingSignedPdf) {
    throw new PdfCompressionError(
      'SIGNED_CONFIRMATION_REQUIRED',
      'This PDF contains digital signatures that will be invalidated if modified. Confirm before compressing.'
    );
  }

  // Optional step: externalize inline images (BI..ID..EI) into XObjects so they benefit from full image optimization & dedup
  let externalizedInlineImages = 0;
  let workingContext = context;
  if (
    settings.externalizeInlineImages &&
    context.summary.inlineImageCount > 0 &&
    !context.summary.isDigitallySigned
  ) {
    try {
      options.onProgress?.(32, 'Externalizing inline image streams for deeper optimization...');
      const extBytes = await normalizeAndExternalizeWithQpdf(context.workingBytes, {
        minInlineBytes: 256,
      });
      if (extBytes.length > 0) {
        const nextCtx = await analyzePdfForCompression(extBytes, {
          pdfjsLibInstance: pdfjs,
          disablePdfjsWorker,
          signal: options.signal,
        });
        if (nextCtx.summary.uniqueImageCount > context.summary.uniqueImageCount) {
          externalizedInlineImages =
            nextCtx.summary.uniqueImageCount - context.summary.uniqueImageCount;
          // Preserve original encryption & metadata truth on working summary
          nextCtx.summary.isEncrypted = context.summary.isEncrypted;
          nextCtx.summary.requiresPassword = context.summary.requiresPassword;
          nextCtx.summary.encryptionMethod = context.summary.encryptionMethod;
          workingContext = nextCtx;
        }
      }
    } catch {
      // Non-fatal: continue seamlessly with original workingContext
    }
  }

  checkCancelled();

  // Step 2: Optimize unique embedded images
  const imageSummary = await optimizeEmbeddedImages(workingContext, settings, {
    raster: options.raster,
    pdfjsLibInstance: pdfjs,
    disablePdfjsWorker,
    signal: options.signal,
    onProgress: (p, msg) => options.onProgress?.(p, msg),
  });

  checkCancelled();

  // Step 3: Build QPDF patch (images + SMasks + XObject dedup)
  options.onProgress?.(78, 'Deduplicating resources and rebuilding compressed PDF streams...');
  const { patch, mountedFiles, dedupRemovedCount, extraFormStreamRefs } =
    buildDeduplicationAndImagePatch(workingContext, imageSummary, settings);

  // If any Form XObject has an inline /Resources dict containing duplicate image refs, preserve its stream bytes cleanly
  if (extraFormStreamRefs.size > 0) {
    const formStreams = await extractSpecificStreamsWithQpdf(
      workingContext.workingBytes,
      extraFormStreamRefs,
      'none'
    );
    const objs = workingContext.qpdfJson.qpdf[1];
    const imageAliasMap = new Map<string, string>();
    if (settings.deduplicateImages) {
      const firstByHash = new Map<string, string>();
      const sortedImgs = [...imageSummary.resultsByRef.values()].sort((a, b) => {
        const na = parseInt(a.objectRef, 10) || 0;
        const nb = parseInt(b.objectRef, 10) || 0;
        return na - nb;
      });
      for (const res of sortedImgs) {
        const canon = firstByHash.get(res.canonicalContentHash);
        if (canon && canon !== res.objectRef) imageAliasMap.set(res.objectRef, canon);
        else if (!canon) firstByHash.set(res.canonicalContentHash, res.objectRef);
      }
    }
    let fIdx = 0;
    for (const ref of extraFormStreamRefs) {
      const bytes = formStreams.get(ref);
      const origDict = objs[`obj:${ref}`]?.stream?.dict;
      if (!bytes || !origDict) continue;
      const clonedDict = deepCloneJson(origDict);
      delete clonedDict['/Length'];
      const res = clonedDict['/Resources'] as Record<string, unknown> | undefined;
      const xObj = res?.['/XObject'] as Record<string, unknown> | undefined;
      if (xObj) {
        for (const [k, v] of Object.entries(xObj)) {
          if (typeof v === 'string' && imageAliasMap.has(v)) {
            xObj[k] = imageAliasMap.get(v)!;
          }
        }
      }
      const fPath = `/opt_form_${fIdx++}.bin`;
      mountedFiles.set(fPath, bytes);
      patch.qpdf[1][`obj:${ref}`] = {
        stream: {
          dict: clonedDict,
          datafile: fPath,
        },
      };
    }
  }

  // Step 4: Execute QPDF structural + stream compression
  options.onProgress?.(82, 'Applying DEFLATE level-9 & compressed object streams...');
  const structuralOutput = await patchAndOptimizeWithQpdf(workingContext.workingBytes, {
    patch,
    mountedFiles,
    removeUnusedResources: settings.removeUnusedObjects,
    recompressStreams: settings.recompressStreams,
    compressionLevel: 9,
    generateObjectStreams: settings.generateObjectStreams,
    linearize: settings.linearize,
    removeMetadata: settings.removeMetadata,
  });

  checkCancelled();

  // Optional retry without object streams only when structural overhead makes a tiny already-optimal file slightly larger
  let decryptedCandidate = structuralOutput;
  if (
    decryptedCandidate.length >= originalBytes.length &&
    settings.generateObjectStreams &&
    originalBytes.length < 150 * 1024
  ) {
    try {
      const noObjStmCandidate = await patchAndOptimizeWithQpdf(workingContext.workingBytes, {
        patch,
        mountedFiles,
        removeUnusedResources: settings.removeUnusedObjects,
        recompressStreams: settings.recompressStreams,
        compressionLevel: 9,
        generateObjectStreams: false,
        linearize: settings.linearize,
        removeMetadata: settings.removeMetadata,
      });
      if (noObjStmCandidate.length < decryptedCandidate.length) {
        decryptedCandidate = noObjStmCandidate;
      }
    } catch {
      // Ignore fallback attempt failure
    }
  }

  // Step 5: Re-encrypt with user's password if original was user-password protected
  let candidateBytes = decryptedCandidate;
  let reEncrypted = false;
  let outputPassword: string | undefined;

  if (
    context.summary.isEncrypted &&
    options.password &&
    settings.preservePasswordProtectionOnEncryptedPdf
  ) {
    options.onProgress?.(85, 'Restoring AES-256 password protection...');
    candidateBytes = await encryptPdfAes256WithQpdf(
      decryptedCandidate,
      options.password,
      options.password
    );
    reEncrypted = true;
    outputPassword = options.password;
  }

  checkCancelled();

  // Step 6: Post-compression validation (structural + links/bookmarks/forms/attachments/text/visual SSIM+PSNR)
  const validation = await validateCompressedPdf(workingContext, candidateBytes, settings, {
    outputPassword,
    pdfjsLibInstance: pdfjs,
    disablePdfjsWorker,
    skipVisualCheck: options.skipVisualValidation,
    onProgress: options.onProgress,
  });

  if (!validation.passed) {
    throw new PdfCompressionError(
      'VALIDATION_FAILED',
      `Post-compression quality validation failed: ${validation.failureReasons.join(' ')}`
    );
  }

  const durationMs = Math.round(performance.now() - startTime);
  const originalSizeBytes = originalBytes.length;
  const candidateSizeBytes = candidateBytes.length;

  // Step 7: Strict byte-size retention check (never emit a bigger PDF!)
  if (candidateSizeBytes >= originalSizeBytes) {
    options.onProgress?.(100, 'Original file retained (already optimally compressed).');
    return {
      status: 'retained-original',
      mode,
      outputBytes: originalBytes,
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
      candidateSizeBytes,
      reductionBytes: 0,
      reductionPercent: 0,
      durationMs,
      analysis: workingContext.summary,
      imageSummary,
      deduplicatedImagesRemoved: dedupRemovedCount,
      externalizedInlineImages,
      reEncrypted: context.summary.isEncrypted && Boolean(options.password),
      validation,
      statusMessage:
        'This PDF is already tightly optimized. No further size reduction could be achieved without hurting quality, so your original file was retained unchanged.',
    };
  }

  const reductionBytes = originalSizeBytes - candidateSizeBytes;
  const reductionPercent = (reductionBytes / originalSizeBytes) * 100;
  const isMinimal =
    reductionBytes < settings.meaningfulReductionMinBytes &&
    reductionPercent < settings.meaningfulReductionMinPercent;

  options.onProgress?.(100, 'Compression and validation complete.');

  return {
    status: isMinimal ? 'minimal-reduction' : 'compressed',
    mode,
    outputBytes: candidateBytes,
    originalSizeBytes,
    compressedSizeBytes: candidateSizeBytes,
    candidateSizeBytes,
    reductionBytes,
    reductionPercent,
    durationMs,
    analysis: workingContext.summary,
    imageSummary,
    deduplicatedImagesRemoved: dedupRemovedCount,
    externalizedInlineImages,
    reEncrypted,
    validation,
    statusMessage: isMinimal
      ? `Only a minimal reduction (${reductionPercent.toFixed(1)}%) was possible because this document is already efficiently compressed.`
      : `Compressed cleanly from ${originalSizeBytes.toLocaleString()} bytes to ${candidateSizeBytes.toLocaleString()} bytes (${reductionPercent.toFixed(1)}% smaller).`,
  };
}
