import React, { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadBlob, readFileAsDataURL } from '@/lib/utils';
import { FileUploader } from '@/components/shared/FileUploader';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Paintbrush,
  Download,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Undo2,
  Loader2,
  SplitSquareHorizontal,
  Eye,
  EyeOff,
  X,
  Move,
  Upload,
} from 'lucide-react';

interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: boolean;
  sepia: boolean;
  blur: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const defaultAdjustments: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: false,
  sepia: false,
  blur: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
};

type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'move' | null;

export default function ImageEditor() {
  const [originalDataUrl, setOriginalDataUrl] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('image');
  const [adjustments, setAdjustments] = useState<Adjustments>({ ...defaultAdjustments });
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [appliedCrop, setAppliedCrop] = useState<CropRect | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);

  const handleFileSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    try {
      const file = files[0];
      const dataUrl = await readFileAsDataURL(file);
      setOriginalDataUrl(dataUrl);
      setOriginalFileName(file.name.replace(/\.[^/.]+$/, ''));
      setAdjustments({ ...defaultAdjustments });
      setCropRect(null);
      setAppliedCrop(null);
      setIsCropping(false);
      setShowComparison(false);
      toast.success(`Loaded "${file.name}"`);
    } catch {
      toast.error('Failed to load image');
    }
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const getCssFilter = (): string => {
    const parts: string[] = [];
    const b = 100 + adjustments.brightness;
    if (b !== 100) parts.push(`brightness(${b}%)`);
    const c = 100 + adjustments.contrast;
    if (c !== 100) parts.push(`contrast(${c}%)`);
    const s = 100 + adjustments.saturation;
    if (s !== 100) parts.push(`saturate(${s}%)`);
    if (adjustments.grayscale) parts.push('grayscale(100%)');
    if (adjustments.sepia) parts.push('sepia(100%)');
    if (adjustments.blur > 0) parts.push(`blur(${adjustments.blur}px)`);
    return parts.length > 0 ? parts.join(' ') : 'none';
  };

  const getCssTransform = (): string => {
    const transforms: string[] = [];
    if (adjustments.rotation !== 0) transforms.push(`rotate(${adjustments.rotation}deg)`);
    const sx = adjustments.flipH ? -1 : 1;
    const sy = adjustments.flipV ? -1 : 1;
    if (sx !== 1 || sy !== 1) transforms.push(`scale(${sx}, ${sy})`);
    return transforms.length > 0 ? transforms.join(' ') : 'none';
  };

  const updateAdjustment = <K extends keyof Adjustments>(key: K, value: Adjustments[K]) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  const rotateLeft = () => updateAdjustment('rotation', adjustments.rotation - 90);
  const rotateRight = () => updateAdjustment('rotation', adjustments.rotation + 90);
  const flipH = () => updateAdjustment('flipH', !adjustments.flipH);
  const flipV = () => updateAdjustment('flipV', !adjustments.flipV);

  const resetAll = () => {
    setAdjustments({ ...defaultAdjustments });
    setCropRect(null);
    setAppliedCrop(null);
    setIsCropping(false);
    toast.info('All adjustments reset');
  };

  // ===================== CROP LOGIC =====================

  const getDisplayedImageRect = useCallback((): DOMRect | null => {
    if (!previewImageRef.current) return null;
    return previewImageRef.current.getBoundingClientRect();
  }, []);

  const startCropMode = () => {
    if (!previewImageRef.current) return;
    setIsCropping(true);
    const rect = previewImageRef.current.getBoundingClientRect();
    const containerRect = imageContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const relX = rect.left - containerRect.left;
    const relY = rect.top - containerRect.top;
    const inset = Math.min(rect.width, rect.height) * 0.1;
    setCropRect({
      x: relX + inset,
      y: relY + inset,
      width: rect.width - inset * 2,
      height: rect.height - inset * 2,
    });
  };

  const applyCrop = () => {
    if (!cropRect || !previewImageRef.current || !imageContainerRef.current) return;
    const imgRect = previewImageRef.current.getBoundingClientRect();
    const containerRect = imageContainerRef.current.getBoundingClientRect();

    const imgRelLeft = imgRect.left - containerRect.left;
    const imgRelTop = imgRect.top - containerRect.top;

    const scaleX = imageNaturalSize.width / imgRect.width;
    const scaleY = imageNaturalSize.height / imgRect.height;

    const cropX = Math.max(0, (cropRect.x - imgRelLeft) * scaleX);
    const cropY = Math.max(0, (cropRect.y - imgRelTop) * scaleY);
    const cropW = Math.min(imageNaturalSize.width - cropX, cropRect.width * scaleX);
    const cropH = Math.min(imageNaturalSize.height - cropY, cropRect.height * scaleY);

    setAppliedCrop({ x: cropX, y: cropY, width: cropW, height: cropH });
    setIsCropping(false);
    setCropRect(null);
    toast.success('Crop applied');
  };

  const cancelCrop = () => {
    setIsCropping(false);
    setCropRect(null);
  };

  const getHandleAtPosition = (
    mx: number,
    my: number,
    rect: CropRect
  ): CropHandle => {
    const handleSize = 12;
    const corners: { handle: CropHandle; cx: number; cy: number }[] = [
      { handle: 'nw', cx: rect.x, cy: rect.y },
      { handle: 'ne', cx: rect.x + rect.width, cy: rect.y },
      { handle: 'sw', cx: rect.x, cy: rect.y + rect.height },
      { handle: 'se', cx: rect.x + rect.width, cy: rect.y + rect.height },
    ];
    for (const c of corners) {
      if (Math.abs(mx - c.cx) < handleSize && Math.abs(my - c.cy) < handleSize) {
        return c.handle;
      }
    }

    const edges: { handle: CropHandle; check: () => boolean }[] = [
      { handle: 'n', check: () => Math.abs(my - rect.y) < handleSize && mx > rect.x && mx < rect.x + rect.width },
      { handle: 's', check: () => Math.abs(my - (rect.y + rect.height)) < handleSize && mx > rect.x && mx < rect.x + rect.width },
      { handle: 'w', check: () => Math.abs(mx - rect.x) < handleSize && my > rect.y && my < rect.y + rect.height },
      { handle: 'e', check: () => Math.abs(mx - (rect.x + rect.width)) < handleSize && my > rect.y && my < rect.y + rect.height },
    ];
    for (const e of edges) {
      if (e.check()) return e.handle;
    }

    if (mx > rect.x && mx < rect.x + rect.width && my > rect.y && my < rect.y + rect.height) {
      return 'move';
    }
    return null;
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!isCropping || !cropRect || !imageContainerRef.current) return;
    const containerRect = imageContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - containerRect.left;
    const my = e.clientY - containerRect.top;
    const handle = getHandleAtPosition(mx, my, cropRect);
    if (!handle) return;
    e.preventDefault();
    cropDragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...cropRect },
    };
  };

  useEffect(() => {
    if (!isCropping) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!cropDragRef.current || !cropRect) return;
      const { handle, startX, startY, startRect } = cropDragRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const minSize = 20;

      let newRect = { ...startRect };

      switch (handle) {
        case 'move':
          newRect.x = startRect.x + dx;
          newRect.y = startRect.y + dy;
          break;
        case 'nw':
          newRect.x = startRect.x + dx;
          newRect.y = startRect.y + dy;
          newRect.width = Math.max(minSize, startRect.width - dx);
          newRect.height = Math.max(minSize, startRect.height - dy);
          break;
        case 'ne':
          newRect.y = startRect.y + dy;
          newRect.width = Math.max(minSize, startRect.width + dx);
          newRect.height = Math.max(minSize, startRect.height - dy);
          break;
        case 'sw':
          newRect.x = startRect.x + dx;
          newRect.width = Math.max(minSize, startRect.width - dx);
          newRect.height = Math.max(minSize, startRect.height + dy);
          break;
        case 'se':
          newRect.width = Math.max(minSize, startRect.width + dx);
          newRect.height = Math.max(minSize, startRect.height + dy);
          break;
        case 'n':
          newRect.y = startRect.y + dy;
          newRect.height = Math.max(minSize, startRect.height - dy);
          break;
        case 's':
          newRect.height = Math.max(minSize, startRect.height + dy);
          break;
        case 'w':
          newRect.x = startRect.x + dx;
          newRect.width = Math.max(minSize, startRect.width - dx);
          break;
        case 'e':
          newRect.width = Math.max(minSize, startRect.width + dx);
          break;
      }

      setCropRect(newRect);
    };

    const handleMouseUp = () => {
      cropDragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isCropping, cropRect]);

  // ===================== EXPORT =====================

  const exportImage = async () => {
    if (!originalDataUrl) return;
    setIsExporting(true);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = originalDataUrl;
      });

      let srcX = 0;
      let srcY = 0;
      let srcW = img.naturalWidth;
      let srcH = img.naturalHeight;

      if (appliedCrop) {
        srcX = Math.round(appliedCrop.x);
        srcY = Math.round(appliedCrop.y);
        srcW = Math.round(appliedCrop.width);
        srcH = Math.round(appliedCrop.height);
      }

      const rotation = ((adjustments.rotation % 360) + 360) % 360;
      const isRotated90or270 = rotation === 90 || rotation === 270;
      const outW = isRotated90or270 ? srcH : srcW;
      const outH = isRotated90or270 ? srcW : srcH;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get canvas context');

      // Build filter string
      const filterParts: string[] = [];
      const b = 100 + adjustments.brightness;
      if (b !== 100) filterParts.push(`brightness(${b}%)`);
      const c = 100 + adjustments.contrast;
      if (c !== 100) filterParts.push(`contrast(${c}%)`);
      const s = 100 + adjustments.saturation;
      if (s !== 100) filterParts.push(`saturate(${s}%)`);
      if (adjustments.grayscale) filterParts.push('grayscale(100%)');
      if (adjustments.sepia) filterParts.push('sepia(100%)');
      if (adjustments.blur > 0) filterParts.push(`blur(${adjustments.blur}px)`);
      ctx.filter = filterParts.length > 0 ? filterParts.join(' ') : 'none';

      ctx.translate(outW / 2, outH / 2);
      const radians = (rotation * Math.PI) / 180;
      ctx.rotate(radians);

      // Apply flip
      const sx = adjustments.flipH ? -1 : 1;
      const sy = adjustments.flipV ? -1 : 1;
      ctx.scale(sx, sy);

      // Draw the cropped portion centered
      ctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Export failed'))),
          'image/png'
        );
      });

      downloadBlob(blob, `${originalFileName}-edited.png`);
      toast.success('Image downloaded!');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export image');
    } finally {
      setIsExporting(false);
    }
  };

  // ===================== RENDER =====================

  if (!originalDataUrl) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-500/10 mb-4">
            <Paintbrush className="h-8 w-8 text-purple-500" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Image Editor</h1>
          <p className="text-muted-foreground mt-2 max-w-lg mx-auto">
            Upload an image to crop, rotate, flip, and adjust brightness, contrast, saturation, and more.
          </p>
        </div>
        <FileUploader
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple={false}
          maxFiles={1}
          maxSize={50 * 1024 * 1024}
          onFilesSelected={handleFileSelected}
          label="Upload an Image"
          description="Drag & drop a JPG, PNG, or WEBP image"
          showFileList={false}
        />
      </div>
    );
  }

  const cropHandleCursors: Record<string, string> = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    move: 'move',
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-500/10">
            <Paintbrush className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Image Editor</h1>
            <p className="text-xs text-muted-foreground">{originalFileName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setOriginalDataUrl(null); }}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            New Image
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowComparison((v) => !v)}
          >
            {showComparison ? (
              <EyeOff className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <SplitSquareHorizontal className="h-3.5 w-3.5 mr-1.5" />
            )}
            {showComparison ? 'Hide Original' : 'Compare'}
          </Button>
          <Button size="sm" onClick={exportImage} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Download PNG
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Image Canvas Area */}
        <div className="lg:col-span-3 space-y-4">
          {/* Toolbar */}
          <div className="flex items-center gap-1 p-1 rounded-lg border bg-card flex-wrap">
            <Button
              variant={isCropping ? 'default' : 'ghost'}
              size="sm"
              onClick={() => (isCropping ? cancelCrop() : startCropMode())}
            >
              <Crop className="h-3.5 w-3.5 mr-1.5" />
              Crop
            </Button>
            {isCropping && (
              <>
                <Button size="sm" variant="default" onClick={applyCrop}>
                  Apply Crop
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelCrop}>
                  Cancel
                </Button>
              </>
            )}
            <div className="w-px h-6 bg-border mx-1" />
            <Button variant="ghost" size="sm" onClick={rotateLeft}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              -90°
            </Button>
            <Button variant="ghost" size="sm" onClick={rotateRight}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              +90°
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant={adjustments.flipH ? 'secondary' : 'ghost'}
              size="sm"
              onClick={flipH}
            >
              <FlipHorizontal className="h-3.5 w-3.5 mr-1.5" />
              Flip H
            </Button>
            <Button
              variant={adjustments.flipV ? 'secondary' : 'ghost'}
              size="sm"
              onClick={flipV}
            >
              <FlipVertical className="h-3.5 w-3.5 mr-1.5" />
              Flip V
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={resetAll}>
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Reset
            </Button>
          </div>

          {/* Image preview area */}
          <div className={cn('grid gap-4', showComparison ? 'grid-cols-2' : 'grid-cols-1')}>
            {showComparison && (
              <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-center overflow-hidden">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Original</p>
                  <img
                    src={originalDataUrl}
                    alt="Original"
                    className="max-w-full max-h-[60vh] object-contain rounded"
                  />
                </div>
              </div>
            )}
            <div
              ref={imageContainerRef}
              className="relative rounded-lg border bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)_0_0/20px_20px] p-4 flex items-center justify-center overflow-hidden min-h-[400px]"
              onMouseDown={handleCropMouseDown}
              style={{
                cursor: isCropping && cropRect ? undefined : 'default',
              }}
            >
              <img
                ref={previewImageRef}
                src={originalDataUrl}
                alt="Editing"
                onLoad={handleImageLoad}
                className="max-w-full max-h-[60vh] object-contain rounded"
                style={{
                  filter: getCssFilter(),
                  transform: getCssTransform(),
                  ...(appliedCrop
                    ? {
                        objectFit: 'none' as const,
                        objectPosition: `-${appliedCrop.x}px -${appliedCrop.y}px`,
                        width: `${appliedCrop.width}px`,
                        height: `${appliedCrop.height}px`,
                        maxWidth: '100%',
                        maxHeight: '60vh',
                      }
                    : {}),
                }}
              />

              {/* Crop overlay */}
              {isCropping && cropRect && (
                <>
                  {/* Dimmed area around crop */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5))`,
                      clipPath: `polygon(
                        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                        ${cropRect.x}px ${cropRect.y}px,
                        ${cropRect.x}px ${cropRect.y + cropRect.height}px,
                        ${cropRect.x + cropRect.width}px ${cropRect.y + cropRect.height}px,
                        ${cropRect.x + cropRect.width}px ${cropRect.y}px,
                        ${cropRect.x}px ${cropRect.y}px
                      )`,
                    }}
                  />
                  {/* Crop border */}
                  <div
                    className="absolute border-2 border-white"
                    style={{
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.width,
                      height: cropRect.height,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                    }}
                  >
                    {/* Grid lines */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
                      <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
                      <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
                      <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
                    </div>
                    {/* Corner handles */}
                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
                      const pos: React.CSSProperties = {};
                      if (corner.includes('n')) pos.top = -5;
                      if (corner.includes('s')) pos.bottom = -5;
                      if (corner.includes('w')) pos.left = -5;
                      if (corner.includes('e')) pos.right = -5;
                      return (
                        <div
                          key={corner}
                          className="absolute w-2.5 h-2.5 bg-white border border-gray-400 rounded-sm"
                          style={{
                            ...pos,
                            cursor: cropHandleCursors[corner],
                          }}
                        />
                      );
                    })}
                    {/* Edge handles */}
                    {(['n', 's', 'e', 'w'] as const).map((edge) => {
                      const pos: React.CSSProperties = { position: 'absolute' };
                      if (edge === 'n') {
                        pos.top = -4;
                        pos.left = '50%';
                        pos.transform = 'translateX(-50%)';
                      }
                      if (edge === 's') {
                        pos.bottom = -4;
                        pos.left = '50%';
                        pos.transform = 'translateX(-50%)';
                      }
                      if (edge === 'w') {
                        pos.left = -4;
                        pos.top = '50%';
                        pos.transform = 'translateY(-50%)';
                      }
                      if (edge === 'e') {
                        pos.right = -4;
                        pos.top = '50%';
                        pos.transform = 'translateY(-50%)';
                      }
                      return (
                        <div
                          key={edge}
                          className="w-2 h-2 bg-white border border-gray-400 rounded-sm"
                          style={{
                            ...pos,
                            cursor: cropHandleCursors[edge],
                          }}
                        />
                      );
                    })}
                    {/* Size label */}
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                      {Math.round(cropRect.width)} × {Math.round(cropRect.height)}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Adjustments */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-5">
            <p className="text-sm font-medium">Adjustments</p>

            {/* Brightness */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Brightness</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{adjustments.brightness}</span>
              </div>
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[adjustments.brightness]}
                onValueChange={([v]) => updateAdjustment('brightness', v)}
              />
            </div>

            {/* Contrast */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Contrast</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{adjustments.contrast}</span>
              </div>
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[adjustments.contrast]}
                onValueChange={([v]) => updateAdjustment('contrast', v)}
              />
            </div>

            {/* Saturation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Saturation</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{adjustments.saturation}</span>
              </div>
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[adjustments.saturation]}
                onValueChange={([v]) => updateAdjustment('saturation', v)}
              />
            </div>

            {/* Blur */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Blur</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{adjustments.blur}px</span>
              </div>
              <Slider
                min={0}
                max={20}
                step={0.5}
                value={[adjustments.blur]}
                onValueChange={([v]) => updateAdjustment('blur', v)}
              />
            </div>

            <div className="h-px bg-border" />

            {/* Filters */}
            <p className="text-sm font-medium">Filters</p>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Grayscale</Label>
              <Switch
                checked={adjustments.grayscale}
                onCheckedChange={(v) => updateAdjustment('grayscale', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Sepia</Label>
              <Switch
                checked={adjustments.sepia}
                onCheckedChange={(v) => updateAdjustment('sepia', v)}
              />
            </div>

            <div className="h-px bg-border" />

            {/* Transform info */}
            <p className="text-sm font-medium">Transform</p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Rotation: {((adjustments.rotation % 360) + 360) % 360}°</p>
              <p>Flip H: {adjustments.flipH ? 'Yes' : 'No'}</p>
              <p>Flip V: {adjustments.flipV ? 'Yes' : 'No'}</p>
              {appliedCrop && (
                <p>
                  Crop: {Math.round(appliedCrop.width)}×{Math.round(appliedCrop.height)} at ({Math.round(appliedCrop.x)},{Math.round(appliedCrop.y)})
                </p>
              )}
            </div>

            {appliedCrop && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setAppliedCrop(null);
                  toast.info('Crop removed');
                }}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Remove Crop
              </Button>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={resetAll}>
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Reset All
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
