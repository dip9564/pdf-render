import React, { useState, useCallback, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadBlob, readFileAsDataURL, generateId, getPageSizeDimensions, createPdfBlob } from '@/lib/utils';
import { FileUploader } from '@/components/shared/FileUploader';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileImage,
  Download,
  RotateCw,
  Trash2,
  GripVertical,
  Loader2,
  Settings2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';

interface ImageItem {
  id: string;
  file: File;
  dataUrl: string;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: boolean;
}

type PageSize = 'A4' | 'A3' | 'Letter' | 'Legal' | 'Custom';
type Orientation = 'portrait' | 'landscape';
type FitMode = 'fit' | 'fill' | 'original';

export default function ImageToPdf() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [margin, setMargin] = useState(20);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [quality, setQuality] = useState(0.85);
  const [customWidth, setCustomWidth] = useState(595);
  const [customHeight, setCustomHeight] = useState(842);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    try {
      const newImages: ImageItem[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataURL(file);
        newImages.push({
          id: generateId(),
          file,
          dataUrl,
          rotation: 0,
          brightness: 100,
          contrast: 100,
          saturation: 100,
          grayscale: false,
        });
      }
      setImages((prev) => [...prev, ...newImages]);
      toast.success(`Added ${files.length} image${files.length > 1 ? 's' : ''}`);
    } catch {
      toast.error('Failed to load some images');
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    setExpandedImage((prev) => (prev === id ? null : prev));
  }, []);

  const rotateImage = useCallback((id: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, rotation: (img.rotation + 90) % 360 } : img
      )
    );
  }, []);

  const updateImageAdjustment = useCallback(
    (id: string, key: keyof Pick<ImageItem, 'brightness' | 'contrast' | 'saturation' | 'grayscale'>, value: number | boolean) => {
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, [key]: value } : img))
      );
    },
    []
  );

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedIndex !== null && draggedIndex !== index) {
        setDragOverIndex(index);
      }
    },
    [draggedIndex]
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (draggedIndex === null || draggedIndex === dropIndex) return;

      setImages((prev) => {
        const newImages = [...prev];
        const [draggedItem] = newImages.splice(draggedIndex, 1);
        newImages.splice(dropIndex, 0, draggedItem);
        return newImages;
      });
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [draggedIndex]
  );

  const getFilterString = (img: ImageItem): string => {
    const filters: string[] = [];
    if (img.brightness !== 100) filters.push(`brightness(${img.brightness}%)`);
    if (img.contrast !== 100) filters.push(`contrast(${img.contrast}%)`);
    if (img.saturation !== 100) filters.push(`saturate(${img.saturation}%)`);
    if (img.grayscale) filters.push('grayscale(100%)');
    return filters.length > 0 ? filters.join(' ') : 'none';
  };

  const applyImageProcessing = async (img: ImageItem): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const radians = (img.rotation * Math.PI) / 180;
        const isRotated90or270 = img.rotation === 90 || img.rotation === 270;
        const srcW = image.naturalWidth;
        const srcH = image.naturalHeight;
        const outW = isRotated90or270 ? srcH : srcW;
        const outH = isRotated90or270 ? srcW : srcH;

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Cannot create canvas context'));
          return;
        }

        const filterParts: string[] = [];
        if (img.brightness !== 100) filterParts.push(`brightness(${img.brightness}%)`);
        if (img.contrast !== 100) filterParts.push(`contrast(${img.contrast}%)`);
        if (img.saturation !== 100) filterParts.push(`saturate(${img.saturation}%)`);
        if (img.grayscale) filterParts.push('grayscale(100%)');

        ctx.filter = filterParts.length > 0 ? filterParts.join(' ') : 'none';

        ctx.translate(outW / 2, outH / 2);
        ctx.rotate(radians);
        ctx.drawImage(image, -srcW / 2, -srcH / 2, srcW, srcH);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob failed'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
          },
          'image/png',
          quality
        );
      };
      image.onerror = () => reject(new Error('Failed to load image'));
      image.src = img.dataUrl;
    });
  };

  const generatePdf = async () => {
    if (images.length === 0) {
      toast.error('Please add at least one image');
      return;
    }

    setIsGenerating(true);
    try {
      const pdfDoc = await PDFDocument.create();

      let pageDims: { width: number; height: number };
      if (pageSize === 'Custom') {
        pageDims =
          orientation === 'landscape'
            ? { width: customHeight, height: customWidth }
            : { width: customWidth, height: customHeight };
      } else {
        pageDims = getPageSizeDimensions(pageSize, orientation);
      }

      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
          ? {
              r: parseInt(result[1], 16) / 255,
              g: parseInt(result[2], 16) / 255,
              b: parseInt(result[3], 16) / 255,
            }
          : { r: 1, g: 1, b: 1 };
      };

      for (const img of images) {
        const processedBytes = await applyImageProcessing(img);
        const embeddedImage = await pdfDoc.embedPng(processedBytes);

        const page = pdfDoc.addPage([pageDims.width, pageDims.height]);

        const rgb = hexToRgb(bgColor);
        page.drawRectangle({
          x: 0,
          y: 0,
          width: pageDims.width,
          height: pageDims.height,
          color: { type: 'RGB' as const, red: rgb.r, green: rgb.g, blue: rgb.b } as any,
        });

        const availableWidth = pageDims.width - margin * 2;
        const availableHeight = pageDims.height - margin * 2;
        const imgWidth = embeddedImage.width;
        const imgHeight = embeddedImage.height;

        let drawWidth: number;
        let drawHeight: number;
        let drawX: number;
        let drawY: number;

        if (fitMode === 'fit') {
          const scaleX = availableWidth / imgWidth;
          const scaleY = availableHeight / imgHeight;
          const scale = Math.min(scaleX, scaleY);
          drawWidth = imgWidth * scale;
          drawHeight = imgHeight * scale;
          drawX = margin + (availableWidth - drawWidth) / 2;
          drawY = margin + (availableHeight - drawHeight) / 2;
        } else if (fitMode === 'fill') {
          const scaleX = availableWidth / imgWidth;
          const scaleY = availableHeight / imgHeight;
          const scale = Math.max(scaleX, scaleY);
          drawWidth = imgWidth * scale;
          drawHeight = imgHeight * scale;
          drawX = margin + (availableWidth - drawWidth) / 2;
          drawY = margin + (availableHeight - drawHeight) / 2;
        } else {
          drawWidth = imgWidth;
          drawHeight = imgHeight;
          drawX = margin + (availableWidth - drawWidth) / 2;
          drawY = margin + (availableHeight - drawHeight) / 2;
        }

        page.drawImage(embeddedImage, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      downloadBlob(blob, 'images-to-pdf.pdf');
      toast.success('PDF generated and downloaded!');
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const clearAll = useCallback(() => {
    setImages([]);
    setExpandedImage(null);
    toast.info('All images cleared');
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 mb-4">
          <FileImage className="h-8 w-8 text-blue-500" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Image to PDF</h1>
        <p className="text-muted-foreground mt-2 max-w-lg mx-auto">
          Convert your images to a single PDF document. Reorder, rotate, and adjust images before generating.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Upload + Image Grid */}
        <div className="lg:col-span-2 space-y-6">
          <FileUploader
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            multiple
            maxFiles={50}
            maxSize={50 * 1024 * 1024}
            onFilesSelected={handleFilesSelected}
            label="Upload Images"
            description="Drag & drop JPG, PNG, or WEBP images here"
            showFileList={false}
          />

          {images.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {images.length} image{images.length !== 1 ? 's' : ''} added
                </p>
                <Button variant="outline" size="sm" onClick={clearAll}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear All
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {images.map((img, index) => (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, index)}
                    className={cn(
                      'group relative rounded-lg border bg-card overflow-hidden transition-all',
                      dragOverIndex === index && 'ring-2 ring-primary border-primary',
                      draggedIndex === index && 'opacity-50'
                    )}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-square relative overflow-hidden bg-muted/50">
                      <img
                        src={img.dataUrl}
                        alt={img.file.name}
                        className="w-full h-full object-cover"
                        style={{
                          filter: getFilterString(img),
                          transform: `rotate(${img.rotation}deg)`,
                        }}
                      />
                      {/* Drag handle overlay */}
                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                        <div className="bg-black/60 text-white rounded p-0.5">
                          <GripVertical className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      {/* Page number */}
                      <div className="absolute top-1 right-1">
                        <span className="text-[10px] bg-black/60 text-white rounded px-1.5 py-0.5 font-medium">
                          {index + 1}
                        </span>
                      </div>
                    </div>

                    {/* Actions bar */}
                    <div className="p-1.5 flex items-center justify-between gap-1">
                      <p className="text-[10px] text-muted-foreground truncate flex-1">
                        {img.file.name}
                      </p>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => rotateImage(img.id)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title="Rotate 90°"
                        >
                          <RotateCw className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() =>
                            setExpandedImage((prev) => (prev === img.id ? null : img.id))
                          }
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title="Adjustments"
                        >
                          {expandedImage === img.id ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                        <button
                          onClick={() => removeImage(img.id)}
                          className="p-1 rounded hover:bg-destructive/10 transition-colors"
                          title="Remove"
                        >
                          <X className="h-3 w-3 text-destructive" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded adjustments */}
                    {expandedImage === img.id && (
                      <div className="px-2 pb-2 space-y-2 border-t pt-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">
                            Brightness: {img.brightness}%
                          </label>
                          <Slider
                            min={0}
                            max={200}
                            step={1}
                            value={[img.brightness]}
                            onValueChange={([v]) => updateImageAdjustment(img.id, 'brightness', v)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">
                            Contrast: {img.contrast}%
                          </label>
                          <Slider
                            min={0}
                            max={200}
                            step={1}
                            value={[img.contrast]}
                            onValueChange={([v]) => updateImageAdjustment(img.id, 'contrast', v)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">
                            Saturation: {img.saturation}%
                          </label>
                          <Slider
                            min={0}
                            max={200}
                            step={1}
                            value={[img.saturation]}
                            onValueChange={([v]) => updateImageAdjustment(img.id, 'saturation', v)}
                            className="mt-1"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-muted-foreground">Grayscale</label>
                          <Switch
                            checked={img.grayscale}
                            onCheckedChange={(v) => updateImageAdjustment(img.id, 'grayscale', v)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Settings */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-5 space-y-5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-4 w-4" />
              PDF Settings
            </div>

            {/* Page Size */}
            <div className="space-y-2">
              <Label className="text-xs">Page Size</Label>
              <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSize)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4 (210 × 297 mm)</SelectItem>
                  <SelectItem value="A3">A3 (297 × 420 mm)</SelectItem>
                  <SelectItem value="Letter">Letter (8.5 × 11 in)</SelectItem>
                  <SelectItem value="Legal">Legal (8.5 × 14 in)</SelectItem>
                  <SelectItem value="Custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Size Inputs */}
            {pageSize === 'Custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Width (pt)</Label>
                  <Input
                    type="number"
                    min={72}
                    max={4000}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value) || 595)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Height (pt)</Label>
                  <Input
                    type="number"
                    min={72}
                    max={4000}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value) || 842)}
                  />
                </div>
              </div>
            )}

            {/* Orientation */}
            <div className="space-y-2">
              <Label className="text-xs">Orientation</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOrientation('portrait')}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors',
                    orientation === 'portrait'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-muted hover:border-primary/50'
                  )}
                >
                  <div className="w-5 h-7 rounded-sm border-2 border-current" />
                  Portrait
                </button>
                <button
                  onClick={() => setOrientation('landscape')}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors',
                    orientation === 'landscape'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-muted hover:border-primary/50'
                  )}
                >
                  <div className="w-7 h-5 rounded-sm border-2 border-current" />
                  Landscape
                </button>
              </div>
            </div>

            {/* Fit Mode */}
            <div className="space-y-2">
              <Label className="text-xs">Image Fit</Label>
              <Select value={fitMode} onValueChange={(v) => setFitMode(v as FitMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fit">Fit to Page</SelectItem>
                  <SelectItem value="fill">Fill Page</SelectItem>
                  <SelectItem value="original">Original Proportions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Margin */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Margin</Label>
                <span className="text-xs text-muted-foreground">{margin} pt</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[margin]}
                onValueChange={([v]) => setMargin(v)}
              />
            </div>

            {/* Background Color */}
            <div className="space-y-2">
              <Label className="text-xs">Background Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-10 h-10 rounded-md border cursor-pointer bg-transparent p-0.5"
                />
                <Input
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="flex-1"
                  maxLength={7}
                />
              </div>
            </div>

            {/* Image Quality */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Image Quality</Label>
                <span className="text-xs text-muted-foreground">{Math.round(quality * 100)}%</span>
              </div>
              <Slider
                min={10}
                max={100}
                step={5}
                value={[Math.round(quality * 100)]}
                onValueChange={([v]) => setQuality(v / 100)}
              />
            </div>

            {/* Generate Button */}
            <Button
              className="w-full"
              size="lg"
              onClick={generatePdf}
              disabled={images.length === 0 || isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate & Download PDF
                </>
              )}
            </Button>

            {images.length === 0 && (
              <p className="text-xs text-center text-muted-foreground">
                Add images to enable PDF generation
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
