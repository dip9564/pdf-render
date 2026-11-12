import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PDFDocument,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  Hash,
  Download,
  Loader2,
  RefreshCw,
  Eye,
  Sliders,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlertCircle,
  ArrowLeft,
  X,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';
import { readFileAsArrayBuffer, createPdfBlob, downloadBlob, formatFileSize, cn } from '@/lib/utils';
import { usePdfWorkflowTransfer } from '@/context/PdfWorkflowTransferContext';
import { toast } from 'sonner';

type Position = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
type FormatPreset = 'page_of_total' | 'n_slash_total' | 'n_only' | 'dash_n_dash' | 'custom';

export default function PageNumbers() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [firstPagePreview, setFirstPagePreview] = useState<string | null>(null);
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(1 / 1.414);
  const [previewPageNumber, setPreviewPageNumber] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);

  // Configuration
  const [position, setPosition] = useState<Position>('bottom-center');
  const [formatPreset, setFormatPreset] = useState<FormatPreset>('page_of_total');
  const [customFormat, setCustomFormat] = useState<string>('Page {n} of {total}');
  const [skipPagesCount, setSkipPagesCount] = useState<number>(0);
  const [startNumber, setStartNumber] = useState<number>(1);
  const [fontFamily, setFontFamily] = useState<string>('Helvetica');
  const [fontSize, setFontSize] = useState<number>(11);
  const [fontColor, setFontColor] = useState<string>('#333333');
  const [margin, setMargin] = useState<number>(30); // pt from edge

  // Mobile Tabs
  const [mobileTab, setMobileTab] = useState<'format' | 'style'>('format');

  const { renderPage, getPageCount } = usePdfRenderer();
  const [searchParams, setSearchParams] = useSearchParams();
  const { transferredPdf, clearTransferredPdf } = usePdfWorkflowTransfer();

  const [frontPageSourceMeta, setFrontPageSourceMeta] = useState<{
    originalPageCount: number;
    totalPages: number;
  } | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [missingTransferBannerDismissed, setMissingTransferBannerDismissed] =
    useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desktopCanvasRef = useRef<HTMLCanvasElement>(null);
  const inFlightTransferIdRef = useRef<string | null>(null);
  const completedTransferIdRef = useRef<string | null>(null);

  const isFromFrontPageQuery = searchParams.get('source') === 'front-page';

  const loadPdfFile = useCallback(
    async (
      selectedFile: File,
      options?: {
        fromFrontPage?: { originalPageCount: number };
        isCancelled?: () => boolean;
      }
    ): Promise<boolean> => {
      setFile(selectedFile);
      setLoading(true);
      setTransferError(null);
      setMissingTransferBannerDismissed(true);

      try {
        const buffer = await readFileAsArrayBuffer(selectedFile);
        if (options?.isCancelled?.()) return false;

        const count = await getPageCount(new Uint8Array(buffer.slice(0)));
        if (options?.isCancelled?.()) return false;

        const preview = await renderPage(new Uint8Array(buffer.slice(0)), 1, 1.0);
        if (options?.isCancelled?.()) return false;

        setPdfData(buffer);
        setPageCount(count);
        setPreviewPageNumber(1);
        setFirstPagePreview(preview);

        if (options?.fromFrontPage) {
          setFrontPageSourceMeta({
            originalPageCount: options.fromFrontPage.originalPageCount,
            totalPages: count,
          });
          toast.success(`Combined PDF "${selectedFile.name}" (${count} pages) loaded`);
        } else {
          setFrontPageSourceMeta(null);
          clearTransferredPdf();
          setSearchParams(
            (prev) => {
              if (!prev.has('source')) return prev;
              const next = new URLSearchParams(prev);
              next.delete('source');
              return next;
            },
            { replace: true }
          );
          toast.success(`Loaded "${selectedFile.name}" (${count} pages)`);
        }
        return true;
      } catch (err) {
        if (options?.isCancelled?.()) return false;
        console.error('Failed to load PDF', err);
        const msg = options?.fromFrontPage
          ? `Could not preload "${selectedFile.name}" from Front Page Generator. Please upload a PDF manually or rebuild it.`
          : 'Failed to parse document';
        toast.error(msg);
        if (options?.fromFrontPage) {
          setTransferError(msg);
          clearTransferredPdf();
        }
        setFile(null);
        setPdfData(null);
        setPageCount(0);
        setFirstPagePreview(null);
        setFrontPageSourceMeta(null);
        return false;
      } finally {
        if (!options?.isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    [getPageCount, renderPage, clearTransferredPdf, setSearchParams]
  );

  // Automatically preload combined PDF when transferred from Front Page Generator
  useEffect(() => {
    if (!transferredPdf || transferredPdf.target !== 'page-numbers') return;
    if (
      completedTransferIdRef.current === transferredPdf.id ||
      inFlightTransferIdRef.current === transferredPdf.id
    ) {
      return;
    }

    let cancelled = false;
    const transfer = transferredPdf;
    inFlightTransferIdRef.current = transfer.id;
    window.scrollTo({ top: 0, behavior: 'auto' });

    void loadPdfFile(transfer.file, {
      fromFrontPage: { originalPageCount: transfer.originalPageCount },
      isCancelled: () => cancelled,
    }).then((loaded) => {
      if (!cancelled) {
        inFlightTransferIdRef.current = null;
        if (loaded) {
          completedTransferIdRef.current = transfer.id;
        }
      }
    });

    return () => {
      cancelled = true;
      if (inFlightTransferIdRef.current === transfer.id) {
        inFlightTransferIdRef.current = null;
      }
    };
  }, [transferredPdf, loadPdfFile]);

  const handleFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      completedTransferIdRef.current = null;
      inFlightTransferIdRef.current = null;
      await loadPdfFile(files[0]);
    },
    [loadPdfFile]
  );

  // Helper to load image
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // Helper to format string
  const getFormattedNumberString = useCallback(
    (pageIdx: number) => {
      if (pageIdx < skipPagesCount) return '';
      const displayNum = (pageIdx - skipPagesCount) + startNumber;
      const displayTotal = Math.max(1, pageCount - skipPagesCount);

      switch (formatPreset) {
        case 'page_of_total':
          return `Page ${displayNum} of ${displayTotal}`;
        case 'n_slash_total':
          return `${displayNum} / ${displayTotal}`;
        case 'n_only':
          return `${displayNum}`;
        case 'dash_n_dash':
          return `- ${displayNum} -`;
        case 'custom':
          return customFormat
            .replace(/\{n\}/g, String(displayNum))
            .replace(/\{total\}/g, String(displayTotal));
        default:
          return `${displayNum}`;
      }
    },
    [formatPreset, customFormat, skipPagesCount, startNumber, pageCount]
  );

  // Render live preview on canvas
  useEffect(() => {
    if (loading || !firstPagePreview) return;
    let isCancelled = false;

    const render = async () => {
      try {
        const baseImg = await loadImage(firstPagePreview);
        if (baseImg.width && baseImg.height) {
          setPageAspectRatio(baseImg.width / baseImg.height);
        }

        if (isCancelled) return;
        const canvases = [canvasRef.current, desktopCanvasRef.current].filter(Boolean) as HTMLCanvasElement[];

        for (const canvas of canvases) {
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          canvas.width = baseImg.width;
          canvas.height = baseImg.height;

          // Draw base page
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(baseImg, 0, 0);

          // Get preview text
          const pageIdx = previewPageNumber - 1;
          const text = getFormattedNumberString(pageIdx);
          if (!text) continue;

          // Scale font according to canvas render scale
          const scaleFactor = canvas.width / 595.28; // standard A4 pt width
          const renderFontSize = Math.max(9, Math.round(fontSize * scaleFactor));

          ctx.font = `${renderFontSize}px ${fontFamily === 'Times-Roman' ? 'Times New Roman' : fontFamily === 'Courier' ? 'Courier New' : 'sans-serif'}`;
          ctx.fillStyle = fontColor;

          const renderMargin = margin * scaleFactor;
          let posX = canvas.width / 2;
          let posY = canvas.height - renderMargin;
          let align: CanvasTextAlign = 'center';

          if (position === 'bottom-center') {
            posX = canvas.width / 2;
            posY = canvas.height - renderMargin;
            align = 'center';
          } else if (position === 'bottom-right') {
            posX = canvas.width - renderMargin;
            posY = canvas.height - renderMargin;
            align = 'right';
          } else if (position === 'bottom-left') {
            posX = renderMargin;
            posY = canvas.height - renderMargin;
            align = 'left';
          } else if (position === 'top-center') {
            posX = canvas.width / 2;
            posY = renderMargin + renderFontSize;
            align = 'center';
          } else if (position === 'top-right') {
            posX = canvas.width - renderMargin;
            posY = renderMargin + renderFontSize;
            align = 'right';
          } else if (position === 'top-left') {
            posX = renderMargin;
            posY = renderMargin + renderFontSize;
            align = 'left';
          }

          ctx.textAlign = align;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(text, posX, posY);
        }
      } catch (err) {
        console.error('Error drawing page number preview', err);
      }
    };

    render();
    return () => {
      isCancelled = true;
    };
  }, [
    firstPagePreview,
    previewPageNumber,
    position,
    formatPreset,
    customFormat,
    skipPagesCount,
    startNumber,
    fontFamily,
    fontSize,
    fontColor,
    margin,
    loading,
    getFormattedNumberString,
  ]);

  // Switch preview page
  const handlePreviewPageChange = async (targetPage: number) => {
    if (!pdfData || targetPage < 1 || targetPage > pageCount) return;
    setPreviewPageNumber(targetPage);
    try {
      const preview = await renderPage(new Uint8Array(pdfData.slice(0)), targetPage, 1.0);
      setFirstPagePreview(preview);
    } catch (err) {
      console.error('Failed to change preview page', err);
    }
  };

  // Apply Page Numbers and Download
  const handleAddPageNumbers = async () => {
    if (!pdfData || !file) return;

    setProcessing(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const pages = pdfDoc.getPages();

      let pdfFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      if (fontFamily === 'Times-Roman') {
        pdfFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      } else if (fontFamily === 'Courier') {
        pdfFont = await pdfDoc.embedFont(StandardFonts.Courier);
      }

      // Convert hex color to rgb
      const cleanHex = fontColor.replace('#', '');
      const hexVal = parseInt(cleanHex, 16);
      const r = ((hexVal >> 16) & 255) / 255;
      const g = ((hexVal >> 8) & 255) / 255;
      const b = (hexVal & 255) / 255;
      const pdfColor = rgb(r, g, b);

      for (let i = 0; i < pages.length; i++) {
        const text = getFormattedNumberString(i);
        if (!text) continue;

        const page = pages[i];
        const { width, height } = page.getSize();
        const textWidth = pdfFont.widthOfTextAtSize(text, fontSize);

        let x = (width - textWidth) / 2;
        let y = margin;

        if (position === 'bottom-center') {
          x = (width - textWidth) / 2;
          y = margin;
        } else if (position === 'bottom-right') {
          x = width - margin - textWidth;
          y = margin;
        } else if (position === 'bottom-left') {
          x = margin;
          y = margin;
        } else if (position === 'top-center') {
          x = (width - textWidth) / 2;
          y = height - margin - fontSize;
        } else if (position === 'top-right') {
          x = width - margin - textWidth;
          y = height - margin - fontSize;
        } else if (position === 'top-left') {
          x = margin;
          y = height - margin - fontSize;
        }

        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font: pdfFont,
          color: pdfColor,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}_numbered.pdf`);
      toast.success('Numbered PDF generated and downloaded!');
    } catch (err) {
      console.error('Failed to add page numbers', err);
      toast.error('Failed to apply page numbers to document');
    } finally {
      setProcessing(false);
    }
  };

  const clearSourceQueryParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        if (!prev.has('source')) return prev;
        const next = new URLSearchParams(prev);
        next.delete('source');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const handleReset = () => {
    completedTransferIdRef.current = null;
    inFlightTransferIdRef.current = null;
    setFile(null);
    setPdfData(null);
    setPageCount(0);
    setPreviewPageNumber(1);
    setFirstPagePreview(null);
    setSkipPagesCount(0);
    setStartNumber(1);
    setFrontPageSourceMeta(null);
    setTransferError(null);
    setMissingTransferBannerDismissed(true);
    clearTransferredPdf();
    clearSourceQueryParam();
  };

  const handleDismissMissingTransferBanner = () => {
    setTransferError(null);
    setMissingTransferBannerDismissed(true);
    clearSourceQueryParam();
  };

  const showMissingTransferAlert =
    !file &&
    !loading &&
    !transferredPdf &&
    (Boolean(transferError) || (isFromFrontPageQuery && !missingTransferBannerDismissed));

  // Render live preview card
  const renderPreviewCard = (isMobile: boolean) => (
    <Card className={cn(isMobile ? 'shadow-xs overflow-hidden' : 'sticky top-20')}>
      <CardHeader className={cn(isMobile ? 'py-2 px-3 border-b flex flex-row items-center justify-between space-y-0' : 'pb-3')}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Eye className="h-4 w-4 text-primary shrink-0" />
          <CardTitle className={cn(isMobile ? 'text-xs font-semibold' : 'text-base')}>
            Live Page {previewPageNumber} Preview
          </CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            disabled={previewPageNumber <= 1}
            onClick={() => handlePreviewPageChange(previewPageNumber - 1)}
          >
            Prev
          </Button>
          <span className="text-[11px] font-medium px-1">
            {previewPageNumber} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            disabled={previewPageNumber >= pageCount}
            onClick={() => handlePreviewPageChange(previewPageNumber + 1)}
          >
            Next
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cn('flex flex-col items-center justify-center', isMobile ? 'p-2.5 space-y-2' : 'p-4 space-y-3')}>
        {loading ? (
          <div className="py-14 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs">Rendering preview...</p>
          </div>
        ) : (
          <div className="w-full flex items-center justify-center py-1 select-none">
            <div
              className="relative rounded-md shadow-xl border border-border overflow-hidden bg-white transition-all duration-150 flex items-center justify-center"
              style={{
                aspectRatio: `${pageAspectRatio}`,
                height: isMobile ? '280px' : '480px',
                maxHeight: isMobile ? '300px' : '520px',
                maxWidth: '100%',
              }}
            >
              <canvas
                ref={isMobile ? canvasRef : desktopCanvasRef}
                className="w-full h-full object-contain block bg-white"
              />
            </div>
          </div>
        )}
        <p className="text-[10px] sm:text-[11px] text-center text-muted-foreground truncate w-full">
          Format: {getFormattedNumberString(previewPageNumber - 1) || '(Skipped)'} • Pos: {position} • Size: {fontSize}pt
        </p>
      </CardContent>
    </Card>
  );

  // Position & Format controls
  const renderFormatControls = () => {
    const sampleTotal = Math.max(1, pageCount - skipPagesCount);

    return (
      <div className="space-y-4">
        {/* Front Page Combined Workflow Options (synced to skipPagesCount & startNumber) */}
        {frontPageSourceMeta && (
          <div className="p-3 rounded-lg border border-primary/30 bg-primary/[0.04] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-semibold">Front Page Numbering Rule</span>
              </div>
              <Badge variant="secondary" className="text-[10px]">
                Page 1: Cover + {frontPageSourceMeta.originalPageCount} Original
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setSkipPagesCount(0)}
                className={cn(
                  'flex flex-col items-start text-left p-2 rounded-lg border text-xs transition-all touch-manipulation',
                  skipPagesCount === 0
                    ? 'border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/30'
                    : 'border-border bg-card hover:bg-muted/50 text-foreground'
                )}
              >
                <span>Include Front Page</span>
                <span className="text-[10px] font-normal text-muted-foreground mt-0.5">
                  Starts numbering on Page 1
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSkipPagesCount(pageCount > 1 ? 1 : 0)}
                disabled={pageCount <= 1}
                className={cn(
                  'flex flex-col items-start text-left p-2 rounded-lg border text-xs transition-all touch-manipulation',
                  skipPagesCount === 1
                    ? 'border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/30'
                    : 'border-border bg-card hover:bg-muted/50 text-foreground'
                )}
              >
                <span>Start from Original Page 1</span>
                <span className="text-[10px] font-normal text-muted-foreground mt-0.5">
                  Skips Front Page, starts on Page 2
                </span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
              <div className="flex items-center gap-2">
                <Label htmlFor="fp-pn-start-num" className="text-[11px] text-muted-foreground">
                  Starting Number:
                </Label>
                <Input
                  id="fp-pn-start-num"
                  type="number"
                  min={1}
                  value={startNumber}
                  onChange={(e) => setStartNumber(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="h-7 w-16 text-xs text-center font-semibold"
                />
              </div>

              {pageCount >= 2 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={previewPageNumber === 1 ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => handlePreviewPageChange(1)}
                  >
                    Page 1 (Cover)
                  </Button>
                  <Button
                    type="button"
                    variant={previewPageNumber === 2 ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => handlePreviewPageChange(2)}
                  >
                    Page 2 (Original)
                  </Button>
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground leading-snug">
              {skipPagesCount === 0 ? (
                <>
                  Page 1 starts at <span className="font-semibold text-foreground">{startNumber}</span>
                  {' · '}
                  Sample: <span className="font-medium text-foreground">{getFormattedNumberString(0) || '—'}</span>
                </>
              ) : (
                <>
                  First {skipPagesCount} {skipPagesCount === 1 ? 'page (Front Page)' : 'pages'} unnumbered
                  {pageCount > skipPagesCount ? (
                    <>
                      {' · '}Page {skipPagesCount + 1} starts at{' '}
                      <span className="font-semibold text-foreground">{startNumber}</span>
                      {' · '}Sample:{' '}
                      <span className="font-medium text-foreground">
                        {getFormattedNumberString(skipPagesCount) || '—'}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
        )}

        {/* Position Grid */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Position on Page</Label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'top-left', label: 'Top Left', icon: AlignLeft },
              { id: 'top-center', label: 'Top Center', icon: AlignCenter },
              { id: 'top-right', label: 'Top Right', icon: AlignRight },
              { id: 'bottom-left', label: 'Bottom Left', icon: AlignLeft },
              { id: 'bottom-center', label: 'Bottom Center', icon: AlignCenter },
              { id: 'bottom-right', label: 'Bottom Right', icon: AlignRight },
            ].map((pos) => {
              const isSelected = position === pos.id;
              return (
                <button
                  key={pos.id}
                  type="button"
                  onClick={() => setPosition(pos.id as Position)}
                  className={cn(
                    'flex flex-col items-center justify-center p-2 rounded-lg border text-xs transition-all touch-manipulation',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                  )}
                >
                  <pos.icon className="h-4 w-4 mb-1" />
                  <span className="text-[11px]">{pos.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preset Formats */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Numbering Format</Label>
          <Select value={formatPreset} onValueChange={(v) => setFormatPreset(v as FormatPreset)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="page_of_total">
                Page {startNumber} of {sampleTotal} (Recommended)
              </SelectItem>
              <SelectItem value="n_slash_total">
                {startNumber} / {sampleTotal}
              </SelectItem>
              <SelectItem value="n_only">{startNumber} (Number only)</SelectItem>
              <SelectItem value="dash_n_dash">- {startNumber} -</SelectItem>
              <SelectItem value="custom">Custom Format Template</SelectItem>
            </SelectContent>
          </Select>

          {formatPreset === 'custom' && (
            <div className="pt-1.5 space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Use {'{n}'} for page number and {'{total}'} for total pages:
              </Label>
              <Input
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value)}
                placeholder="e.g. Doc Page {n} of {total}"
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
        </div>

      {/* Skip Initial Pages (Cover / Intro) */}
      <div className="p-3 rounded-lg border bg-muted/20 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs font-semibold cursor-pointer">
              Skip Initial Pages (Cover / Intro)
            </Label>
            <p className="text-[10px] text-muted-foreground">
              {skipPagesCount > 0
                ? `Skipping first ${skipPagesCount} ${skipPagesCount === 1 ? 'page' : 'pages'}`
                : 'Do not place page numbers on the first pages'}
            </p>
          </div>
          <Switch
            checked={skipPagesCount > 0}
            onCheckedChange={(checked) => setSkipPagesCount(checked ? 1 : 0)}
          />
        </div>

        {skipPagesCount > 0 && (
          <div className="pt-2 border-t space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Quick Presets:</span>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3].map((num) => (
                  <Button
                    key={num}
                    type="button"
                    variant={skipPagesCount === num ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2.5 text-xs touch-manipulation"
                    onClick={() => setSkipPagesCount(num)}
                  >
                    {num} {num === 1 ? 'page' : 'pages'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] text-muted-foreground">Or choose exact count:</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={Math.max(1, pageCount - 1)}
                  value={skipPagesCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) {
                      setSkipPagesCount(Math.min(Math.max(1, val), Math.max(1, pageCount - 1)));
                    }
                  }}
                  className="h-7 w-16 text-xs text-center font-bold"
                />
                <span className="text-xs text-muted-foreground">pages</span>
              </div>
            </div>

            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              ✓ Page numbers will begin on Page {skipPagesCount + 1}
            </p>
          </div>
        )}
        </div>
      </div>
    );
  };

  // Style & Typography controls
  const renderStyleControls = () => (
    <div className="space-y-4">
      {/* Font Family */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Font Family</Label>
        <Select value={fontFamily} onValueChange={setFontFamily}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Helvetica">Helvetica (Clean Sans-Serif)</SelectItem>
            <SelectItem value="Times-Roman">Times New Roman (Serif)</SelectItem>
            <SelectItem value="Courier">Courier (Monospace)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Font Size & Color */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <Label className="text-xs font-medium">Font Size</Label>
            <span className="font-semibold text-[11px]">{fontSize}pt</span>
          </div>
          <Slider
            value={[fontSize]}
            min={8}
            max={24}
            step={1}
            onValueChange={([v]) => setFontSize(v)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Text Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={fontColor}
              onChange={(e) => setFontColor(e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer p-0.5 bg-card"
            />
            <Input
              value={fontColor}
              onChange={(e) => setFontColor(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* Margin from Edge */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <Label className="text-xs font-medium">Margin from Page Edge</Label>
          <span className="font-semibold text-[11px]">{margin}pt</span>
        </div>
        <Slider
          value={[margin]}
          min={10}
          max={60}
          step={2}
          onValueChange={([v]) => setMargin(v)}
        />
      </div>

      {/* Start Numbering From */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Start Numbering From</Label>
        <Input
          type="number"
          min={1}
          value={startNumber}
          onChange={(e) => setStartNumber(Math.max(1, parseInt(e.target.value) || 1))}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-5xl',
        file && 'pb-24 lg:pb-8'
      )}
    >
      <div className="mb-4 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <Hash className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Add Page Numbers</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Insert customizable page numbers, headers, and footers into your PDF documents.
        </p>
      </div>

      {!file ? (
        <div className="space-y-4">
          {showMissingTransferAlert && (
            <div
              role="alert"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 sm:p-4 text-xs sm:text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3"
            >
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="font-semibold leading-snug">
                  {transferError
                    ? 'Transferred combined PDF could not be loaded'
                    : 'Transferred PDF is no longer available after page refresh'}
                </p>
                <p className="text-xs leading-relaxed opacity-90">
                  {transferError
                    ? transferError
                    : 'Combined front-page PDFs are transferred in memory for privacy and are cleared when the browser page reloads. Return to Front Page Generator to send it again, or upload a PDF manually below.'}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-amber-500/40 bg-card hover:bg-muted">
                    <Link to="/front-page">
                      <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                      <span>Back to Front Page Generator</span>
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs px-2.5"
                    onClick={handleDismissMissingTransferBanner}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismissMissingTransferBanner}
                className="p-1 rounded-md opacity-70 hover:opacity-100 shrink-0"
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <Card>
            <CardContent className="p-5 sm:p-7">
              <FileUploader
                accept=".pdf,application/pdf"
                multiple={false}
                onFilesSelected={handleFileSelected}
                label="Select or drop a PDF document"
                description="Add headers, footers, and page numbers with live preview"
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {/* File details banner */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                PDF
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <p className="text-xs font-semibold truncate max-w-[210px] sm:max-w-md">{file.name}</p>
                  {frontPageSourceMeta && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                      Front Page Combined
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {loading && pageCount === 0
                    ? 'Analyzing pages...'
                    : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}{' '}
                  • {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 shrink-0"
              onClick={handleReset}
              disabled={loading || processing}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Change
            </Button>
          </div>

          {/* MOBILE VIEW (lg:hidden): Preview on top, tab controls below */}
          <div className="lg:hidden space-y-3">
            {renderPreviewCard(true)}

            {/* Segmented Tab Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl text-xs font-medium border shadow-xs">
              <button
                type="button"
                onClick={() => setMobileTab('format')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors touch-manipulation',
                  mobileTab === 'format'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Hash className="h-3.5 w-3.5 text-primary" />
                Position &amp; Format
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('style')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-colors touch-manipulation',
                  mobileTab === 'style'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Sliders className="h-3.5 w-3.5 text-primary" />
                Style &amp; Font
              </button>
            </div>

            {/* Controls Content */}
            <Card>
              <CardContent className="p-3.5">
                {mobileTab === 'format' ? renderFormatControls() : renderStyleControls()}
              </CardContent>
            </Card>

            {/* Floating Mobile Bottom Action Bar */}
            <div className="fixed bottom-4 left-3 right-3 z-40">
              <div className="bg-card/95 backdrop-blur-md border border-primary/35 rounded-xl p-2.5 shadow-xl flex items-center justify-between gap-2">
                <div className="text-xs font-semibold pl-1">
                  <span>
                    {skipPagesCount > 0
                      ? `${Math.max(0, pageCount - skipPagesCount)} of ${pageCount} Pages`
                      : `${pageCount} Pages Numbered`}
                  </span>
                </div>
                <Button
                  onClick={handleAddPageNumbers}
                  disabled={loading || processing}
                  size="sm"
                  className="text-xs h-8 px-3 shadow-xs"
                >
                  {processing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1" />
                  )}
                  Save &amp; Download
                </Button>
              </div>
            </div>
          </div>

          {/* DESKTOP VIEW (hidden lg:grid): 2 Column layout */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Numbering &amp; Placement</CardTitle>
                  <CardDescription className="text-xs">
                    Configure positions, numbering formats, and cover page behavior.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {renderFormatControls()}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Typography &amp; Styling</CardTitle>
                  <CardDescription className="text-xs">
                    Customize font family, size, color, and margins.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {renderStyleControls()}
                  <div className="pt-2 border-t">
                    <Button
                      onClick={handleAddPageNumbers}
                      disabled={loading || processing}
                      className="w-full"
                    >
                      {processing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Apply Page Numbers &amp; Download PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-5">
              {renderPreviewCard(false)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
