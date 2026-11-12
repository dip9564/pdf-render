import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  Loader2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { pdfjsLib } from '@/lib/pdfWorker';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn, formatFileSize } from '@/lib/utils';
import type { PageVisualMetrics } from '@/lib/compressPdf/validator';

interface BeforeAfterPreviewProps {
  originalBytes: Uint8Array;
  compressedBytes: Uint8Array;
  originalPassword?: string;
  compressedPassword?: string;
  pageCount: number;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  visualMetrics: PageVisualMetrics[];
}

export function BeforeAfterPreview({
  originalBytes,
  compressedBytes,
  originalPassword,
  compressedPassword,
  pageCount,
  originalSizeBytes,
  compressedSizeBytes,
  visualMetrics,
}: BeforeAfterPreviewProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const [mobilePane, setMobilePane] = useState<'compressed' | 'original'>('compressed');
  const [zoomed, setZoomed] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const origDocRef = useRef<PDFDocumentProxy | null>(null);
  const compDocRef = useRef<PDFDocumentProxy | null>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTasksRef = useRef<RenderTask[]>([]);

  useEffect(() => {
    setPageNumber(1);
  }, [originalBytes, compressedBytes]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDocs(true);
    setRenderError(null);

    const loadDocs = async () => {
      try {
        await Promise.all([
          origDocRef.current?.destroy().catch(() => {}),
          compDocRef.current?.destroy().catch(() => {}),
        ]);
        origDocRef.current = null;
        compDocRef.current = null;

        const [origDoc, compDoc] = await Promise.all([
          pdfjsLib.getDocument({
            data: new Uint8Array(originalBytes),
            password: originalPassword,
            verbosity: 0,
          }).promise,
          pdfjsLib.getDocument({
            data: new Uint8Array(compressedBytes),
            password: compressedPassword,
            verbosity: 0,
          }).promise,
        ]);

        if (cancelled) {
          await origDoc.destroy().catch(() => {});
          await compDoc.destroy().catch(() => {});
          return;
        }

        origDocRef.current = origDoc;
        compDocRef.current = compDoc;
        setLoadingDocs(false);
      } catch (err) {
        if (!cancelled) {
          setRenderError(
            err instanceof Error ? err.message : 'Unable to render page preview comparison.'
          );
          setLoadingDocs(false);
        }
      }
    };

    loadDocs();

    return () => {
      cancelled = true;
      for (const task of renderTasksRef.current) {
        try {
          task.cancel();
        } catch {
          // ignore
        }
      }
      renderTasksRef.current = [];
      origDocRef.current?.destroy().catch(() => {});
      compDocRef.current?.destroy().catch(() => {});
      origDocRef.current = null;
      compDocRef.current = null;
    };
  }, [originalBytes, compressedBytes, originalPassword, compressedPassword]);

  useEffect(() => {
    if (loadingDocs || renderError) return;
    const origDoc = origDocRef.current;
    const compDoc = compDocRef.current;
    if (!origDoc || !compDoc) return;

    let cancelled = false;
    for (const task of renderTasksRef.current) {
      try {
        task.cancel();
      } catch {
        // ignore
      }
    }
    renderTasksRef.current = [];

    const renderSide = async (
      doc: PDFDocumentProxy,
      canvas: HTMLCanvasElement | null,
      targetWidthCss: number
    ) => {
      if (!canvas) return;
      const safePage = Math.max(1, Math.min(pageNumber, doc.numPages));
      const page = await doc.getPage(safePage);
      if (cancelled) return;

      const baseVp = page.getViewport({ scale: 1.0 });
      const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const scale = Math.min(3, Math.max(0.5, (targetWidthCss / Math.max(1, baseVp.width)) * dpr));
      const vp = page.getViewport({ scale });

      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const task = page.render({ canvasContext: ctx, viewport: vp });
      renderTasksRef.current.push(task);
      try {
        await task.promise;
      } catch {
        // Ignore expected render cancellation when switching pages rapidly
      } finally {
        page.cleanup();
      }
    };

    setRenderingPages(true);
    const baseTargetWidth = zoomed ? 780 : 460;

    Promise.all([
      renderSide(origDoc, origCanvasRef.current, baseTargetWidth),
      renderSide(compDoc, compCanvasRef.current, baseTargetWidth),
    ])
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRenderingPages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadingDocs, renderError, pageNumber, zoomed, mobilePane]);

  const currentMetrics = visualMetrics.find((m) => m.pageNumber === pageNumber);

  return (
    <Card className="border-border bg-card shadow-card overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/70 bg-surface-secondary/60 dark:bg-secondary/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Columns2 className="h-4 w-4 text-primary shrink-0" />
              <span>Before &amp; After Preview</span>
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Compare visual clarity on Page {pageNumber} of {pageCount} before downloading
              {currentMetrics && (
                <span className="ml-1.5 text-teal dark:text-teal-400 font-medium">
                  • SSIM {currentMetrics.ssim.toFixed(3)} / PSNR {currentMetrics.psnrDb.toFixed(1)} dB
                </span>
              )}
            </CardDescription>
          </div>

          {/* Controls: Page Nav + Zoom */}
          <div className="flex flex-wrap items-center gap-1.5">
            {pageCount > 1 && (
              <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Previous preview page"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 text-xs font-medium tabular-nums text-foreground">
                  {pageNumber} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Next preview page"
                  disabled={pageNumber >= pageCount}
                  onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setZoomed((z) => !z)}
            >
              {zoomed ? (
                <>
                  <ZoomOut className="h-3.5 w-3.5" />
                  <span>Fit Width</span>
                </>
              ) : (
                <>
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>Inspect Detail</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Mobile pane switcher */}
        <div className="flex md:hidden items-center gap-1.5 pt-2">
          <button
            type="button"
            onClick={() => setMobilePane('original')}
            className={cn(
              'flex-1 h-8 rounded-lg text-xs font-medium border transition-colors',
              mobilePane === 'original'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground'
            )}
          >
            Before
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('compressed')}
            className={cn(
              'flex-1 h-8 rounded-lg text-xs font-medium border transition-colors',
              mobilePane === 'compressed'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground'
            )}
          >
            After
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 sm:p-5">
        {renderError ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            {renderError}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Before / Original */}
            <div
              className={cn(
                'flex flex-col rounded-xl border border-border bg-surface-secondary/70 dark:bg-secondary/35 p-2.5 sm:p-3 min-w-0',
                mobilePane !== 'original' && 'hidden md:flex'
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  Before
                </span>
                <Badge variant="outline" className="text-[11px] font-medium tabular-nums whitespace-nowrap shrink-0">
                  {formatFileSize(originalSizeBytes)}
                </Badge>
              </div>
              <div
                className={cn(
                  'relative rounded-lg border border-border/80 bg-white overflow-auto flex items-center justify-center min-h-[200px]',
                  zoomed ? 'max-h-[520px]' : 'max-h-[420px]'
                )}
              >
                {(loadingDocs || renderingPages) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px] z-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
                <canvas
                  ref={origCanvasRef}
                  className={cn(
                    'block mx-auto',
                    zoomed ? 'w-[145%] max-w-none h-auto' : 'w-full h-auto'
                  )}
                />
              </div>
            </div>

            {/* After / Compressed */}
            <div
              className={cn(
                'flex flex-col rounded-xl border border-primary/25 bg-primary/[0.03] dark:bg-primary/[0.06] p-2.5 sm:p-3 min-w-0',
                mobilePane !== 'compressed' && 'hidden md:flex'
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-primary" />
                  After
                </span>
                <Badge
                  variant="secondary"
                  className="text-[11px] font-semibold tabular-nums whitespace-nowrap shrink-0 bg-teal/15 text-teal dark:text-teal-300 border-teal/25"
                >
                  {formatFileSize(compressedSizeBytes)}
                </Badge>
              </div>
              <div
                className={cn(
                  'relative rounded-lg border border-border/80 bg-white overflow-auto flex items-center justify-center min-h-[200px]',
                  zoomed ? 'max-h-[520px]' : 'max-h-[420px]'
                )}
              >
                {(loadingDocs || renderingPages) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px] z-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
                <canvas
                  ref={compCanvasRef}
                  className={cn(
                    'block mx-auto',
                    zoomed ? 'w-[145%] max-w-none h-auto' : 'w-full h-auto'
                  )}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
