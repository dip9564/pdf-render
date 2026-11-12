import * as pdfjsLib from 'pdfjs-dist';
import * as pdfjsWorkerModule from 'pdfjs-dist/build/pdf.worker.js';
import {
  AnalyzedPdfContext,
  PdfAnalysisSummary,
  PdfCompressionError,
  analyzePdfForCompression,
} from './analyzer';
import {
  CompressionExecutionResult,
  compressPdfDocument,
} from './compressorEngine';
import { CompressionMode, CompressionSettings } from './config';
import { ImageOptimizationAction, OptimizedImageResult } from './imageOptimizer';
import { setCustomQpdfWasmUrl } from './qpdfEngine';

export interface SerializableCompressionResult
  extends Omit<CompressionExecutionResult, 'imageSummary'> {
  imageSummary: {
    optimizedCount: number;
    downsampledCount: number;
    convertedToCcittCount: number;
    convertedToGrayscaleCount: number;
    droppedOpaqueSmaskCount: number;
    bytesBefore: number;
    bytesAfter: number;
    resultsEntries: Array<[string, Omit<OptimizedImageResult, 'replacedDict' | 'replacedBytes' | 'replacedSMaskDict' | 'replacedSMaskBytes'>]>;
  };
}

export type WorkerInMessage =
  | { type: 'INIT'; wasmUrl?: string }
  | {
      type: 'ANALYZE';
      jobId: string;
      fileId: string;
      bytes: Uint8Array;
      password?: string;
    }
  | {
      type: 'COMPRESS';
      jobId: string;
      fileId: string;
      bytes?: Uint8Array;
      mode: CompressionMode;
      password?: string;
      allowModifyingSignedPdf?: boolean;
      preservePasswordProtectionOnEncryptedPdf?: boolean;
      settingsOverrides?: Partial<CompressionSettings>;
      skipVisualValidation?: boolean;
    }
  | { type: 'CANCEL'; jobId: string }
  | { type: 'CLEAR_CACHE'; fileId?: string };

export type WorkerOutMessage =
  | { type: 'PROGRESS'; jobId: string; progress: number; message: string }
  | { type: 'ANALYZE_RESULT'; jobId: string; summary: PdfAnalysisSummary }
  | {
      type: 'COMPRESS_RESULT';
      jobId: string;
      result: SerializableCompressionResult;
    }
  | {
      type: 'ERROR';
      jobId: string;
      code: PdfCompressionError['code'];
      message: string;
    };

// Register PDF.js WorkerMessageHandler synchronously in-thread so PDF.js uses its in-worker
// loopback fake worker without ever spawning nested workers or accessing window/document.
if (typeof globalThis !== 'undefined') {
  const mod = pdfjsWorkerModule as {
    WorkerMessageHandler?: unknown;
    default?: { WorkerMessageHandler?: unknown };
  };
  const resolved = mod?.WorkerMessageHandler
    ? mod
    : mod?.default?.WorkerMessageHandler
      ? mod.default
      : (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
  if (resolved) {
    (globalThis as Record<string, unknown>).pdfjsWorker = resolved;
  }
}

const cachedAnalyses = new Map<string, AnalyzedPdfContext>();
const cachedOriginals = new Map<string, Uint8Array>();
const activeControllers = new Map<string, AbortController>();

function serializeResult(res: CompressionExecutionResult): SerializableCompressionResult {
  const entries: SerializableCompressionResult['imageSummary']['resultsEntries'] = [];
  for (const [ref, item] of res.imageSummary.resultsByRef.entries()) {
    entries.push([
      ref,
      {
        objectRef: item.objectRef,
        action: item.action as ImageOptimizationAction,
        originalWidthPx: item.originalWidthPx,
        originalHeightPx: item.originalHeightPx,
        newWidthPx: item.newWidthPx,
        newHeightPx: item.newHeightPx,
        originalBytes: item.originalBytes,
        newBytes: item.newBytes,
        sMaskAction: item.sMaskAction,
        sMaskRef: item.sMaskRef,
        canonicalContentHash: item.canonicalContentHash,
      },
    ]);
  }
  return {
    status: res.status,
    mode: res.mode,
    outputBytes: res.outputBytes,
    originalSizeBytes: res.originalSizeBytes,
    compressedSizeBytes: res.compressedSizeBytes,
    candidateSizeBytes: res.candidateSizeBytes,
    reductionBytes: res.reductionBytes,
    reductionPercent: res.reductionPercent,
    durationMs: res.durationMs,
    analysis: res.analysis,
    deduplicatedImagesRemoved: res.deduplicatedImagesRemoved,
    externalizedInlineImages: res.externalizedInlineImages,
    reEncrypted: res.reEncrypted,
    validation: res.validation,
    statusMessage: res.statusMessage,
    imageSummary: {
      optimizedCount: res.imageSummary.optimizedCount,
      downsampledCount: res.imageSummary.downsampledCount,
      convertedToCcittCount: res.imageSummary.convertedToCcittCount,
      convertedToGrayscaleCount: res.imageSummary.convertedToGrayscaleCount,
      droppedOpaqueSmaskCount: res.imageSummary.droppedOpaqueSmaskCount,
      bytesBefore: res.imageSummary.bytesBefore,
      bytesAfter: res.imageSummary.bytesAfter,
      resultsEntries: entries,
    },
  };
}

function post(msg: WorkerOutMessage, transfer: Transferable[] = []) {
  (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(
    msg,
    transfer
  );
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'INIT') {
    if (msg.wasmUrl) {
      setCustomQpdfWasmUrl(msg.wasmUrl);
    }
    return;
  }

  if (msg.type === 'CLEAR_CACHE') {
    if (msg.fileId) {
      cachedAnalyses.delete(msg.fileId);
      cachedOriginals.delete(msg.fileId);
    } else {
      cachedAnalyses.clear();
      cachedOriginals.clear();
    }
    return;
  }

  if (msg.type === 'CANCEL') {
    const ctrl = activeControllers.get(msg.jobId);
    ctrl?.abort();
    return;
  }

  if (msg.type === 'ANALYZE') {
    const ctrl = new AbortController();
    activeControllers.set(msg.jobId, ctrl);
    try {
      // Keep only the current file analysis in memory so previous large PDFs release cleanly
      for (const existingKey of cachedAnalyses.keys()) {
        if (existingKey !== msg.fileId) cachedAnalyses.delete(existingKey);
      }
      for (const existingKey of cachedOriginals.keys()) {
        if (existingKey !== msg.fileId) cachedOriginals.delete(existingKey);
      }

      const originalCopy = new Uint8Array(msg.bytes);
      const ctx = await analyzePdfForCompression(originalCopy, {
        password: msg.password,
        pdfjsLibInstance: pdfjsLib,
        disablePdfjsWorker: true,
        signal: ctrl.signal,
        onProgress: (progress, message) =>
          post({ type: 'PROGRESS', jobId: msg.jobId, progress, message }),
      });

      cachedAnalyses.set(msg.fileId, ctx);
      cachedOriginals.set(msg.fileId, originalCopy);
      post({ type: 'ANALYZE_RESULT', jobId: msg.jobId, summary: ctx.summary });
    } catch (err: unknown) {
      if (err instanceof PdfCompressionError) {
        post({ type: 'ERROR', jobId: msg.jobId, code: err.code, message: err.message });
      } else {
        post({
          type: 'ERROR',
          jobId: msg.jobId,
          code: ctrl.signal.aborted ? 'CANCELLED' : 'UNKNOWN',
          message: err instanceof Error ? err.message : 'PDF analysis failed.',
        });
      }
    } finally {
      activeControllers.delete(msg.jobId);
    }
    return;
  }

  if (msg.type === 'COMPRESS') {
    const ctrl = new AbortController();
    activeControllers.set(msg.jobId, ctrl);
    try {
      const reused = cachedAnalyses.get(msg.fileId);
      const sourceBytes = msg.bytes ?? cachedOriginals.get(msg.fileId);
      if (!sourceBytes) {
        throw new PdfCompressionError(
          'INVALID_PDF',
          'Original PDF data was not available in worker memory.'
        );
      }

      const overrides: Partial<CompressionSettings> = {
        ...(msg.settingsOverrides ?? {}),
        ...(msg.preservePasswordProtectionOnEncryptedPdf !== undefined
          ? {
              preservePasswordProtectionOnEncryptedPdf:
                msg.preservePasswordProtectionOnEncryptedPdf,
            }
          : {}),
      };

      const res = await compressPdfDocument(sourceBytes, {
        mode: msg.mode,
        password: msg.password,
        allowModifyingSignedPdf: msg.allowModifyingSignedPdf,
        settingsOverrides: overrides,
        reusedAnalysisContext: reused,
        pdfjsLibInstance: pdfjsLib,
        disablePdfjsWorker: true,
        skipVisualValidation: msg.skipVisualValidation,
        signal: ctrl.signal,
        onProgress: (progress, message) =>
          post({ type: 'PROGRESS', jobId: msg.jobId, progress, message }),
      });

      const serializable = serializeResult(res);
      // Do not transfer the reused buffer if retained-original might still need a copy later; copy output cleanly if shared
      const transferBuf =
        res.status === 'retained-original'
          ? new Uint8Array(res.outputBytes).buffer
          : res.outputBytes.buffer;

      if (res.status === 'retained-original') {
        serializable.outputBytes = new Uint8Array(transferBuf);
      }

      post(
        { type: 'COMPRESS_RESULT', jobId: msg.jobId, result: serializable },
        [transferBuf]
      );
    } catch (err: unknown) {
      if (err instanceof PdfCompressionError) {
        post({ type: 'ERROR', jobId: msg.jobId, code: err.code, message: err.message });
      } else {
        post({
          type: 'ERROR',
          jobId: msg.jobId,
          code: ctrl.signal.aborted ? 'CANCELLED' : 'UNKNOWN',
          message: err instanceof Error ? err.message : 'PDF compression failed.',
        });
      }
    } finally {
      activeControllers.delete(msg.jobId);
    }
  }
};
