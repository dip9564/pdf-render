import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  downloadBlob,
  readFileAsDataURL,
  generateId,
  getPageSizeDimensions,
  createPdfBlob,
} from '@/lib/utils';
import { FileUploader } from '@/components/shared/FileUploader';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  FileImage,
  Download,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Crop,
  Trash2,
  GripVertical,
  Loader2,
  Settings2,
  ChevronLeft,
  ChevronRight,
  X,
  Paintbrush,
  Check,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  Layers,
} from 'lucide-react';

export interface ImageItem {
  id: string;
  file: File;
  originalDataUrl: string;
  dataUrl: string;
  hasCrop?: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number; // 0 - 200, 100 default
  contrast: number; // 0 - 200, 100 default
  saturation: number; // 0 - 200, 100 default
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
  blur: number; // 0 - 10, 0 default
}

export type PageSize = 'A4' | 'A3' | 'Letter' | 'Legal' | 'Custom';
export type Orientation = 'portrait' | 'landscape';
export type FitMode = 'fit' | 'fill' | 'original';

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Interactive Crop Modal for Image to PDF
function ImageCropModal({
  imageItem,
  onApplyCrop,
  onClose,
}: {
  imageItem: ImageItem | null;
  onApplyCrop: (croppedDataUrl: string) => void;
  onClose: () => void;
}) {
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null); // null = freeform
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    handle: string;
    startX: number;
    startY: number;
    startBox: CropBox;
  } | null>(null);

  // Initialize crop box when image loads in modal
  const handleImageLoad = () => {
    if (!imgRef.current || !containerRef.current) return;
    const imgEl = imgRef.current;
    const container = containerRef.current;
    const imgRect = imgEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();

    const imgLeft = imgRect.left - cRect.left;
    const imgTop = imgRect.top - cRect.top;
    const w = imgRect.width;
    const h = imgRect.height;

    const pad = Math.min(w, h) * 0.1;
    setCropBox({
      x: imgLeft + pad,
      y: imgTop + pad,
      width: Math.max(40, w - pad * 2),
      height: Math.max(40, h - pad * 2),
    });
  };

  const getHandleAt = (mx: number, my: number, box: CropBox): string | null => {
    const hs = 14;
    const corners = [
      { h: 'nw', x: box.x, y: box.y },
      { h: 'ne', x: box.x + box.width, y: box.y },
      { h: 'sw', x: box.x, y: box.y + box.height },
      { h: 'se', x: box.x + box.width, y: box.y + box.height },
    ];
    for (const c of corners) {
      if (Math.abs(mx - c.x) <= hs && Math.abs(my - c.y) <= hs) return c.h;
    }
    if (mx >= box.x && mx <= box.x + box.width && my >= box.y && my <= box.y + box.height) {
      return 'move';
    }
    return null;
  };

  const handlePointerDown = (clientX: number, clientY: number) => {
    if (!cropBox || !containerRef.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const mx = clientX - cRect.left;
    const my = clientY - cRect.top;
    const handle = getHandleAt(mx, my, cropBox);
    if (!handle) return;

    dragRef.current = {
      handle,
      startX: clientX,
      startY: clientY,
      startBox: { ...cropBox },
    };
  };

  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current || !cropBox || !imgRef.current || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const { handle, startX, startY, startBox } = dragRef.current;
      const dx = clientX - startX;
      const dy = clientY - startY;

      const imgRect = imgRef.current.getBoundingClientRect();
      const cRect = containerRef.current.getBoundingClientRect();
      const minX = imgRect.left - cRect.left;
      const minY = imgRect.top - cRect.top;
      const maxX = minX + imgRect.width;
      const maxY = minY + imgRect.height;

      let next = { ...startBox };

      if (handle === 'move') {
        next.x = Math.max(minX, Math.min(maxX - startBox.width, startBox.x + dx));
        next.y = Math.max(minY, Math.min(maxY - startBox.height, startBox.y + dy));
      } else {
        if (handle.includes('e')) {
          next.width = Math.max(30, Math.min(maxX - startBox.x, startBox.width + dx));
        }
        if (handle.includes('s')) {
          next.height = Math.max(30, Math.min(maxY - startBox.y, startBox.height + dy));
        }
        if (handle.includes('w')) {
          const maxLeft = startBox.x + startBox.width - 30;
          next.x = Math.max(minX, Math.min(maxLeft, startBox.x + dx));
          next.width = startBox.width - (next.x - startBox.x);
        }
        if (handle.includes('n')) {
          const maxTop = startBox.y + startBox.height - 30;
          next.y = Math.max(minY, Math.min(maxTop, startBox.y + dy));
          next.height = startBox.height - (next.y - startBox.y);
        }

        if (aspectRatio) {
          next.height = next.width / aspectRatio;
          if (next.y + next.height > maxY) {
            next.height = maxY - next.y;
            next.width = next.height * aspectRatio;
          }
        }
      }

      setCropBox(next);
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [cropBox, aspectRatio]);

  const handleApply = () => {
    if (!cropBox || !imgRef.current || !containerRef.current || !imageItem) return;
    const imgEl = imgRef.current;
    const cRect = containerRef.current.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();

    const imgRelLeft = imgRect.left - cRect.left;
    const imgRelTop = imgRect.top - cRect.top;

    const scaleX = imgEl.naturalWidth / imgRect.width;
    const scaleY = imgEl.naturalHeight / imgRect.height;

    const sx = Math.max(0, (cropBox.x - imgRelLeft) * scaleX);
    const sy = Math.max(0, (cropBox.y - imgRelTop) * scaleY);
    const sw = Math.min(imgEl.naturalWidth - sx, cropBox.width * scaleX);
    const sh = Math.min(imgEl.naturalHeight - sy, cropBox.height * scaleY);

    if (sw <= 0 || sh <= 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedDataUrl = canvas.toDataURL('image/png', 0.95);
    onApplyCrop(croppedDataUrl);
  };

  if (!imageItem) return null;

  return (
    <Dialog open={!!imageItem} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Crop className="h-4 w-4 text-primary" />
            <span>Crop Image: {imageItem.file.name}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Aspect Ratio Presets */}
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          <span className="text-xs text-muted-foreground mr-1 font-medium">Aspect Ratio:</span>
          {[
            { label: 'Freeform', val: null },
            { label: '1:1 Square', val: 1 },
            { label: '4:3 Standard', val: 4 / 3 },
            { label: '16:9 Widescreen', val: 16 / 9 },
            { label: 'A4 Ratio', val: 1 / 1.4142 },
          ].map((item) => (
            <Button
              key={item.label}
              variant={aspectRatio === item.val ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => {
                setAspectRatio(item.val);
                if (item.val && cropBox) {
                  setCropBox((prev) =>
                    prev ? { ...prev, height: prev.width / item.val! } : null
                  );
                }
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {/* Interactive Cropper Area */}
        <div
          ref={containerRef}
          className="relative bg-muted/30 border rounded-lg overflow-hidden flex items-center justify-center p-2 min-h-[280px] max-h-[55vh] select-none touch-none"
          onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
          onTouchStart={(e) => {
            if (e.touches.length > 0) {
              handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
            }
          }}
        >
          <img
            ref={imgRef}
            src={imageItem.originalDataUrl || imageItem.dataUrl}
            alt="To crop"
            onLoad={handleImageLoad}
            className="max-h-[50vh] max-w-full object-contain pointer-events-none rounded shadow-xs"
          />

          {cropBox && (
            <>
              {/* Dimmed backdrop outside crop area */}
              <div
                className="absolute inset-0 bg-black/55 pointer-events-none"
                style={{
                  clipPath: `polygon(
                    0% 0%, 100% 0%, 100% 100%, 0% 100%,
                    0% ${cropBox.y}px,
                    ${cropBox.x}px ${cropBox.y}px,
                    ${cropBox.x}px ${cropBox.y + cropBox.height}px,
                    ${cropBox.x + cropBox.width}px ${cropBox.y + cropBox.height}px,
                    ${cropBox.x + cropBox.width}px ${cropBox.y}px,
                    0% ${cropBox.y}px
                  )`,
                }}
              />

              {/* Crop bounding box with grid and handles */}
              <div
                className="absolute border-2 border-primary shadow-lg cursor-move"
                style={{
                  left: cropBox.x,
                  top: cropBox.y,
                  width: cropBox.width,
                  height: cropBox.height,
                }}
              >
                {/* 3x3 Grid overlay */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                  <div className="border-r border-b border-primary/50" />
                  <div className="border-r border-b border-primary/50" />
                  <div className="border-b border-primary/50" />
                  <div className="border-r border-b border-primary/50" />
                  <div className="border-r border-b border-primary/50" />
                  <div className="border-b border-primary/50" />
                  <div className="border-r border-primary/50" />
                  <div className="border-r border-primary/50" />
                  <div />
                </div>

                {/* Corner drag handles */}
                <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-primary rounded-full cursor-nwse-resize" />
                <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-primary rounded-full cursor-nesw-resize" />
                <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-primary rounded-full cursor-nesw-resize" />
                <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-primary rounded-full cursor-nwse-resize" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply}>
            <Check className="h-4 w-4 mr-1.5" />
            Apply Crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Pixel manipulation for 100% cross-browser filter baking (Safari, Chrome, Firefox)
function applyPixelFilters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  img: ImageItem
) {
  const hasFilter =
    img.brightness !== 100 ||
    img.contrast !== 100 ||
    img.saturation !== 100 ||
    img.grayscale ||
    img.sepia ||
    img.invert ||
    img.blur > 0;

  if (!hasFilter) return;

  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const len = data.length;

    const bFactor = img.brightness / 100;
    const cFactor = img.contrast / 100;
    const sFactor = img.saturation / 100;
    const isGray = img.grayscale;
    const isSepia = img.sepia;
    const isInvert = img.invert;

    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (isInvert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      if (isGray) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray;
        g = gray;
        b = gray;
      }

      if (isSepia) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r = sr;
        g = sg;
        b = sb;
      }

      if (bFactor !== 1) {
        r *= bFactor;
        g *= bFactor;
        b *= bFactor;
      }

      if (cFactor !== 1) {
        r = (r - 128) * cFactor + 128;
        g = (g - 128) * cFactor + 128;
        b = (b - 128) * cFactor + 128;
      }

      if (!isGray && sFactor !== 1) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * sFactor;
        g = gray + (g - gray) * sFactor;
        b = gray + (b - gray) * sFactor;
      }

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }

    ctx.putImageData(imgData, 0, 0);

    if (img.blur > 0) {
      const blurRadius = Math.min(20, Math.round(img.blur * 2));
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.drawImage(ctx.canvas, 0, 0);
        ctx.globalAlpha = 0.25;
        const step = Math.max(1, Math.round(blurRadius / 2));
        for (let dy = -blurRadius; dy <= blurRadius; dy += step) {
          for (let dx = -blurRadius; dx <= blurRadius; dx += step) {
            ctx.drawImage(tempCanvas, dx, dy);
          }
        }
        ctx.globalAlpha = 1.0;
      }
    }
  } catch (err) {
    console.warn('Canvas pixel manipulation error:', err);
  }
}

export default function ImageToPdf() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [croppingImage, setCroppingImage] = useState<ImageItem | null>(null);
  const [mobileTab, setMobileTab] = useState<'edit' | 'settings' | 'images'>('edit');

  const [isGenerating, setIsGenerating] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [margin, setMargin] = useState(20);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [quality, setQuality] = useState(0.85);
  const [customWidth, setCustomWidth] = useState(595);
  const [customHeight, setCustomHeight] = useState(842);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Selected image helper
  const selectedImage =
    images.find((img) => img.id === selectedImageId) || images[0] || null;
  const selectedIndex = selectedImage
    ? images.findIndex((img) => img.id === selectedImage.id)
    : 0;

  // Active page dimensions
  const pageDims =
    pageSize === 'Custom'
      ? orientation === 'landscape'
        ? { width: customHeight, height: customWidth }
        : { width: customWidth, height: customHeight }
      : getPageSizeDimensions(pageSize, orientation);

  // Handle uploaded files
  const handleFilesSelected = useCallback(async (files: File[]) => {
    try {
      const newImages: ImageItem[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataURL(file);
        newImages.push({
          id: generateId(),
          file,
          originalDataUrl: dataUrl,
          dataUrl,
          hasCrop: false,
          rotation: 0,
          flipH: false,
          flipV: false,
          brightness: 100,
          contrast: 100,
          saturation: 100,
          grayscale: false,
          sepia: false,
          invert: false,
          blur: 0,
        });
      }
      setImages((prev) => {
        const next = [...prev, ...newImages];
        if (!selectedImageId && next.length > 0) {
          setSelectedImageId(next[0].id);
        }
        return next;
      });
      toast.success(`Added ${files.length} image${files.length > 1 ? 's' : ''}`);
    } catch {
      toast.error('Failed to load some images');
    }
  }, [selectedImageId]);

  // Keep selectedImageId valid
  useEffect(() => {
    if (images.length === 0) {
      setSelectedImageId(null);
    } else if (!images.some((img) => img.id === selectedImageId)) {
      setSelectedImageId(images[0].id);
    }
  }, [images, selectedImageId]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id);
      return filtered;
    });
  }, []);

  const rotateImage = useCallback((id: string, delta: number = 90) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? { ...img, rotation: (img.rotation + delta + 360) % 360 }
          : img
      )
    );
  }, []);

  const toggleFlip = useCallback((id: string, dir: 'H' | 'V') => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? dir === 'H'
            ? { ...img, flipH: !img.flipH }
            : { ...img, flipV: !img.flipV }
          : img
      )
    );
  }, []);

  const updateImageAdjustment = useCallback(
    (
      id: string,
      key: keyof Pick<
        ImageItem,
        | 'brightness'
        | 'contrast'
        | 'saturation'
        | 'grayscale'
        | 'sepia'
        | 'invert'
        | 'blur'
      >,
      value: number | boolean
    ) => {
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, [key]: value } : img))
      );
    },
    []
  );

  const resetAdjustments = useCallback((id: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? {
              ...img,
              brightness: 100,
              contrast: 100,
              saturation: 100,
              grayscale: false,
              sepia: false,
              invert: false,
              blur: 0,
              rotation: 0,
              flipH: false,
              flipV: false,
            }
          : img
      )
    );
    toast.info('Adjustments reset');
  }, []);

  const applyFiltersToAll = useCallback(() => {
    if (!selectedImage) return;
    const {
      brightness,
      contrast,
      saturation,
      blur,
      grayscale,
      sepia,
      invert,
    } = selectedImage;

    setImages((prev) =>
      prev.map((img) => ({
        ...img,
        brightness,
        contrast,
        saturation,
        blur,
        grayscale,
        sepia,
        invert,
      }))
    );

    toast.success(`Applied filters to all ${images.length} images!`);
  }, [selectedImage, images.length]);

  const resetCrop = useCallback((id: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? {
              ...img,
              dataUrl: img.originalDataUrl,
              hasCrop: false,
            }
          : img
      )
    );
    toast.info('Crop reverted to original image');
  }, []);

  const handleApplyCrop = (croppedDataUrl: string) => {
    if (!croppingImage) return;
    setImages((prev) =>
      prev.map((img) =>
        img.id === croppingImage.id
          ? { ...img, dataUrl: croppedDataUrl, hasCrop: true }
          : img
      )
    );
    setCroppingImage(null);
    toast.success('Crop applied!');
  };

  const moveImage = (index: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
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

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (draggedIndex === null || draggedIndex === dropIndex) return;
      setImages((prev) => {
        const next = [...prev];
        const [moved] = next.splice(draggedIndex, 1);
        next.splice(dropIndex, 0, moved);
        return next;
      });
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [draggedIndex]
  );

  // Helper to build CSS filter string
  const getFilterString = (img: ImageItem): string => {
    const filters: string[] = [];
    if (img.brightness !== 100) filters.push(`brightness(${img.brightness}%)`);
    if (img.contrast !== 100) filters.push(`contrast(${img.contrast}%)`);
    if (img.saturation !== 100) filters.push(`saturate(${img.saturation}%)`);
    if (img.grayscale) filters.push('grayscale(100%)');
    if (img.sepia) filters.push('sepia(100%)');
    if (img.invert) filters.push('invert(100%)');
    if (img.blur > 0) filters.push(`blur(${img.blur}px)`);
    return filters.length > 0 ? filters.join(' ') : 'none';
  };

  // Apply baked adjustments before embedding in PDF
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

        ctx.translate(outW / 2, outH / 2);
        ctx.rotate(radians);

        const flipX = img.flipH ? -1 : 1;
        const flipY = img.flipV ? -1 : 1;
        if (flipX !== 1 || flipY !== 1) {
          ctx.scale(flipX, flipY);
        }

        ctx.drawImage(image, -srcW / 2, -srcH / 2, srcW, srcH);

        // Reset transform & apply mathematical pixel filters for 100% cross-browser fidelity
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        applyPixelFilters(ctx, outW, outH, img);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob failed'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () =>
              resolve(new Uint8Array(reader.result as ArrayBuffer));
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
        const clean = hex.replace('#', '');
        const intVal = parseInt(clean, 16);
        return {
          r: ((intVal >> 16) & 255) / 255,
          g: ((intVal >> 8) & 255) / 255,
          b: (intVal & 255) / 255,
        };
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
          color: {
            type: 'RGB' as const,
            red: rgb.r,
            green: rgb.g,
            blue: rgb.b,
          } as any,
        });

        const availableWidth = pageDims.width - margin * 2;
        const availableHeight = pageDims.height - margin * 2;
        const imgWidth = embeddedImage.width;
        const imgHeight = embeddedImage.height;

        let drawWidth: number;
        let drawHeight: number;

        if (fitMode === 'fit') {
          const scale = Math.min(
            availableWidth / imgWidth,
            availableHeight / imgHeight
          );
          drawWidth = imgWidth * scale;
          drawHeight = imgHeight * scale;
        } else if (fitMode === 'fill') {
          const scale = Math.max(
            availableWidth / imgWidth,
            availableHeight / imgHeight
          );
          drawWidth = imgWidth * scale;
          drawHeight = imgHeight * scale;
        } else {
          drawWidth = imgWidth;
          drawHeight = imgHeight;
        }

        const drawX = margin + (availableWidth - drawWidth) / 2;
        const drawYFromTop = margin + (availableHeight - drawHeight) / 2;
        const drawY_pdf = pageDims.height - drawYFromTop - drawHeight;

        page.drawImage(embeddedImage, {
          x: drawX,
          y: drawY_pdf,
          width: drawWidth,
          height: drawHeight,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = images[0]?.file?.name
        ? images[0].file.name.replace(/\.[^/.]+$/, '')
        : 'images';
      const outputFilename =
        images.length > 1
          ? `${baseName}_and_${images.length - 1}_more.pdf`
          : `${baseName}_converted.pdf`;
      downloadBlob(blob, outputFilename);
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
    setSelectedImageId(null);
    toast.info('All images cleared');
  }, []);

  // ---------------------------------------------------------------------------
  // Sub-renderers for Mobile & Desktop
  // ---------------------------------------------------------------------------

  // Live PDF Page Preview Card
  const renderPreviewCard = (isMobile: boolean) => {
    if (images.length === 0 || !selectedImage) {
      return (
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 shadow-xs">
          <FileImage className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs">Upload images to preview your PDF pages live</p>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'rounded-xl border bg-card shadow-xs transition-all',
          isMobile ? 'p-3 space-y-2' : 'p-4 sm:p-5 space-y-4'
        )}
      >
        {/* Header with Title and Pagination */}
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Eye className="h-4 w-4 text-blue-500 shrink-0" />
            <h2 className="text-xs sm:text-sm font-semibold truncate">Live Page Preview</h2>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] touch-manipulation"
              disabled={selectedIndex <= 0}
              onClick={() => setSelectedImageId(images[selectedIndex - 1].id)}
              title="Previous Page"
            >
              <ChevronLeft className="h-3 w-3 mr-0.5" />
              Prev
            </Button>
            <span className="text-[11px] font-semibold px-1 text-foreground min-w-[50px] text-center">
              {selectedIndex + 1} / {images.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] touch-manipulation"
              disabled={selectedIndex >= images.length - 1}
              onClick={() => setSelectedImageId(images[selectedIndex + 1].id)}
              title="Next Page"
            >
              Next
              <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>

        {/* Paper Sheet Preview Container */}
        <div
          className={cn(
            'flex items-center justify-center bg-muted/30 border rounded-lg overflow-hidden select-none',
            isMobile ? 'p-2 h-[190px]' : 'p-3 sm:p-4 min-h-[360px]'
          )}
        >
          <div
            className={cn(
              'relative shadow-md rounded border overflow-hidden transition-all duration-150 flex items-center justify-center',
              isMobile ? 'h-full max-h-[175px] max-w-full' : 'max-w-full max-h-[460px]'
            )}
            style={{
              backgroundColor: bgColor,
              aspectRatio: `${pageDims.width} / ${pageDims.height}`,
              ...(!isMobile
                ? { width: orientation === 'portrait' ? '300px' : '420px' }
                : {}),
            }}
          >
            {/* Margin Boundary Area */}
            <div
              className="absolute inset-0 flex items-center justify-center overflow-hidden"
              style={{
                padding: `${(margin / Math.max(pageDims.width, pageDims.height)) * 100}%`,
              }}
            >
              {/* Margin dashed guide */}
              {margin > 0 && (
                <div
                  className="absolute pointer-events-none border border-dashed border-black/20 dark:border-white/25"
                  style={{
                    inset: `${(margin / Math.max(pageDims.width, pageDims.height)) * 100}%`,
                  }}
                />
              )}

              {/* Filtered & Transformed Image */}
              <div
                className={cn(
                  'w-full h-full flex items-center justify-center overflow-hidden',
                  fitMode === 'fill' ? 'relative' : ''
                )}
              >
                <img
                  src={selectedImage.dataUrl}
                  alt={selectedImage.file.name}
                  style={{
                    filter: getFilterString(selectedImage),
                    transform: `rotate(${selectedImage.rotation}deg) scaleX(${
                      selectedImage.flipH ? -1 : 1
                    }) scaleY(${selectedImage.flipV ? -1 : 1})`,
                  }}
                  className={cn(
                    'transition-transform duration-75 block',
                    fitMode === 'fit'
                      ? 'max-w-full max-h-full object-contain'
                      : fitMode === 'fill'
                      ? 'w-full h-full object-cover'
                      : 'max-w-none'
                  )}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Page details info pill */}
        <p className="text-[10px] sm:text-[11px] text-center text-muted-foreground truncate">
          {pageSize} ({orientation}) • {fitMode === 'fit' ? 'Fit to Page' : fitMode === 'fill' ? 'Fill Page' : 'Original'} • Margin: {margin}pt
        </p>
      </div>
    );
  };

  // Selected Image Edit & Filter Panel
  const renderEditPanel = (isMobile: boolean) => {
    if (!selectedImage) return null;

    return (
      <div className="rounded-xl border bg-card p-3 sm:p-5 space-y-3.5 shadow-xs">
        {/* Header & Reset / Batch actions */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 bg-primary/10 text-primary rounded-md shrink-0">
              <Paintbrush className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-semibold truncate max-w-[190px] sm:max-w-none">
                Edit: {selectedImage.file.name}
              </h3>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Real-time updates in preview above
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {selectedImage.hasCrop && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 sm:h-7 text-[11px] text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30 px-2"
                onClick={() => resetCrop(selectedImage.id)}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Reset Crop
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 sm:h-7 text-[11px] text-muted-foreground px-2"
              onClick={() => resetAdjustments(selectedImage.id)}
            >
              Reset Filters
            </Button>
          </div>
        </div>

        {/* Transform Actions: Crop, Rotate, Flip */}
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Button
            variant="default"
            size="sm"
            className="h-7 sm:h-8 text-xs font-medium px-2.5"
            onClick={() => setCroppingImage(selectedImage)}
          >
            <Crop className="h-3.5 w-3.5 mr-1" />
            Crop
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 sm:h-8 text-xs px-2"
            onClick={() => rotateImage(selectedImage.id, -90)}
            title="Rotate Left 90°"
          >
            <RotateCcw className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Left</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 sm:h-8 text-xs px-2"
            onClick={() => rotateImage(selectedImage.id, 90)}
            title="Rotate Right 90°"
          >
            <RotateCw className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Right</span>
          </Button>
          <Button
            variant={selectedImage.flipH ? 'default' : 'outline'}
            size="sm"
            className="h-7 sm:h-8 text-xs px-2"
            onClick={() => toggleFlip(selectedImage.id, 'H')}
          >
            <FlipHorizontal className="h-3.5 w-3.5 sm:mr-1" />
            <span>Flip H</span>
          </Button>
          <Button
            variant={selectedImage.flipV ? 'default' : 'outline'}
            size="sm"
            className="h-7 sm:h-8 text-xs px-2"
            onClick={() => toggleFlip(selectedImage.id, 'V')}
          >
            <FlipVertical className="h-3.5 w-3.5 sm:mr-1" />
            <span>Flip V</span>
          </Button>
        </div>

        {/* Filter Sliders in 2-column Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 pt-0.5">
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px]">Brightness</Label>
              <span className="text-[11px] text-muted-foreground font-mono">
                {selectedImage.brightness}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[selectedImage.brightness]}
              onValueChange={([v]) =>
                updateImageAdjustment(selectedImage.id, 'brightness', v)
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px]">Contrast</Label>
              <span className="text-[11px] text-muted-foreground font-mono">
                {selectedImage.contrast}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[selectedImage.contrast]}
              onValueChange={([v]) =>
                updateImageAdjustment(selectedImage.id, 'contrast', v)
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px]">Saturation</Label>
              <span className="text-[11px] text-muted-foreground font-mono">
                {selectedImage.saturation}%
              </span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[selectedImage.saturation]}
              onValueChange={([v]) =>
                updateImageAdjustment(selectedImage.id, 'saturation', v)
              }
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <Label className="text-[11px]">Blur</Label>
              <span className="text-[11px] text-muted-foreground font-mono">
                {selectedImage.blur}px
              </span>
            </div>
            <Slider
              min={0}
              max={10}
              step={1}
              value={[selectedImage.blur]}
              onValueChange={([v]) =>
                updateImageAdjustment(selectedImage.id, 'blur', v)
              }
            />
          </div>
        </div>

        {/* Color Filter Switches */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t text-xs">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-1.5">
              <Switch
                id={isMobile ? 'm-grayscale' : 'grayscale-toggle'}
                checked={selectedImage.grayscale}
                onCheckedChange={(v) =>
                  updateImageAdjustment(selectedImage.id, 'grayscale', v)
                }
              />
              <Label
                htmlFor={isMobile ? 'm-grayscale' : 'grayscale-toggle'}
                className="cursor-pointer text-[11px] sm:text-xs"
              >
                Grayscale
              </Label>
            </div>

            <div className="flex items-center gap-1.5">
              <Switch
                id={isMobile ? 'm-sepia' : 'sepia-toggle'}
                checked={selectedImage.sepia}
                onCheckedChange={(v) =>
                  updateImageAdjustment(selectedImage.id, 'sepia', v)
                }
              />
              <Label
                htmlFor={isMobile ? 'm-sepia' : 'sepia-toggle'}
                className="cursor-pointer text-[11px] sm:text-xs"
              >
                Sepia
              </Label>
            </div>

            <div className="flex items-center gap-1.5">
              <Switch
                id={isMobile ? 'm-invert' : 'invert-toggle'}
                checked={selectedImage.invert}
                onCheckedChange={(v) =>
                  updateImageAdjustment(selectedImage.id, 'invert', v)
                }
              />
              <Label
                htmlFor={isMobile ? 'm-invert' : 'invert-toggle'}
                className="cursor-pointer text-[11px] sm:text-xs"
              >
                Invert
              </Label>
            </div>
          </div>
        </div>

        {/* Apply filters to all button */}
        {images.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs font-medium border-primary/40 text-primary hover:bg-primary/10 mt-1"
            onClick={applyFiltersToAll}
          >
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Apply Filters to All Images ({images.length})
          </Button>
        )}

        {/* Mobile Quick Generate PDF Button */}
        {isMobile && (
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-9 text-xs font-medium mt-1"
            onClick={generatePdf}
            disabled={images.length === 0 || isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Generate & Download PDF
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  // PDF Settings Panel
  const renderPdfSettings = (isMobile: boolean) => {
    return (
      <div className="rounded-xl border bg-card p-3.5 sm:p-5 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 text-sm font-semibold border-b pb-2.5">
          <Settings2 className="h-4 w-4 text-primary" />
          <span>PDF Settings</span>
        </div>

        {/* Page Size */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Page Size</Label>
          <Select
            value={pageSize}
            onValueChange={(v) => setPageSize(v as PageSize)}
          >
            <SelectTrigger className="h-9 text-xs">
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
                onChange={(e) =>
                  setCustomWidth(Number(e.target.value) || 595)
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height (pt)</Label>
              <Input
                type="number"
                min={72}
                max={4000}
                value={customHeight}
                onChange={(e) =>
                  setCustomHeight(Number(e.target.value) || 842)
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        {/* Orientation */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Orientation</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOrientation('portrait')}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-2 text-xs font-medium transition-colors touch-manipulation',
                orientation === 'portrait'
                  ? 'border-primary bg-primary/10 text-primary font-semibold'
                  : 'border-muted hover:border-primary/50'
              )}
            >
              <div className="w-4 h-6 rounded-xs border-2 border-current" />
              Portrait
            </button>
            <button
              type="button"
              onClick={() => setOrientation('landscape')}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-2 text-xs font-medium transition-colors touch-manipulation',
                orientation === 'landscape'
                  ? 'border-primary bg-primary/10 text-primary font-semibold'
                  : 'border-muted hover:border-primary/50'
              )}
            >
              <div className="w-6 h-4 rounded-xs border-2 border-current" />
              Landscape
            </button>
          </div>
        </div>

        {/* Fit Mode */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Image Fit</Label>
          <Select
            value={fitMode}
            onValueChange={(v) => setFitMode(v as FitMode)}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fit">Fit to Page (Keep Aspect Ratio)</SelectItem>
              <SelectItem value="fill">Fill Page (Crop Overflow)</SelectItem>
              <SelectItem value="original">Original Proportions</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Margin */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs">Margin</Label>
            <span className="text-muted-foreground font-mono">{margin} pt</span>
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
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Background Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-9 h-9 rounded-md border cursor-pointer bg-transparent p-0.5"
            />
            <Input
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="flex-1 h-9 text-xs font-mono"
              maxLength={7}
            />
          </div>
        </div>

        {/* Image Quality */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs">Export Quality</Label>
            <span className="text-muted-foreground font-mono">
              {Math.round(quality * 100)}%
            </span>
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
          className="w-full bg-blue-600 hover:bg-blue-700 text-white h-10 mt-1"
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
      </div>
    );
  };

  // Added Images Thumbnail List
  const renderImagesList = (isMobile: boolean) => {
    return (
      <div className="space-y-3">
        {/* Header with image count and clear all */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs sm:text-sm font-semibold">
              {images.length} image{images.length !== 1 ? 's' : ''} added
            </p>
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              (Tap to select & edit)
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            className="h-7 text-xs text-destructive border-destructive/20 hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Clear All
          </Button>
        </div>

        {/* Thumbnails Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {images.map((img, index) => {
            const isSelected = img.id === selectedImage?.id;
            return (
              <div
                key={img.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, index)}
                onClick={() => {
                  setSelectedImageId(img.id);
                  if (isMobile) {
                    setMobileTab('edit');
                  }
                }}
                className={cn(
                  'group relative rounded-lg border bg-card overflow-hidden transition-all cursor-pointer select-none',
                  isSelected
                    ? 'ring-2 ring-primary border-primary shadow-xs bg-primary/5'
                    : 'hover:border-primary/50',
                  dragOverIndex === index && 'ring-2 ring-primary border-primary',
                  draggedIndex === index && 'opacity-50'
                )}
              >
                {/* Thumbnail Container */}
                <div className="aspect-square relative overflow-hidden bg-muted/40">
                  <img
                    src={img.dataUrl}
                    alt={img.file.name}
                    className="w-full h-full object-cover transition-transform"
                    style={{
                      filter: getFilterString(img),
                      transform: `rotate(${img.rotation}deg) scaleX(${
                        img.flipH ? -1 : 1
                      }) scaleY(${img.flipV ? -1 : 1})`,
                    }}
                  />

                  {/* Left reorder controls */}
                  <div className="absolute top-1 left-1 flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 bg-black/60 text-white hover:bg-black/80 hover:text-white p-0 rounded touch-manipulation"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveImage(index, 'left');
                      }}
                      title="Move Left"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <div className="bg-black/60 text-white rounded p-0.5 hidden sm:block opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 bg-black/60 text-white hover:bg-black/80 hover:text-white p-0 rounded touch-manipulation"
                      disabled={index === images.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveImage(index, 'right');
                      }}
                      title="Move Right"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Badges */}
                  <div className="absolute top-1 right-1 flex items-center gap-1">
                    {isSelected && (
                      <span className="text-[9px] sm:text-[10px] bg-primary text-primary-foreground font-semibold px-1 py-0.5 rounded shadow-xs">
                        Active
                      </span>
                    )}
                    <span className="text-[9px] sm:text-[10px] bg-black/70 text-white rounded px-1.5 py-0.5 font-medium">
                      #{index + 1}
                    </span>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="p-1.5 flex items-center justify-between gap-1 border-t bg-card text-xs">
                  <p className="text-[11px] font-medium text-foreground truncate flex-1">
                    {img.file.name}
                  </p>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCroppingImage(img);
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors touch-manipulation"
                      title="Crop Image"
                    >
                      <Crop className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        rotateImage(img.id, 90);
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                      title="Rotate 90°"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(img.id);
                      }}
                      className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors touch-manipulation"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add more files dropzone */}
        <div className="pt-2">
          <FileUploader
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            multiple
            maxFiles={50}
            maxSize={50 * 1024 * 1024}
            onFilesSelected={handleFilesSelected}
            label="Add More Images"
            description="Drag & drop or tap to browse"
            showFileList={false}
          />
        </div>

        {isMobile && (
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-10 mt-2"
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
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8 max-w-7xl">
      {/* Header (Desktop + Initial Mobile) */}
      <div className={cn('text-center mb-6 sm:mb-8', images.length > 0 && 'hidden sm:block')}>
        <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-500/10 mb-3 sm:mb-4">
          <FileImage className="h-7 w-7 sm:h-8 sm:w-8 text-blue-500" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Image to PDF</h1>
        <p className="text-muted-foreground mt-2 max-w-lg mx-auto text-xs sm:text-sm">
          Convert your images to a single PDF document. Select any image to crop,
          apply filters, and preview live page layout before generating.
        </p>
      </div>

      {/* Compact Mobile Top Bar when images are present */}
      {images.length > 0 && (
        <div className="sm:hidden flex items-center justify-between pb-2 mb-2 border-b">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-blue-500/10 text-blue-500">
              <FileImage className="h-4 w-4" />
            </div>
            <h1 className="text-sm font-bold leading-none">Image to PDF</h1>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {images.length} {images.length === 1 ? 'image' : 'images'}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-6 text-[11px] text-destructive hover:bg-destructive/10 px-2"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      {/* Main Workspace Content */}
      {images.length === 0 ? (
        <div className="max-w-xl mx-auto py-6">
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
        </div>
      ) : (
        <>
          {/* MOBILE VIEW (lg:hidden): Compact preview pinned at top with tab switcher */}
          <div className="lg:hidden space-y-3">
            {/* 1. Compact Live Page Preview (Always on top so it is visible with zero scroll!) */}
            {renderPreviewCard(true)}

            {/* 2. Mobile Mode Tab Bar */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-xl text-xs font-medium border shadow-xs">
              <button
                type="button"
                onClick={() => setMobileTab('edit')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all touch-manipulation',
                  mobileTab === 'edit'
                    ? 'bg-background text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Paintbrush className="h-3.5 w-3.5 text-blue-500" />
                <span className="truncate">Filters & Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('settings')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all touch-manipulation',
                  mobileTab === 'settings'
                    ? 'bg-background text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Settings2 className="h-3.5 w-3.5 text-blue-500" />
                <span className="truncate">PDF Settings</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('images')}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all touch-manipulation',
                  mobileTab === 'images'
                    ? 'bg-background text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <FileImage className="h-3.5 w-3.5 text-blue-500" />
                <span className="truncate">Images ({images.length})</span>
              </button>
            </div>

            {/* 3. Active Tab Content rendered directly beneath preview */}
            <div>
              {mobileTab === 'edit' && renderEditPanel(true)}
              {mobileTab === 'settings' && renderPdfSettings(true)}
              {mobileTab === 'images' && (
                <div className="rounded-xl border bg-card p-3 shadow-xs">
                  {renderImagesList(true)}
                </div>
              )}
            </div>
          </div>

          {/* DESKTOP VIEW (hidden lg:grid lg:grid-cols-12 gap-8) */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-8">
            {/* Left Column: Uploader, Images Grid, and Edit Selected Image */}
            <div className="lg:col-span-7 space-y-6">
              <FileUploader
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                multiple
                maxFiles={50}
                maxSize={50 * 1024 * 1024}
                onFilesSelected={handleFilesSelected}
                label="Add More Images"
                description="Drag & drop JPG, PNG, or WEBP images here"
                showFileList={false}
              />
              {renderImagesList(false)}
              {renderEditPanel(false)}
            </div>

            {/* Right Column: Live PDF Page Preview & Settings */}
            <div className="lg:col-span-5 space-y-6">
              {renderPreviewCard(false)}
              {renderPdfSettings(false)}
            </div>
          </div>
        </>
      )}

      {/* Interactive Crop Modal */}
      <ImageCropModal
        imageItem={croppingImage}
        onApplyCrop={handleApplyCrop}
        onClose={() => setCroppingImage(null)}
      />
    </div>
  );
}
