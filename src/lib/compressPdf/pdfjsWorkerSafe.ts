import type * as pdfjsModule from 'pdfjs-dist';

/**
 * Canvas factory supporting OffscreenCanvas (inside Web Workers) and HTMLCanvasElement (main thread).
 */
export class WorkerSafeCanvasFactory {
  create(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
    if ('width' in canvas) {
      canvas.width = w;
      canvas.height = h;
    }
    const context = canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    return { canvas, context };
  }

  reset(
    canvasAndContext: { canvas: OffscreenCanvas | HTMLCanvasElement | null; context: unknown },
    width: number,
    height: number
  ) {
    if (!canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
  }

  destroy(canvasAndContext: {
    canvas: OffscreenCanvas | HTMLCanvasElement | null;
    context: unknown;
  }) {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    }
  }
}

/**
 * DOM-free FilterFactory for Web Worker execution where `document` is unavailable.
 */
export class WorkerSafeFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  destroy() {
    // no-op
  }
}

export function canRenderInCurrentEnvironment(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
}

export function buildWorkerSafePdfjsParams(options: {
  data: Uint8Array;
  password?: string;
  inWorkerEnvironment?: boolean;
  canvasFactory?: WorkerSafeCanvasFactory;
}): Parameters<typeof pdfjsModule.getDocument>[0] {
  const isWorker =
    Boolean(options.inWorkerEnvironment) || typeof document === 'undefined';

  const params: Parameters<typeof pdfjsModule.getDocument>[0] = {
    data: new Uint8Array(options.data),
    ...(options.password !== undefined ? { password: options.password } : {}),
    disableFontFace: isWorker,
    useSystemFonts: !isWorker,
    verbosity: 0,
  };

  if (options.canvasFactory && canRenderInCurrentEnvironment()) {
    params.canvasFactory = options.canvasFactory as unknown as object;
  } else if (isWorker && typeof OffscreenCanvas !== 'undefined') {
    params.canvasFactory = new WorkerSafeCanvasFactory() as unknown as object;
  }

  if (isWorker) {
    params.filterFactory = new WorkerSafeFilterFactory() as unknown as object;
  }

  return params;
}
