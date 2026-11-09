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
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
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
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

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

  const handleImageWatermarkSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setWatermarkImageFile(file);
    const buffer = await readFileAsArrayBuffer(file);
    setWatermarkImageData(buffer);

    const reader = new FileReader();
    reader.onload = () => setWatermarkImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Draw overlay preview on canvas
  useEffect(() => {
    if (!firstPagePreview || !previewCanvasRef.current) return;

    let isCancelled = false;

    const renderPreview = async () => {
      try {
        const baseImg = await loadImage(firstPagePreview);
        let wmImg: HTMLImageElement | null = null;
        if (watermarkType === 'image' && watermarkImagePreview) {
          try {
            wmImg = await loadImage(watermarkImagePreview);
          } catch (e) {
            console.error('Error loading watermark image', e);
          }
        }

        if (isCancelled || !previewCanvasRef.current) return;

        const canvas = previewCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

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
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 0, 0);
        } else if (watermarkType === 'image' && wmImg) {
          const w = wmImg.width * (imageScale / 100);
          const h = wmImg.height * (imageScale / 100);
          ctx.drawImage(wmImg, -w / 2, -h / 2, w, h);
        }

        ctx.restore();
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
    watermarkType,
    text,
    fontSize,
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
      let pdfFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      if (fontFamily === 'Times-Roman') {
        pdfFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
      } else if (fontFamily === 'Courier') {
        pdfFont = await pdfDoc.embedFont(StandardFonts.CourierBold);
      }

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
    setFile(null);
    setPdfData(null);
    setFirstPagePreview(null);
    setWatermarkImageFile(null);
    setWatermarkImageData(null);
    setWatermarkImagePreview(null);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Droplets className="h-8 w-8 text-indigo-500" />
          Add Watermark
        </h1>
        <p className="text-muted-foreground mt-1">
          Apply text or image stamps to safeguard your document with customizable opacity, rotation, and positioning.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
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
        <div className="space-y-6">
          {/* File Header */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
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
                <Button variant="outline" size="sm" onClick={handleReset} disabled={loading || processing}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Choose Another File
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Configuration and Live Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Controls */}
            <div className="lg:col-span-7 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Watermark Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Type Tabs */}
                  <Tabs
                    value={watermarkType}
                    onValueChange={(v) => setWatermarkType(v as 'text' | 'image')}
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="text" className="flex items-center gap-2">
                        <Type className="h-4 w-4" />
                        Text Watermark
                      </TabsTrigger>
                      <TabsTrigger value="image" className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" />
                        Image / Logo
                      </TabsTrigger>
                    </TabsList>

                    {/* Text Watermark Controls */}
                    <TabsContent value="text" className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="wm-text">Watermark Text</Label>
                        <Input
                          id="wm-text"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="e.g. CONFIDENTIAL, DRAFT, SAMPLE"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Font Family</Label>
                          <Select value={fontFamily} onValueChange={setFontFamily}>
                            <SelectTrigger>
                              <SelectValue placeholder="Font" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Helvetica">Helvetica</SelectItem>
                              <SelectItem value="Times-Roman">Times New Roman</SelectItem>
                              <SelectItem value="Courier">Courier</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="wm-color">Text Color</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              id="wm-color"
                              value={textColor}
                              onChange={(e) => setTextColor(e.target.value)}
                              className="h-10 w-12 rounded border p-1 cursor-pointer bg-background"
                            />
                            <Input
                              value={textColor}
                              onChange={(e) => setTextColor(e.target.value)}
                              className="font-mono text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <Label>Font Size: {fontSize}px</Label>
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
                    <TabsContent value="image" className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <Label>Upload Logo / Image (PNG or JPG)</Label>
                        <Input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={handleImageWatermarkSelected}
                        />
                      </div>

                      {watermarkImagePreview && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 p-2.5 border rounded-lg bg-muted/40">
                            <img
                              src={watermarkImagePreview}
                              alt="Watermark logo"
                              className="h-10 w-10 object-contain rounded border bg-white p-0.5 shrink-0"
                            />
                            <div className="text-xs truncate flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {watermarkImageFile?.name || 'Selected Logo'}
                              </div>
                              <div className="text-muted-foreground">
                                {formatFileSize(watermarkImageFile?.size || 0)}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
                              onClick={() => {
                                setWatermarkImageFile(null);
                                setWatermarkImageData(null);
                                setWatermarkImagePreview(null);
                              }}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <Label>Image Scale: {imageScale}%</Label>
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
                    </TabsContent>
                  </Tabs>

                  {/* Common Controls: Position, Opacity, Rotation */}
                  <div className="pt-4 border-t space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={position} onValueChange={setPosition}>
                          <SelectTrigger>
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

                      <div className="space-y-2">
                        <Label>Target Pages</Label>
                        <Select
                          value={targetPagesMode}
                          onValueChange={(v: 'all' | 'custom') => setTargetPagesMode(v)}
                        >
                          <SelectTrigger>
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
                      <div className="space-y-2">
                        <Label htmlFor="custom-pages">Specify Pages (e.g. 1, 3, 5)</Label>
                        <Input
                          id="custom-pages"
                          value={customPagesInput}
                          onChange={(e) => setCustomPagesInput(e.target.value)}
                          placeholder="1, 2, 4"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <Label>Opacity: {Math.round(opacity * 100)}%</Label>
                      </div>
                      <Slider
                        value={[opacity * 100]}
                        min={5}
                        max={100}
                        step={5}
                        onValueChange={([val]) => setOpacity(val / 100)}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <Label>Rotation: {rotation}°</Label>
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

                  <Button
                    onClick={handleApplyWatermark}
                    disabled={processing}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
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
            <div className="lg:col-span-5">
              <Card className="sticky top-20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Live Page 1 Preview</span>
                    <Badge variant="outline" className="text-xs">Interactive</Badge>
                  </CardTitle>
                  <CardDescription>
                    Real-time visual preview of the watermark on your document.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-4">
                  {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                      <p className="text-xs">Loading page preview...</p>
                    </div>
                  ) : (
                    <div className="border rounded-lg shadow-sm bg-white overflow-hidden max-h-[500px]">
                      <canvas
                        ref={previewCanvasRef}
                        className="max-w-full h-auto object-contain"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
