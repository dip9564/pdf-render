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
  SlidersHorizontal,
  Settings2,
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
  const [mobileTab, setMobileTab] = useState<'adjust' | 'transform'>('adjust');

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

  const handleCropTouchStart = (e: React.TouchEvent) => {
    if (!isCropping || !cropRect || !imageContainerRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const containerRect = imageContainerRef.current.getBoundingClientRect();
    const mx = touch.clientX - containerRect.left;
    const my = touch.clientY - containerRect.top;
    const handle = getHandleAtPosition(mx, my, cropRect);
    if (!handle) return;
    cropDragRef.current = {
      handle,
      startX: touch.clientX,
      startY: touch.clientY,
      startRect: { ...cropRect },
    };
  };

  useEffect(() => {
    if (!isCropping) return;

    const handleMove = (clientX: number, clientY: number) => {
      if (!cropDragRef.current || !cropRect) return;
      const { handle, startX, startY, startRect } = cropDragRef.current;
      const dx = clientX - startX;
      const dy = clientY - startY;
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

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      cropDragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
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

  // Sub-renderers for Adjustments & Transform panels
  const renderAdjustmentsPanel = (isMobile: boolean) => (
    <div className={cn('space-y-3', isMobile && 'p-3 rounded-xl border bg-card shadow-xs')}>
      {!isMobile && <p className="text-sm font-medium">Adjustments</p>}

      {/* Sliders grid */}
      <div className={cn(isMobile ? 'grid grid-cols-2 gap-2.5' : 'space-y-3')}>
        {/* Brightness */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] sm:text-xs">Brightness</Label>
            <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums font-mono">
              {adjustments.brightness > 0 ? `+${adjustments.brightness}` : adjustments.brightness}
            </span>
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
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] sm:text-xs">Contrast</Label>
            <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums font-mono">
              {adjustments.contrast > 0 ? `+${adjustments.contrast}` : adjustments.contrast}
            </span>
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
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] sm:text-xs">Saturation</Label>
            <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums font-mono">
              {adjustments.saturation > 0 ? `+${adjustments.saturation}` : adjustments.saturation}
            </span>
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
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] sm:text-xs">Blur</Label>
            <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums font-mono">
              {adjustments.blur}px
            </span>
          </div>
          <Slider
            min={0}
            max={20}
            step={0.5}
            value={[adjustments.blur]}
            onValueChange={([v]) => updateAdjustment('blur', v)}
          />
        </div>
      </div>

      <div className="h-px bg-border my-2" />

      {/* Filters (Grayscale, Sepia) */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={isMobile ? 'm-grayscale' : 'grayscale-switch'}
            checked={adjustments.grayscale}
            onCheckedChange={(v) => updateAdjustment('grayscale', v)}
          />
          <Label htmlFor={isMobile ? 'm-grayscale' : 'grayscale-switch'} className="text-xs cursor-pointer">
            Grayscale
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id={isMobile ? 'm-sepia' : 'sepia-switch'}
            checked={adjustments.sepia}
            onCheckedChange={(v) => updateAdjustment('sepia', v)}
          />
          <Label htmlFor={isMobile ? 'm-sepia' : 'sepia-switch'} className="text-xs cursor-pointer">
            Sepia
          </Label>
        </div>

        {isMobile && (
          <Button variant="ghost" size="sm" onClick={resetAll} className="h-7 text-xs text-muted-foreground px-2 ml-auto">
            <Undo2 className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {isMobile && (
        <Button
          size="sm"
          onClick={exportImage}
          disabled={isExporting}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white h-9 text-xs font-medium mt-2"
        >
          {isExporting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Exporting PNG...
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download PNG
            </>
          )}
        </Button>
      )}
    </div>
  );

  const renderTransformPanel = (isMobile: boolean) => (
    <div className={cn('space-y-3', isMobile && 'p-3 rounded-xl border bg-card shadow-xs')}>
      {!isMobile && <p className="text-sm font-medium">Transform</p>}

      <div className="text-xs text-muted-foreground space-y-1.5">
        <div className="flex items-center justify-between">
          <span>Rotation:</span>
          <span className="font-mono text-foreground">{((adjustments.rotation % 360) + 360) % 360}°</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Flip Horizontal:</span>
          <span className="font-mono text-foreground">{adjustments.flipH ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Flip Vertical:</span>
          <span className="font-mono text-foreground">{adjustments.flipV ? 'Yes' : 'No'}</span>
        </div>
        {appliedCrop && (
          <div className="flex items-center justify-between">
            <span>Crop Area:</span>
            <span className="font-mono text-foreground">
              {Math.round(appliedCrop.width)}×{Math.round(appliedCrop.height)}
            </span>
          </div>
        )}
      </div>

      {appliedCrop && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30"
          onClick={() => {
            setAppliedCrop(null);
            toast.info('Crop removed');
          }}
        >
          <X className="h-3.5 w-3.5 mr-1.5" />
          Remove Crop
        </Button>
      )}

      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={resetAll}>
        <Undo2 className="h-3.5 w-3.5 mr-1.5" />
        Reset All Adjustments
      </Button>

      {isMobile && (
        <Button
          size="sm"
          onClick={exportImage}
          disabled={isExporting}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white h-9 text-xs font-medium mt-1"
        >
          {isExporting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Exporting PNG...
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download PNG
            </>
          )}
        </Button>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-7xl">
      {/* Mobile Compact Header */}
      <div className="sm:hidden flex items-center justify-between pb-2 mb-2 border-b">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 shrink-0">
            <Paintbrush className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold truncate max-w-[130px]">{originalFileName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={() => setOriginalDataUrl(null)}
            title="Upload another image"
          >
            <Upload className="h-3 w-3 mr-0.5" />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-1.5"
            onClick={() => setShowComparison((v) => !v)}
            title={showComparison ? 'Hide original' : 'Compare with original'}
          >
            {showComparison ? (
              <EyeOff className="h-3 w-3 mr-0.5" />
            ) : (
              <SplitSquareHorizontal className="h-3 w-3 mr-0.5" />
            )}
            {showComparison ? 'Hide' : 'Compare'}
          </Button>
          <Button
            size="sm"
            onClick={exportImage}
            disabled={isExporting}
            className="h-6 text-[11px] px-2 bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Download className="h-3 w-3 mr-0.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden sm:flex items-center justify-between mb-6 flex-wrap gap-3">
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
          <Button variant="outline" size="sm" onClick={() => setOriginalDataUrl(null)}>
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Image Canvas Column */}
        <div className="lg:col-span-3 space-y-3 sm:space-y-4">
          {/* Desktop Toolbar */}
          <div className="hidden lg:flex items-center gap-1 p-1 rounded-lg border bg-card flex-wrap">
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

          {/* Image preview area (responsive height: h-[310px] on mobile, min-h-[440px] on desktop) */}
          <div className={cn('grid gap-3 sm:gap-4', showComparison ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')}>
            {showComparison && (
              <div className="rounded-lg border bg-muted/30 p-2 sm:p-4 flex items-center justify-center overflow-hidden h-[260px] sm:h-[340px] lg:h-auto lg:min-h-[440px]">
                <div className="text-center w-full h-full flex flex-col items-center justify-center">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Original</p>
                  <img
                    src={originalDataUrl}
                    alt="Original"
                    className="max-w-full max-h-[235px] sm:max-h-[300px] lg:max-h-[60vh] object-contain rounded"
                  />
                </div>
              </div>
            )}
            <div
              ref={imageContainerRef}
              className="relative rounded-lg border bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)_0_0/20px_20px] dark:bg-[repeating-conic-gradient(#374151_0%_25%,transparent_0%_50%)_0_0/20px_20px] p-2 sm:p-4 flex items-center justify-center overflow-hidden h-[310px] sm:h-[360px] lg:h-auto lg:min-h-[440px] select-none touch-none"
              onMouseDown={handleCropMouseDown}
              onTouchStart={handleCropTouchStart}
              style={{
                cursor: isCropping && cropRect ? undefined : 'default',
              }}
            >
              <img
                ref={previewImageRef}
                src={originalDataUrl}
                alt="Editing"
                onLoad={handleImageLoad}
                className="max-w-full max-h-[290px] sm:max-h-[340px] lg:max-h-[60vh] object-contain rounded"
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
                          className="absolute w-3 h-3 bg-white border border-gray-400 rounded-xs"
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
                          className="w-2.5 h-2.5 bg-white border border-gray-400 rounded-xs"
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

          {/* Mobile Toolbar (Directly beneath canvas on mobile) */}
          <div className="lg:hidden flex items-center gap-1 p-1 rounded-lg border bg-card flex-wrap justify-between text-xs shadow-xs">
            <Button
              variant={isCropping ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => (isCropping ? cancelCrop() : startCropMode())}
            >
              <Crop className="h-3 w-3 mr-1" />
              Crop
            </Button>
            {isCropping && (
              <>
                <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={applyCrop}>
                  Apply
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={cancelCrop}>
                  Cancel
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={rotateLeft}>
              <RotateCcw className="h-3 w-3 mr-0.5" />
              -90°
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={rotateRight}>
              <RotateCw className="h-3 w-3 mr-0.5" />
              +90°
            </Button>
            <Button
              variant={adjustments.flipH ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={flipH}
            >
              <FlipHorizontal className="h-3 w-3 mr-0.5" />
              Flip H
            </Button>
            <Button
              variant={adjustments.flipV ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={flipV}
            >
              <FlipVertical className="h-3 w-3 mr-0.5" />
              Flip V
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-muted-foreground" onClick={resetAll}>
              <Undo2 className="h-3 w-3 mr-0.5" />
              Reset
            </Button>
          </div>

          {/* Mobile Segmented Mode Tabs */}
          <div className="lg:hidden grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl text-xs font-medium border shadow-xs">
            <button
              type="button"
              onClick={() => setMobileTab('adjust')}
              className={cn(
                'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all touch-manipulation',
                mobileTab === 'adjust'
                  ? 'bg-background text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-purple-500" />
              <span>Adjust & Filter</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('transform')}
              className={cn(
                'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all touch-manipulation',
                mobileTab === 'transform'
                  ? 'bg-background text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Settings2 className="h-3.5 w-3.5 text-purple-500" />
              <span>Transform & Info</span>
            </button>
          </div>

          {/* Mobile Active Tab Body */}
          <div className="lg:hidden">
            {mobileTab === 'adjust' ? renderAdjustmentsPanel(true) : renderTransformPanel(true)}
          </div>
        </div>

        {/* Desktop Right Sidebar */}
        <div className="hidden lg:block space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-4 shadow-xs">
            {renderAdjustmentsPanel(false)}
            <div className="h-px bg-border my-2" />
            {renderTransformPanel(false)}
          </div>
        </div>
      </div>
    </div>
  );
}
