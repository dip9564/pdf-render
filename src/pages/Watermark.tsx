import { useState, useCallback, useRef, useEffect } from 'react';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { toast } from 'sonner';
import {
  Droplets,
  Download,
  Loader2,
  RefreshCw,
  Type,
  Image as ImageIcon,
  CheckSquare,
  Square,
  Upload,
  Settings2,
} from 'lucide-react';
import { cn, formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
  }
  const intVal = parseInt(cleanHex, 16);
  return {
    r: ((intVal >> 16) & 255) / 255,
    g: ((intVal >> 8) & 255) / 255,
    b: (intVal & 255) / 255,
  };
}

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
};

interface WatermarkFontSpec {
  id: 'Helvetica' | 'Times-Roman' | 'Courier';
  label: string;
  canvasStack: string;
  pdfStandardFont: StandardFonts;
}

const WATERMARK_FONTS: WatermarkFontSpec[] = [
  {
    id: 'Helvetica',
    label: 'Helvetica',
    canvasStack:
      '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "Nimbus Sans", "Noto Sans", sans-serif',
    pdfStandardFont: StandardFonts.HelveticaBold,
  },
  {
    id: 'Times-Roman',
    label: 'Times New Roman',
    canvasStack:
      '"Times New Roman", Times, Georgia, "Liberation Serif", "Nimbus Roman", "Noto Serif", serif',
    pdfStandardFont: StandardFonts.TimesRomanBold,
  },
  {
    id: 'Courier',
    label: 'Courier',
    canvasStack:
      '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", "Noto Sans Mono", monospace',
    pdfStandardFont: StandardFonts.CourierBold,
  },
];

function resolveWatermarkFont(family: string): WatermarkFontSpec {
  const exact = WATERMARK_FONTS.find((f) => f.id === family);
  if (exact) return exact;

  const normalized = family.trim().toLowerCase();
  if (
    normalized.includes('times') ||
    normalized.includes('georgia') ||
    normalized.includes('serif')
  ) {
    return WATERMARK_FONTS[1];
  }
  if (normalized.includes('courier') || normalized.includes('mono')) {
    return WATERMARK_FONTS[2];
  }
  return WATERMARK_FONTS[0];
}


export default function Watermark() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [firstPagePreview, setFirstPagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);

  // Watermark mode
  const [watermarkType, setWatermarkType] = useState<'text' | 'image'>('text');

  // Text options
  const [text, setText] = useState<string>('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState<number>(48);
  const [fontFamily, setFontFamily] = useState<string>('Helvetica');
  const [textColor, setTextColor] = useState<string>('#ff0000');
  const [opacity, setOpacity] = useState<number>(0.3);
  const [rotation, setRotation] = useState<number>(45);
  const [position, setPosition] = useState<string>('center');

  // Image watermark options
  const [watermarkImageFile, setWatermarkImageFile] = useState<File | null>(null);
  const [watermarkImageData, setWatermarkImageData] = useState<ArrayBuffer | null>(null);
  const [watermarkImagePreview, setWatermarkImagePreview] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState<number>(50); // percentage

  // Page selection options
  const [targetPagesMode, setTargetPagesMode] = useState<'all' | 'custom'>('all');
  const [customPagesInput, setCustomPagesInput] = useState<string>('1');

  const { renderPage, getPageCount } = usePdfRenderer();
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(1 / 1.414);
  const desktopCanvasRef = useRef<HTMLCanvasElement>(null);
  const mobileCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageCacheRef = useRef<{ src: string; img: HTMLImageElement } | null>(null);
  const previewRenderSeqRef = useRef<number>(0);
  const [mobileTab, setMobileTab] = useState<'content' | 'layout'>('content');

  const handleFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const selectedFile = files[0];
      setFile(selectedFile);
      setLoading(true);

      try {
        const buffer = await readFileAsArrayBuffer(selectedFile);
        setPdfData(buffer);
        const count = await getPageCount(new Uint8Array(buffer.slice(0)));
        setPageCount(count);

        try {
          const preview = await renderPage(new Uint8Array(buffer.slice(0)), 1, 1.0);
          setFirstPagePreview(preview);
        } catch (e) {
          console.error('Error rendering first page', e);
        }

        toast.success(`Loaded "${selectedFile.name}" with ${count} pages`);
      } catch (err) {
        console.error('Error loading PDF', err);
        toast.error('Failed to parse PDF document');
        setFile(null);
        setPdfData(null);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount, renderPage]
  );

  const loadWatermarkImageFile = async (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    const isValid =
      selectedFile.type === 'image/png' ||
      selectedFile.type === 'image/jpeg' ||
      /\.(png|jpe?g)$/i.test(selectedFile.name);
    if (!isValid) {
      toast.error('Please select a PNG or JPG image');
      return;
    }

    setWatermarkImageFile(selectedFile);
    const buffer = await readFileAsArrayBuffer(selectedFile);
    setWatermarkImageData(buffer);

    const reader = new FileReader();
    reader.onload = () => setWatermarkImagePreview(reader.result as string);
    reader.readAsDataURL(selectedFile);
  };

  const handleImageWatermarkSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    e.target.value = '';
    await loadWatermarkImageFile(selectedFile);
  };

  // Draw overlay preview on canvas
  useEffect(() => {
    if (!firstPagePreview || loading) return;

    let isCancelled = false;
    const renderSeq = ++previewRenderSeqRef.current;

    const renderPreview = async () => {
      try {
        const fontSpec = resolveWatermarkFont(fontFamily);
        const fontDeclaration = `bold ${fontSize}px ${fontSpec.canvasStack}`;

        let baseImg: HTMLImageElement;
        if (baseImageCacheRef.current?.src === firstPagePreview) {
          baseImg = baseImageCacheRef.current.img;
        } else {
          baseImg = await loadImage(firstPagePreview);
          baseImageCacheRef.current = { src: firstPagePreview, img: baseImg };
        }
        if (isCancelled || renderSeq !== previewRenderSeqRef.current) return;

        if (baseImg.width && baseImg.height) {
          setPageAspectRatio(baseImg.width / baseImg.height);
        }

        if (watermarkType === 'text' && typeof document !== 'undefined' && 'fonts' in document) {
          try {
            await document.fonts.ready;
            await document.fonts.load(fontDeclaration, text || 'CONFIDENTIAL');
          } catch {
            // Fall back cleanly if browser rejects font-loading query
          }
          if (isCancelled || renderSeq !== previewRenderSeqRef.current) return;
        }

        let wmImg: HTMLImageElement | null = null;
        if (watermarkType === 'image' && watermarkImagePreview) {
          try {
            wmImg = await loadImage(watermarkImagePreview);
          } catch (e) {
            console.error('Error loading watermark image', e);
          }
        }

        if (isCancelled || renderSeq !== previewRenderSeqRef.current) return;

        const canvases = [desktopCanvasRef.current, mobileCanvasRef.current].filter(
          Boolean
        ) as HTMLCanvasElement[];

        if (canvases.length === 0) return;

        for (const canvas of canvases) {
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          canvas.width = baseImg.width;
          canvas.height = baseImg.height;

          // Draw original page
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(baseImg, 0, 0);

          // Determine coordinates
          let x = canvas.width / 2;
          let y = canvas.height / 2;

          if (position === 'top') {
            x = canvas.width / 2;
            y = canvas.height * 0.15;
          } else if (position === 'bottom') {
            x = canvas.width / 2;
            y = canvas.height * 0.85;
          } else if (position === 'top-left') {
            x = canvas.width * 0.15;
            y = canvas.height * 0.15;
          } else if (position === 'top-right') {
            x = canvas.width * 0.85;
            y = canvas.height * 0.15;
          } else if (position === 'bottom-left') {
            x = canvas.width * 0.15;
            y = canvas.height * 0.85;
          } else if (position === 'bottom-right') {
            x = canvas.width * 0.85;
            y = canvas.height * 0.85;
          }

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate((-rotation * Math.PI) / 180);
          ctx.globalAlpha = opacity;

          if (watermarkType === 'text') {
            ctx.fillStyle = textColor;
            ctx.font = fontDeclaration;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
          } else if (watermarkType === 'image' && wmImg) {
            const w = wmImg.width * (imageScale / 100);
            const h = wmImg.height * (imageScale / 100);
            ctx.drawImage(wmImg, -w / 2, -h / 2, w, h);
          }

          ctx.restore();
        }
      } catch (err) {
        console.error('Error rendering watermark preview:', err);
      }
    };

    renderPreview();

    return () => {
      isCancelled = true;
    };
  }, [
    firstPagePreview,
    loading,
    watermarkType,
    text,
    fontSize,
    fontFamily,
    textColor,
    opacity,
    rotation,
    position,
    imageScale,
    watermarkImagePreview,
  ]);

  const handleApplyWatermark = async () => {
    if (!pdfData || !file) return;

    setProcessing(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const pages = pdfDoc.getPages();

      // Determine pages to apply to
      let targetIndices: number[] = [];
      if (targetPagesMode === 'all') {
        targetIndices = pages.map((_, i) => i);
      } else {
        const parts = customPagesInput.split(',').map((p) => p.trim());
        for (const part of parts) {
          const pNum = parseInt(part, 10);
          if (!isNaN(pNum) && pNum >= 1 && pNum <= pages.length) {
            targetIndices.push(pNum - 1);
          }
        }
      }

      if (targetIndices.length === 0) {
        toast.warning('No valid target pages specified');
        setProcessing(false);
        return;
      }

      const { r, g, b } = hexToRgb(textColor);

      // Embed font if text
      const selectedFontSpec = resolveWatermarkFont(fontFamily);
      const pdfFont = await pdfDoc.embedFont(selectedFontSpec.pdfStandardFont);

      // Embed image if image watermark
      let embeddedImage: any = null;
      if (watermarkType === 'image' && watermarkImageData && watermarkImageFile) {
        if (
          watermarkImageFile.type === 'image/png' ||
          watermarkImageFile.name.toLowerCase().endsWith('.png')
        ) {
          embeddedImage = await pdfDoc.embedPng(watermarkImageData);
        } else {
          embeddedImage = await pdfDoc.embedJpg(watermarkImageData);
        }
      }

      for (const idx of targetIndices) {
        const page = pages[idx];
        const { width, height } = page.getSize();

        let posX = width / 2;
        let posY = height / 2;

        if (position === 'top') {
          posX = width / 2;
          posY = height * 0.85;
        } else if (position === 'bottom') {
          posX = width / 2;
          posY = height * 0.15;
        } else if (position === 'top-left') {
          posX = width * 0.15;
          posY = height * 0.85;
        } else if (position === 'top-right') {
          posX = width * 0.85;
          posY = height * 0.85;
        } else if (position === 'bottom-left') {
          posX = width * 0.15;
          posY = height * 0.15;
        } else if (position === 'bottom-right') {
          posX = width * 0.85;
          posY = height * 0.15;
        }

        if (watermarkType === 'text') {
          const textWidth = pdfFont.widthOfTextAtSize(text, fontSize);
          const textHeight = pdfFont.heightAtSize(fontSize);
          const rad = (rotation * Math.PI) / 180;
          const dx = (textWidth / 2) * Math.cos(rad) - (textHeight / 4) * Math.sin(rad);
          const dy = (textWidth / 2) * Math.sin(rad) + (textHeight / 4) * Math.cos(rad);

          page.drawText(text, {
            x: posX - dx,
            y: posY - dy,
            size: fontSize,
            font: pdfFont,
            color: rgb(r, g, b),
            opacity,
            rotate: degrees(rotation),
          });
        } else if (watermarkType === 'image' && embeddedImage) {
          const imgDims = embeddedImage.scale(imageScale / 100);
          const rad = (rotation * Math.PI) / 180;
          const dx = (imgDims.width / 2) * Math.cos(rad) - (imgDims.height / 2) * Math.sin(rad);
          const dy = (imgDims.width / 2) * Math.sin(rad) + (imgDims.height / 2) * Math.cos(rad);

          page.drawImage(embeddedImage, {
            x: posX - dx,
            y: posY - dy,
            width: imgDims.width,
            height: imgDims.height,
            opacity,
            rotate: degrees(rotation),
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-watermarked.pdf`);
      toast.success('Watermarked PDF downloaded successfully!');
    } catch (err) {
      console.error('Failed to apply watermark', err);
      toast.error('Failed to apply watermark to document');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    previewRenderSeqRef.current += 1;
    baseImageCacheRef.current = null;
    setFile(null);
    setPdfData(null);
    setFirstPagePreview(null);
    setPageAspectRatio(1 / 1.414);
    setWatermarkImageFile(null);
    setWatermarkImageData(null);
    setWatermarkImagePreview(null);
  };

  // ---------------------------------------------------------------------------
  // Sub-renderers for Mobile & Desktop
  // ---------------------------------------------------------------------------

  // Live Page Preview Card
  const renderPreview = (isMobile: boolean) => {
    return (
      <Card className={cn(isMobile ? 'shadow-xs overflow-hidden' : 'sticky top-20')}>
        <CardHeader
          className={cn(
            isMobile
              ? 'py-2 px-3 border-b flex flex-row items-center justify-between space-y-0'
              : 'pb-3'
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Droplets className="h-4 w-4 text-indigo-500 shrink-0" />
            <CardTitle className={cn(isMobile ? 'text-xs font-semibold' : 'text-base')}>
              Live Page 1 Preview
            </CardTitle>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] bg-primary/10 text-primary border-primary/20 py-0 h-5"
          >
            Real-Time
          </Badge>
          {!isMobile && (
            <CardDescription className="text-xs">
              Real-time visual preview of the watermark on your document.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent
          className={cn(
            'flex flex-col items-center justify-center',
            isMobile ? 'p-2.5 space-y-2' : 'p-4 space-y-3'
          )}
        >
          {loading ? (
            <div
              className={cn(
                'flex flex-col items-center justify-center gap-2 text-muted-foreground',
                isMobile ? 'py-14' : 'py-20'
              )}
            >
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              <p className="text-xs">Loading page preview...</p>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center py-1.5 select-none">
              <div
                className="relative rounded-md shadow-xl border border-border overflow-hidden bg-white transition-all duration-150 flex items-center justify-center"
                style={{
                  aspectRatio: `${pageAspectRatio}`,
                  height: isMobile ? '290px' : '480px',
                  maxHeight: isMobile ? '315px' : '520px',
                  maxWidth: '100%',
                }}
              >
                <canvas
                  ref={isMobile ? mobileCanvasRef : desktopCanvasRef}
                  className="w-full h-full object-contain block bg-white"
                />
              </div>
            </div>
          )}
          <p className="text-[10px] sm:text-[11px] text-center text-muted-foreground truncate w-full">
            {watermarkType === 'text'
              ? `Text: "${text || 'Watermark'}" • ${resolveWatermarkFont(fontFamily).label} • ${fontSize}px`
              : `Logo (${imageScale}%)`}{' '}
            • Pos: {position} • Opacity: {Math.round(opacity * 100)}% • Rot: {rotation}°
          </p>
        </CardContent>
      </Card>
    );
  };

  // Watermark Content Controls (Text / Image)
  const renderContentControls = (isMobile: boolean) => {
    return (
      <div className="space-y-3.5">
        <Tabs
          value={watermarkType}
          onValueChange={(v) => setWatermarkType(v as 'text' | 'image')}
        >
          <TabsList className="grid w-full grid-cols-2 h-9">
            <TabsTrigger value="text" className="flex items-center gap-1.5 text-xs">
              <Type className="h-3.5 w-3.5" />
              Text Watermark
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-1.5 text-xs">
              <ImageIcon className="h-3.5 w-3.5" />
              Image / Logo
            </TabsTrigger>
          </TabsList>

          {/* Text Watermark Controls */}
          <TabsContent value="text" className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label htmlFor="wm-text" className="text-xs font-medium">
                Watermark Text
              </Label>
              <Input
                id="wm-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
                className="h-8 sm:h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              <div className="space-y-1">
                <Label htmlFor="wm-font-family" className="text-xs font-medium">
                  Font Family
                </Label>
                <Select value={fontFamily} onValueChange={setFontFamily}>
                  <SelectTrigger id="wm-font-family" className="h-8 sm:h-9 text-xs">
                    <SelectValue placeholder="Font" />
                  </SelectTrigger>
                  <SelectContent>
                    {WATERMARK_FONTS.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="wm-color" className="text-xs font-medium">
                  Text Color
                </Label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    id="wm-color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="h-8 w-8 sm:h-9 sm:w-10 rounded border p-0.5 cursor-pointer bg-background shrink-0"
                  />
                  <Input
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="font-mono text-xs h-8 sm:h-9 flex-1"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <Label className="text-xs">Font Size</Label>
                <span className="text-muted-foreground font-mono">{fontSize}px</span>
              </div>
              <Slider
                value={[fontSize]}
                min={12}
                max={120}
                step={2}
                onValueChange={([val]) => setFontSize(val)}
              />
            </div>
          </TabsContent>

          {/* Image Watermark Controls */}
          <TabsContent value="image" className="space-y-3 mt-3">
            {(() => {
              const imageInputId = isMobile ? 'wm-logo-upload-mobile' : 'wm-logo-upload-desktop';
              return (
                <div className="space-y-2.5">
                  <Label htmlFor={imageInputId} className="text-xs font-medium block">
                    Upload Logo / Image (PNG or JPG)
                  </Label>
                  <input
                    id={imageInputId}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleImageWatermarkSelected}
                    className="sr-only peer"
                  />

                  {!watermarkImagePreview ? (
                    <label
                      htmlFor={imageInputId}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        loadWatermarkImageFile(e.dataTransfer.files?.[0]);
                      }}
                      className="flex items-center justify-between gap-2.5 w-full min-h-[56px] rounded-xl border border-dashed border-border hover:border-primary/60 peer-focus-visible:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 ring-offset-background bg-surface-secondary/60 dark:bg-background/40 px-3 py-2.5 cursor-pointer transition-colors touch-manipulation select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/15 text-primary dark:text-indigo-400">
                          <Upload className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">
                            Choose logo image
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            PNG or JPG • No file selected
                          </p>
                        </div>
                      </div>
                      <span className="inline-flex items-center justify-center shrink-0 rounded-lg border border-primary/25 dark:border-primary/40 bg-primary/10 dark:bg-primary/20 px-2.5 py-1.5 text-xs font-medium text-primary dark:text-indigo-300">
                        Browse
                      </span>
                    </label>
                  ) : (
                    <div className="space-y-2.5 peer-focus-visible:[&_label]:ring-2 peer-focus-visible:[&_label]:ring-ring">
                      <div className="flex items-center gap-2.5 p-2.5 border border-border rounded-xl bg-surface-secondary/50 dark:bg-muted/30">
                        <img
                          src={watermarkImagePreview}
                          alt="Watermark logo"
                          className="h-10 w-10 object-contain rounded-md border bg-white p-0.5 shrink-0"
                        />
                        <div className="text-xs truncate flex-1 min-w-0">
                          <div className="font-medium truncate text-xs text-foreground">
                            {watermarkImageFile?.name || 'Selected Logo'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatFileSize(watermarkImageFile?.size || 0)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <label
                            htmlFor={imageInputId}
                            className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-background/80 hover:bg-accent px-2 text-[11px] font-medium cursor-pointer transition-colors touch-manipulation"
                          >
                            Replace
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] text-destructive hover:text-destructive px-2 shrink-0"
                            onClick={() => {
                              setWatermarkImageFile(null);
                              setWatermarkImageData(null);
                              setWatermarkImagePreview(null);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <Label className="text-xs">Image Scale</Label>
                          <span className="text-muted-foreground font-mono">{imageScale}%</span>
                        </div>
                        <Slider
                          value={[imageScale]}
                          min={5}
                          max={150}
                          step={5}
                          onValueChange={([val]) => setImageScale(val)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>

        {isMobile && (
          <Button
            onClick={handleApplyWatermark}
            disabled={processing}
            className="w-full h-9 text-xs font-medium mt-2"
          >
            {processing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Processing PDF...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Apply Watermark & Download PDF
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  // Watermark Layout Controls (Position, Target Pages, Opacity, Rotation)
  const renderLayoutControls = (isMobile: boolean) => {
    return (
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Position</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger className="h-8 sm:h-9 text-xs">
                <SelectValue placeholder="Position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="top">Top Center</SelectItem>
                <SelectItem value="bottom">Bottom Center</SelectItem>
                <SelectItem value="top-left">Top Left</SelectItem>
                <SelectItem value="top-right">Top Right</SelectItem>
                <SelectItem value="bottom-left">Bottom Left</SelectItem>
                <SelectItem value="bottom-right">Bottom Right</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Target Pages</Label>
            <Select
              value={targetPagesMode}
              onValueChange={(v: 'all' | 'custom') => setTargetPagesMode(v)}
            >
              <SelectTrigger className="h-8 sm:h-9 text-xs">
                <SelectValue placeholder="Pages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pages ({pageCount})</SelectItem>
                <SelectItem value="custom">Specific Pages</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {targetPagesMode === 'custom' && (
          <div className="space-y-1">
            <Label htmlFor="custom-pages" className="text-xs font-medium">
              Specify Pages (e.g. 1, 3, 5)
            </Label>
            <Input
              id="custom-pages"
              value={customPagesInput}
              onChange={(e) => setCustomPagesInput(e.target.value)}
              placeholder="1, 2, 4"
              className="h-8 sm:h-9 text-xs"
            />
          </div>
        )}

        <div className={cn(isMobile ? 'grid grid-cols-2 gap-2.5 pt-0.5' : 'space-y-3 pt-2')}>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px] sm:text-xs">Opacity</Label>
              <span className="text-[11px] sm:text-xs text-muted-foreground font-mono">
                {Math.round(opacity * 100)}%
              </span>
            </div>
            <Slider
              value={[opacity * 100]}
              min={5}
              max={100}
              step={5}
              onValueChange={([val]) => setOpacity(val / 100)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px] sm:text-xs">Rotation</Label>
              <span className="text-[11px] sm:text-xs text-muted-foreground font-mono">
                {rotation}°
              </span>
            </div>
            <Slider
              value={[rotation]}
              min={-90}
              max={90}
              step={5}
              onValueChange={([val]) => setRotation(val)}
            />
          </div>
        </div>

        {isMobile && (
          <Button
            onClick={handleApplyWatermark}
            disabled={processing}
            className="w-full h-9 text-xs font-medium mt-2"
          >
            {processing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Processing PDF...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Apply Watermark & Download PDF
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8 max-w-6xl">
      {/* Header */}
      <div className={cn('mb-6 sm:mb-8', file && 'hidden sm:block')}>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
            <Droplets className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Add Watermark</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Apply text or image stamps to safeguard your document with customizable opacity, rotation, and positioning.
        </p>
      </div>

      {!file ? (
        <Card>
          <CardContent className="p-5 sm:p-7">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file to watermark"
              description="Protect your document with text or logo watermarks"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 sm:space-y-6">
          {/* Mobile Compact File Header */}
          <div className="sm:hidden flex items-center justify-between pb-2 mb-1 border-b">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
                PDF
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate max-w-[170px]">{file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {pageCount} {pageCount === 1 ? 'page' : 'pages'} • {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={handleReset}
              disabled={loading || processing}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Change
            </Button>
          </div>

          {/* Desktop File Header */}
          <Card className="hidden sm:block">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  PDF
                </div>
                <div>
                  <h3 className="font-semibold text-sm sm:text-base truncate max-w-sm sm:max-w-md">
                    {file.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <Badge variant="secondary" className="text-xs">
                      {pageCount} {pageCount === 1 ? 'Page' : 'Pages'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={loading || processing}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Choose Another File
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* MOBILE VIEW (lg:hidden): Preview pinned at top, segmented tabs directly beneath */}
          <div className="lg:hidden space-y-3">
            {/* 1. Compact Live Page 1 Preview (Visible with ZERO scroll) */}
            {renderPreview(true)}

            {/* 2. Mobile Segmented Tab Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl text-xs font-medium border shadow-xs">
              <button
                type="button"
                onClick={() => setMobileTab('content')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-colors touch-manipulation',
                  mobileTab === 'content'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Type className="h-3.5 w-3.5 text-primary" />
                <span>Watermark Content</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('layout')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-colors touch-manipulation',
                  mobileTab === 'layout'
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Settings2 className="h-3.5 w-3.5 text-primary" />
                <span>Position & Style</span>
              </button>
            </div>

            {/* 3. Active Tab Content */}
            <Card className="shadow-xs">
              <CardContent className="p-3 sm:p-4">
                {mobileTab === 'content'
                  ? renderContentControls(true)
                  : renderLayoutControls(true)}
              </CardContent>
            </Card>
          </div>

          {/* DESKTOP VIEW (hidden lg:grid lg:grid-cols-12 gap-6) */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-6">
            {/* Left Controls */}
            <div className="lg:col-span-7 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Watermark Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {renderContentControls(false)}

                  {/* Common Controls: Position, Opacity, Rotation */}
                  <div className="pt-4 border-t space-y-4">
                    {renderLayoutControls(false)}
                  </div>

                  <Button
                    onClick={handleApplyWatermark}
                    disabled={processing}
                    className="w-full"
                    size="lg"
                  >
                    {processing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Apply Watermark & Download PDF
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right: Live Preview */}
            <div className="lg:col-span-5">{renderPreview(false)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
