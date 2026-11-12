import { pdfjsLib } from '@/lib/pdfWorker';
import qpdfWasmAssetUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
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
import {
  ImageOptimizationSummary,
  OptimizedImageResult,
} from './imageOptimizer';
import type {
  SerializableCompressionResult,
  WorkerInMessage,
  WorkerOutMessage,
} from './compressWorker';

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (progress: number, message: string) => void;
  cleanupAbort?: () => void;
}

class CompressPdfClient {
  private worker: Worker | null = null;
  private workerCachedFileIds = new Set<string>();
  private jobs = new Map<string, PendingJob>();
  private jobCounter = 0;

  // Fallback cache for environments without Worker or OffscreenCanvas
  private fallbackAnalysisCache = new Map<string, AnalyzedPdfContext>();

  private canUseWorker(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function'
    );
  }

  private resolveAbsoluteWasmUrl(): string {
    try {
      return new URL(qpdfWasmAssetUrl, window.location.href).href;
    } catch {
      return qpdfWasmAssetUrl;
    }
  }

  private getOrCreateWorker(): Worker {
    if (this.worker) return this.worker;

    const w = new Worker(new URL('./compressWorker.ts', import.meta.url), {
      type: 'module',
    });

    w.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      const job = this.jobs.get(msg.jobId);
      if (!job) return;

      if (msg.type === 'PROGRESS') {
        job.onProgress?.(msg.progress, msg.message);
        return;
      }

      this.jobs.delete(msg.jobId);
      job.cleanupAbort?.();

      if (msg.type === 'ANALYZE_RESULT') {
        job.resolve(msg.summary);
        return;
      }

      if (msg.type === 'COMPRESS_RESULT') {
        job.resolve(this.rehydrateCompressionResult(msg.result));
        return;
      }

      if (msg.type === 'ERROR') {
        job.reject(new PdfCompressionError(msg.code, msg.message));
      }
    };

    w.onerror = (err) => {
      const activeJobs = Array.from(this.jobs.entries());
      this.terminateWorkerInternal();
      for (const [, job] of activeJobs) {
        job.cleanupAbort?.();
        job.reject(
          new PdfCompressionError(
            'UNKNOWN',
            err?.message || 'PDF compression worker terminated unexpectedly.'
          )
        );
      }
    };

    const initMsg: WorkerInMessage = {
      type: 'INIT',
      wasmUrl: this.resolveAbsoluteWasmUrl(),
    };
    w.postMessage(initMsg);
    this.worker = w;
    return w;
  }

  private terminateWorkerInternal() {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    this.workerCachedFileIds.clear();
    this.jobs.clear();
  }

  private rehydrateCompressionResult(
    raw: SerializableCompressionResult
  ): CompressionExecutionResult {
    const resultsByRef = new Map<string, OptimizedImageResult>();
    for (const [ref, entry] of raw.imageSummary.resultsEntries) {
      resultsByRef.set(ref, entry as OptimizedImageResult);
    }
    const imageSummary: ImageOptimizationSummary = {
      resultsByRef,
      optimizedCount: raw.imageSummary.optimizedCount,
      downsampledCount: raw.imageSummary.downsampledCount,
      convertedToCcittCount: raw.imageSummary.convertedToCcittCount,
      convertedToGrayscaleCount: raw.imageSummary.convertedToGrayscaleCount,
      droppedOpaqueSmaskCount: raw.imageSummary.droppedOpaqueSmaskCount,
      bytesBefore: raw.imageSummary.bytesBefore,
      bytesAfter: raw.imageSummary.bytesAfter,
    };

    return {
      status: raw.status,
      mode: raw.mode,
      outputBytes: raw.outputBytes,
      originalSizeBytes: raw.originalSizeBytes,
      compressedSizeBytes: raw.compressedSizeBytes,
      candidateSizeBytes: raw.candidateSizeBytes,
      reductionBytes: raw.reductionBytes,
      reductionPercent: raw.reductionPercent,
      durationMs: raw.durationMs,
      analysis: raw.analysis,
      imageSummary,
      deduplicatedImagesRemoved: raw.deduplicatedImagesRemoved,
      externalizedInlineImages: raw.externalizedInlineImages,
      reEncrypted: raw.reEncrypted,
      validation: raw.validation,
      statusMessage: raw.statusMessage,
    };
  }

  private nextJobId(prefix: string): string {
    this.jobCounter += 1;
    return `${prefix}_${Date.now()}_${this.jobCounter}`;
  }

  async analyze(
    originalBytes: Uint8Array,
    options: {
      fileId: string;
      password?: string;
      signal?: AbortSignal;
      onProgress?: (progress: number, message: string) => void;
    }
  ): Promise<PdfAnalysisSummary> {
    if (options.signal?.aborted) {
      throw new PdfCompressionError('CANCELLED', 'Analysis cancelled by user.');
    }

    if (!this.canUseWorker()) {
      const ctx = await analyzePdfForCompression(originalBytes, {
        password: options.password,
        pdfjsLibInstance: pdfjsLib,
        disablePdfjsWorker: false,
        signal: options.signal,
        onProgress: options.onProgress,
      });
      this.fallbackAnalysisCache.clear();
      this.fallbackAnalysisCache.set(options.fileId, ctx);
      return ctx.summary;
    }

    const worker = this.getOrCreateWorker();
    const jobId = this.nextJobId('analyze');

    return new Promise<PdfAnalysisSummary>((resolve, reject) => {
      const onAbort = () => {
        if (!this.jobs.has(jobId)) return;
        this.jobs.delete(jobId);
        // Terminate synchronously running WASM immediately on user cancel
        this.terminateWorkerInternal();
        reject(new PdfCompressionError('CANCELLED', 'Analysis cancelled by user.'));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      this.jobs.set(jobId, {
        resolve: (val) => {
          this.workerCachedFileIds.clear();
          this.workerCachedFileIds.add(options.fileId);
          resolve(val as PdfAnalysisSummary);
        },
        reject,
        onProgress: options.onProgress,
        cleanupAbort: () => options.signal?.removeEventListener('abort', onAbort),
      });

      const msg: WorkerInMessage = {
        type: 'ANALYZE',
        jobId,
        fileId: options.fileId,
        bytes: originalBytes,
        password: options.password,
      };
      worker.postMessage(msg);
    });
  }

  async compress(
    originalBytes: Uint8Array,
    options: {
      fileId: string;
      mode: CompressionMode;
      password?: string;
      allowModifyingSignedPdf?: boolean;
      preservePasswordProtectionOnEncryptedPdf?: boolean;
      settingsOverrides?: Partial<CompressionSettings>;
      skipVisualValidation?: boolean;
      signal?: AbortSignal;
      onProgress?: (progress: number, message: string) => void;
    }
  ): Promise<CompressionExecutionResult> {
    if (options.signal?.aborted) {
      throw new PdfCompressionError('CANCELLED', 'Compression cancelled by user.');
    }

    if (!this.canUseWorker()) {
      const reused = this.fallbackAnalysisCache.get(options.fileId);
      return compressPdfDocument(originalBytes, {
        mode: options.mode,
        password: options.password,
        allowModifyingSignedPdf: options.allowModifyingSignedPdf,
        settingsOverrides: {
          ...(options.settingsOverrides ?? {}),
          ...(options.preservePasswordProtectionOnEncryptedPdf !== undefined
            ? {
                preservePasswordProtectionOnEncryptedPdf:
                  options.preservePasswordProtectionOnEncryptedPdf,
              }
            : {}),
        },
        reusedAnalysisContext: reused,
        pdfjsLibInstance: pdfjsLib,
        disablePdfjsWorker: false,
        skipVisualValidation: options.skipVisualValidation,
        signal: options.signal,
        onProgress: options.onProgress,
      });
    }

    const worker = this.getOrCreateWorker();
    const jobId = this.nextJobId('compress');
    const isCachedInWorker = this.workerCachedFileIds.has(options.fileId);

    return new Promise<CompressionExecutionResult>((resolve, reject) => {
      const onAbort = () => {
        if (!this.jobs.has(jobId)) return;
        this.jobs.delete(jobId);
        // Immediate non-blocking cancellation even if QPDF WASM is mid-callMain
        this.terminateWorkerInternal();
        reject(new PdfCompressionError('CANCELLED', 'Compression cancelled by user.'));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      this.jobs.set(jobId, {
        resolve: (val) => resolve(val as CompressionExecutionResult),
        reject,
        onProgress: options.onProgress,
        cleanupAbort: () => options.signal?.removeEventListener('abort', onAbort),
      });

      const msg: WorkerInMessage = {
        type: 'COMPRESS',
        jobId,
        fileId: options.fileId,
        bytes: isCachedInWorker ? undefined : originalBytes,
        mode: options.mode,
        password: options.password,
        allowModifyingSignedPdf: options.allowModifyingSignedPdf,
        preservePasswordProtectionOnEncryptedPdf:
          options.preservePasswordProtectionOnEncryptedPdf,
        settingsOverrides: options.settingsOverrides,
        skipVisualValidation: options.skipVisualValidation,
      };
      worker.postMessage(msg);
    });
  }

  clearFileCache(fileId?: string) {
    if (fileId) this.fallbackAnalysisCache.delete(fileId);
    else this.fallbackAnalysisCache.clear();
    if (this.worker) {
      if (fileId) this.workerCachedFileIds.delete(fileId);
      else this.workerCachedFileIds.clear();
      const msg: WorkerInMessage = { type: 'CLEAR_CACHE', fileId };
      this.worker.postMessage(msg);
    }
  }

  dispose() {
    this.fallbackAnalysisCache.clear();
    this.terminateWorkerInternal();
  }
}

export const compressPdfClient = new CompressPdfClient();
