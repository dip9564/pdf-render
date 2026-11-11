import { useState, useCallback, useRef, useEffect } from 'react';
import { pdfjsLib } from '@/lib/pdfWorker';
import { PDFDocument } from 'pdf-lib';
import { toast } from 'sonner';
import {
  Type,
  Highlighter,
  PenTool,
  Square,
  Circle,
  MoveRight,
  FileSignature,
  MousePointer,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Bold,
  Italic,
  Bookmark,
  Plus,
  Upload,
  Eraser,
  Check,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

type ToolType = 'select' | 'text' | 'highlight' | 'pen' | 'rect' | 'circle' | 'arrow' | 'signature' | 'signature_stamp';

export interface SavedSignature {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}

interface Point {
  x: number;
  y: number;
}

interface Annotation {
  id: string;
  pageIndex: number;
  type: ToolType;
  color: string;
  strokeWidth: number;
  opacity?: number;
  points?: Point[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  fontSize?: number;
  isBold?: boolean;
  isItalic?: boolean;
  imageData?: string;
}

function getAnnotationBounds(
  ann: Annotation,
  ctx?: CanvasRenderingContext2D | null,
  extraPad = 0
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (ann.type === 'pen' || ann.type === 'signature') {
    if (!ann.points || ann.points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ann.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.max(8, (ann.strokeWidth || 3) + 2) + extraPad;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  if (ann.type === 'text') {
    const fs = ann.fontSize || 20;
    let textWidth = (ann.text?.length || 1) * fs * 0.65;
    if (ctx && ann.text) {
      ctx.save();
      let fontStyle = '';
      if (ann.isItalic) fontStyle += 'italic ';
      if (ann.isBold) fontStyle += 'bold ';
      ctx.font = `${fontStyle}${fs}px sans-serif`;
      textWidth = ctx.measureText(ann.text).width;
      ctx.restore();
    }
    const pad = 6 + extraPad;
    return {
      minX: (ann.x || 0) - pad,
      minY: (ann.y || 0) - fs - pad,
      maxX: (ann.x || 0) + textWidth + pad,
      maxY: (ann.y || 0) + pad,
    };
  }

  if (ann.type === 'rect' || ann.type === 'highlight' || ann.type === 'circle') {
    const x = ann.x || 0;
    const y = ann.y || 0;
    const w = ann.width || 0;
    const h = ann.height || 0;
    const pad = 6 + extraPad;
    return {
      minX: Math.min(x, x + w) - pad,
      minY: Math.min(y, y + h) - pad,
      maxX: Math.max(x, x + w) + pad,
      maxY: Math.max(y, y + h) + pad,
    };
  }

  if (ann.type === 'arrow') {
    const x1 = ann.x || 0;
    const y1 = ann.y || 0;
    const x2 = ann.endX || 0;
    const y2 = ann.endY || 0;
    const pad = 8 + extraPad;
    return {
      minX: Math.min(x1, x2) - pad,
      minY: Math.min(y1, y2) - pad,
      maxX: Math.max(x1, x2) + pad,
      maxY: Math.max(y1, y2) + pad,
    };
  }

  if (ann.type === 'signature_stamp') {
    const x = ann.x || 0;
    const y = ann.y || 0;
    const w = ann.width || 160;
    const h = ann.height || 80;
    const pad = 6 + extraPad;
    return {
      minX: x - pad,
      minY: y - pad,
      maxX: x + w + pad,
      maxY: y + h + pad,
    };
  }

  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function computeHighlightRect(
  start: Point,
  end: Point,
  strokeWidth: number
): { x: number; y: number; width: number; height: number } | null {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx < 4 && dy < 4) return null;

  const minBandHeight = Math.max(16, strokeWidth * 4);
  if (dx >= 6 && dy < minBandHeight * 0.5) {
    const centerY = (start.y + end.y) / 2;
    return {
      x: Math.min(start.x, end.x),
      y: centerY - minBandHeight / 2,
      width: dx,
      height: minBandHeight,
    };
  }

  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(4, dx),
    height: Math.max(4, dy),
  };
}

function drawAnnotationOnCanvas(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  imageCache?: Record<string, HTMLImageElement>,
  onAsyncImageLoad?: () => void
) {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (ann.opacity !== undefined) {
    ctx.globalAlpha = ann.opacity;
  }

  switch (ann.type) {
    case 'pen':
    case 'signature':
      if (ann.points && ann.points.length === 1) {
        ctx.beginPath();
        ctx.arc(ann.points[0].x, ann.points[0].y, Math.max(1, ann.strokeWidth / 2), 0, Math.PI * 2);
        ctx.fill();
      } else if (ann.points && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      }
      break;

    case 'highlight':
      if (
        ann.x !== undefined &&
        ann.y !== undefined &&
        ann.width !== undefined &&
        ann.height !== undefined &&
        ann.width > 0 &&
        ann.height > 0
      ) {
        ctx.globalAlpha = ann.opacity ?? 0.35;
        ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
      }
      break;

    case 'rect':
      if (
        ann.x !== undefined &&
        ann.y !== undefined &&
        ann.width !== undefined &&
        ann.height !== undefined &&
        ann.width > 0 &&
        ann.height > 0
      ) {
        ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
      }
      break;

    case 'circle':
      if (
        ann.x !== undefined &&
        ann.y !== undefined &&
        ann.width !== undefined &&
        ann.height !== undefined &&
        ann.width > 0 &&
        ann.height > 0
      ) {
        ctx.beginPath();
        const radiusX = Math.abs(ann.width) / 2;
        const radiusY = Math.abs(ann.height) / 2;
        const centerX = ann.x + ann.width / 2;
        const centerY = ann.y + ann.height / 2;
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
      }
      break;

    case 'arrow':
      if (
        ann.x !== undefined &&
        ann.y !== undefined &&
        ann.endX !== undefined &&
        ann.endY !== undefined
      ) {
        const dx = ann.endX - ann.x;
        const dy = ann.endY - ann.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          ctx.beginPath();
          ctx.moveTo(ann.x, ann.y);
          ctx.lineTo(ann.endX, ann.endY);
          ctx.stroke();

          const angle = Math.atan2(dy, dx);
          const headLength = Math.min(len * 0.45, Math.max(12, Math.min(26, 8 + (ann.strokeWidth || 3) * 2)));
          ctx.beginPath();
          ctx.moveTo(ann.endX, ann.endY);
          ctx.lineTo(
            ann.endX - headLength * Math.cos(angle - Math.PI / 6),
            ann.endY - headLength * Math.sin(angle - Math.PI / 6)
          );
          ctx.moveTo(ann.endX, ann.endY);
          ctx.lineTo(
            ann.endX - headLength * Math.cos(angle + Math.PI / 6),
            ann.endY - headLength * Math.sin(angle + Math.PI / 6)
          );
          ctx.stroke();
        }
      }
      break;

    case 'text':
      if (ann.x !== undefined && ann.y !== undefined && ann.text) {
        let fontStyle = '';
        if (ann.isItalic) fontStyle += 'italic ';
        if (ann.isBold) fontStyle += 'bold ';
        ctx.font = `${fontStyle}${ann.fontSize || 20}px sans-serif`;
        ctx.fillText(ann.text, ann.x, ann.y);
      }
      break;

    case 'signature_stamp':
      if (ann.imageData && ann.x !== undefined && ann.y !== undefined && imageCache) {
        const w = ann.width || 160;
        const h = ann.height || 80;
        let img = imageCache[ann.imageData];
        if (!img) {
          img = new Image();
          img.src = ann.imageData;
          imageCache[ann.imageData] = img;
          if (onAsyncImageLoad) {
            img.onload = onAsyncImageLoad;
          }
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, ann.x, ann.y, w, h);
        }
      }
      break;
  }

  ctx.restore();
}

export default function AnnotatePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);

  // Tool states
  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [strokeColor, setStrokeColor] = useState<string>('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(20);
  const [isBold, setIsBold] = useState<boolean>(false);
  const [isItalic, setIsItalic] = useState<boolean>(false);
  const [textInputVal, setTextInputVal] = useState<string>('Sample Text');

  // Annotation states
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [historyStep, setHistoryStep] = useState<number>(-1);

  // Selection & moving tracking
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDraggingSelected, setIsDraggingSelected] = useState<boolean>(false);

  // Synchronous interaction refs prevent stale React closures during fast touch/stylus sequences
  const activePointerIdRef = useRef<number | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const startPosRef = useRef<Point | null>(null);
  const currentPosRef = useRef<Point | null>(null);
  const currentPointsRef = useRef<Point[]>([]);
  const isDraggingSelectedRef = useRef<boolean>(false);
  const dragStartPointRef = useRef<Point | null>(null);
  const dragAnnotationStartRef = useRef<Annotation | null>(null);
  const historyRef = useRef<Annotation[][]>([]);
  const historyStepRef = useRef<number>(-1);
  const redrawCanvasRef = useRef<() => void>(() => {});

  // Signature Vault State
  const [isVaultOpen, setIsVaultOpen] = useState<boolean>(false);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>(() => {
    try {
      const saved = localStorage.getItem('pdf_saved_signatures');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const saveSignatureToStorage = (newSig: SavedSignature) => {
    setSavedSignatures((prev) => {
      const updated = [newSig, ...prev];
      try {
        localStorage.setItem('pdf_saved_signatures', JSON.stringify(updated));
      } catch (e) {
        console.error('Storage error', e);
      }
      return updated;
    });
  };

  const deleteSignatureFromStorage = (id: string) => {
    setSavedSignatures((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      try {
        localStorage.setItem('pdf_saved_signatures', JSON.stringify(updated));
      } catch (e) {
        console.error('Storage error', e);
      }
      return updated;
    });
    toast.info('Signature deleted from vault');
  };

  const handleInsertSignatureFromVault = (sigDataUrl: string) => {
    const canvas = canvasRef.current;
    const w = 170;
    const h = 85;
    const x = canvas ? Math.max(20, Math.round((canvas.width - w) / 2)) : 100;
    const y = canvas ? Math.max(20, Math.round((canvas.height - h) / 2)) : 100;

    const newAnn: Annotation = {
      id: `ann-${Date.now()}`,
      pageIndex: currentPage - 1,
      type: 'signature_stamp',
      color: '#1e3a8a',
      strokeWidth: 2,
      x,
      y,
      width: w,
      height: h,
      imageData: sigDataUrl,
    };

    addAnnotation(newAnn);
    setActiveTool('select');
    setSelectedId(newAnn.id);
    setIsVaultOpen(false);
    toast.success('Signature placed on document! Drag to reposition.');
  };
  const containerRef = useRef<HTMLDivElement>(null);

  const annotationsRef = useRef(annotations);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  const { renderAllPages, getPageCount } = usePdfRenderer();

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
        setCurrentPage(1);

        // Render full pages for canvas backgrounds
        const images = await renderAllPages(new Uint8Array(buffer.slice(0)), 1.5);
        setPageImages(images);
        annotationsRef.current = [];
        historyRef.current = [[]];
        historyStepRef.current = 0;
        setAnnotations([]);
        setHistory([[]]);
        setHistoryStep(0);
        setSelectedId(null);

        toast.success(`Loaded "${selectedFile.name}" with ${count} pages`);
      } catch (err) {
        console.error('Failed to load PDF', err);
        toast.error('Failed to parse PDF document');
        setFile(null);
        setPdfData(null);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount, renderAllPages]
  );

  // Push annotation and manage undo/redo history synchronously via refs
  const addAnnotation = useCallback((newAnn: Annotation) => {
    const nextAnnList = [...annotationsRef.current, newAnn];
    const nextHistory = historyRef.current.slice(0, historyStepRef.current + 1);
    nextHistory.push(nextAnnList);

    annotationsRef.current = nextAnnList;
    historyRef.current = nextHistory;
    historyStepRef.current = nextHistory.length - 1;

    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(nextAnnList);
  }, []);

  const handleUndo = () => {
    if (historyStepRef.current > 0) {
      const nextStep = historyStepRef.current - 1;
      const snapshot = historyRef.current[nextStep];
      historyStepRef.current = nextStep;
      annotationsRef.current = snapshot;
      setHistoryStep(nextStep);
      setAnnotations(snapshot);
    }
  };

  const handleRedo = () => {
    if (historyStepRef.current < historyRef.current.length - 1) {
      const nextStep = historyStepRef.current + 1;
      const snapshot = historyRef.current[nextStep];
      historyStepRef.current = nextStep;
      annotationsRef.current = snapshot;
      setHistoryStep(nextStep);
      setAnnotations(snapshot);
    }
  };

  const handleClearCurrentPage = () => {
    const remaining = annotationsRef.current.filter((a) => a.pageIndex !== currentPage - 1);
    const nextHistory = historyRef.current.slice(0, historyStepRef.current + 1);
    nextHistory.push(remaining);

    annotationsRef.current = remaining;
    historyRef.current = nextHistory;
    historyStepRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(remaining);
    setSelectedId(null);
    toast.success('Annotations on current page cleared');
  };

  // Canvas drawing & redraw (committed annotations + active live drag preview)
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageIdx = currentPage - 1;
    const pageAnns = annotationsRef.current.filter((a) => a.pageIndex === pageIdx);

    for (const ann of pageAnns) {
      drawAnnotationOnCanvas(ctx, ann, imageCacheRef.current, () => redrawCanvasRef.current());
    }

    // Draw live shape/stroke preview while actively drawing with pointer
    if (isDrawingRef.current && startPosRef.current) {
      const start = startPosRef.current;
      const cur = currentPosRef.current || start;
      let draft: Annotation | null = null;

      if (activeTool === 'pen' || activeTool === 'signature') {
        if (currentPointsRef.current.length > 0) {
          draft = {
            id: '__draft__',
            pageIndex: pageIdx,
            type: activeTool,
            color: strokeColor,
            strokeWidth,
            points: currentPointsRef.current,
          };
        }
      } else if (activeTool === 'highlight') {
        const box = computeHighlightRect(start, cur, strokeWidth);
        if (box) {
          draft = {
            id: '__draft__',
            pageIndex: pageIdx,
            type: 'highlight',
            color: strokeColor,
            strokeWidth,
            opacity: 0.35,
            ...box,
          };
        }
      } else if (activeTool === 'rect' || activeTool === 'circle') {
        const x = Math.min(start.x, cur.x);
        const y = Math.min(start.y, cur.y);
        const width = Math.abs(cur.x - start.x);
        const height = Math.abs(cur.y - start.y);
        if (width >= 1 || height >= 1) {
          draft = {
            id: '__draft__',
            pageIndex: pageIdx,
            type: activeTool,
            color: strokeColor,
            strokeWidth,
            x,
            y,
            width: Math.max(1, width),
            height: Math.max(1, height),
          };
        }
      } else if (activeTool === 'arrow') {
        if (Math.hypot(cur.x - start.x, cur.y - start.y) >= 2) {
          draft = {
            id: '__draft__',
            pageIndex: pageIdx,
            type: 'arrow',
            color: strokeColor,
            strokeWidth,
            x: start.x,
            y: start.y,
            endX: cur.x,
            endY: cur.y,
          };
        }
      }

      if (draft) {
        drawAnnotationOnCanvas(ctx, draft);
      }
    }

    // Draw selection bounding box if an annotation is selected
    if (selectedId) {
      const selectedAnn = pageAnns.find((a) => a.id === selectedId);
      if (selectedAnn) {
        const bounds = getAnnotationBounds(selectedAnn, ctx);
        const w = bounds.maxX - bounds.minX;
        const h = bounds.maxY - bounds.minY;

        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(bounds.minX, bounds.minY, w, h);

        // Draw 4 corner handle squares
        ctx.setLineDash([]);
        const hs = 7;
        const handles = [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.minX, y: bounds.maxY },
          { x: bounds.maxX, y: bounds.maxY },
        ];
        for (const hPoint of handles) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(hPoint.x - hs / 2, hPoint.y - hs / 2, hs, hs);
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hPoint.x - hs / 2, hPoint.y - hs / 2, hs, hs);
        }
        ctx.restore();
      }
    }
  }, [currentPage, annotations, selectedId, activeTool, strokeColor, strokeWidth]);

  redrawCanvasRef.current = redrawCanvas;

  // Initialize canvas internal dimensions ONLY when page image changes (avoid wiping bitmap mid-stroke!)
  useEffect(() => {
    const canvas = canvasRef.current;
    const src = pageImages[currentPage - 1];
    if (!canvas || !src) return;

    let cancelled = false;
    const img = new Image();
    const applySize = () => {
      if (cancelled || !canvasRef.current) return;
      canvasRef.current.width = img.width;
      canvasRef.current.height = img.height;
      redrawCanvasRef.current();
    };

    img.onload = applySize;
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      applySize();
    }

    return () => {
      cancelled = true;
    };
  }, [currentPage, pageImages]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Delete currently selected annotation
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    const remaining = annotationsRef.current.filter((a) => a.id !== selectedId);
    const nextHistory = historyRef.current.slice(0, historyStepRef.current + 1);
    nextHistory.push(remaining);
    annotationsRef.current = remaining;
    historyRef.current = nextHistory;
    historyStepRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(remaining);
    setSelectedId(null);
    toast.success('Annotation removed');
  }, [selectedId]);

  // Keyboard shortcut to delete selected annotation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          return;
        }
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, handleDeleteSelected]);

  // Unified pointer-to-PDF-canvas coordinate mapper (works across screen sizes, zoom levels, scroll offsets & DPR)
  const getCoordinatesFromClient = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const rawX = (clientX - rect.left) * scaleX;
    const rawY = (clientY - rect.top) * scaleY;
    return {
      x: Math.max(0, Math.min(canvas.width, rawX)),
      y: Math.max(0, Math.min(canvas.height, rawY)),
    };
  };

  const handleStartAt = (pos: Point) => {
    if (activeTool === 'select') {
      const pageIdx = currentPage - 1;
      const pageAnns = annotationsRef.current.filter((a) => a.pageIndex === pageIdx);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');

      let hit: Annotation | null = null;
      for (let i = pageAnns.length - 1; i >= 0; i--) {
        const ann = pageAnns[i];
        const bounds = getAnnotationBounds(ann, ctx, 14);
        if (
          pos.x >= bounds.minX &&
          pos.x <= bounds.maxX &&
          pos.y >= bounds.minY &&
          pos.y <= bounds.maxY
        ) {
          hit = ann;
          break;
        }
      }

      if (hit) {
        setSelectedId(hit.id);
        isDraggingSelectedRef.current = true;
        setIsDraggingSelected(true);
        dragStartPointRef.current = pos;
        dragAnnotationStartRef.current = JSON.parse(JSON.stringify(hit));
      } else {
        setSelectedId(null);
        isDraggingSelectedRef.current = false;
        setIsDraggingSelected(false);
        dragStartPointRef.current = null;
        dragAnnotationStartRef.current = null;
      }
      return;
    }

    if (activeTool === 'text') {
      addAnnotation({
        id: `ann-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'text',
        color: strokeColor,
        strokeWidth,
        x: pos.x,
        y: pos.y,
        text: textInputVal,
        fontSize,
        isBold,
        isItalic,
      });
      isDrawingRef.current = false;
      startPosRef.current = null;
      currentPosRef.current = null;
      return;
    }

    isDrawingRef.current = true;
    startPosRef.current = pos;
    currentPosRef.current = pos;

    if (activeTool === 'pen' || activeTool === 'signature') {
      currentPointsRef.current = [pos];
    } else {
      currentPointsRef.current = [];
    }

    redrawCanvasRef.current();
  };

  const handleMoveAt = (pos: Point) => {
    if (activeTool === 'select') {
      if (isDraggingSelectedRef.current && dragStartPointRef.current && dragAnnotationStartRef.current) {
        const startPt = dragStartPointRef.current;
        const baseAnn = dragAnnotationStartRef.current;
        const dx = pos.x - startPt.x;
        const dy = pos.y - startPt.y;

        const updated: Annotation = { ...baseAnn };

        if (baseAnn.type === 'pen' || baseAnn.type === 'signature') {
          updated.points = baseAnn.points?.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
        } else if (baseAnn.type === 'arrow') {
          updated.x = (baseAnn.x ?? 0) + dx;
          updated.y = (baseAnn.y ?? 0) + dy;
          updated.endX = (baseAnn.endX ?? 0) + dx;
          updated.endY = (baseAnn.endY ?? 0) + dy;
        } else {
          updated.x = (baseAnn.x ?? 0) + dx;
          updated.y = (baseAnn.y ?? 0) + dy;
        }

        const nextList = annotationsRef.current.map((a) => (a.id === baseAnn.id ? updated : a));
        annotationsRef.current = nextList;
        setAnnotations(nextList);
        redrawCanvasRef.current();
      }
      return;
    }

    if (!isDrawingRef.current || !startPosRef.current) return;

    currentPosRef.current = pos;
    if (activeTool === 'pen' || activeTool === 'signature') {
      currentPointsRef.current = [...currentPointsRef.current, pos];
    }

    redrawCanvasRef.current();
  };

  const cancelActiveInteraction = () => {
    if (isDraggingSelectedRef.current && dragAnnotationStartRef.current) {
      const original = dragAnnotationStartRef.current;
      const restored = annotationsRef.current.map((a) => (a.id === original.id ? original : a));
      annotationsRef.current = restored;
      setAnnotations(restored);
    }
    isDraggingSelectedRef.current = false;
    dragStartPointRef.current = null;
    dragAnnotationStartRef.current = null;
    setIsDraggingSelected(false);

    isDrawingRef.current = false;
    startPosRef.current = null;
    currentPosRef.current = null;
    currentPointsRef.current = [];
    redrawCanvasRef.current();
  };

  const handleEndAt = (pos: Point) => {
    if (activeTool === 'select') {
      if (isDraggingSelectedRef.current && dragStartPointRef.current && dragAnnotationStartRef.current) {
        const currentAnns = annotationsRef.current;
        const nextHistory = historyRef.current.slice(0, historyStepRef.current + 1);
        nextHistory.push(currentAnns);
        historyRef.current = nextHistory;
        historyStepRef.current = nextHistory.length - 1;
        setHistory(nextHistory);
        setHistoryStep(nextHistory.length - 1);
      }
      isDraggingSelectedRef.current = false;
      dragStartPointRef.current = null;
      dragAnnotationStartRef.current = null;
      setIsDraggingSelected(false);
      return;
    }

    const start = startPosRef.current;
    if (!isDrawingRef.current || !start) return;

    const finalPos = pos || currentPosRef.current || start;
    const drawnPoints =
      currentPointsRef.current.length > 0 ? [...currentPointsRef.current, finalPos] : [start, finalPos];

    isDrawingRef.current = false;
    startPosRef.current = null;
    currentPosRef.current = null;
    currentPointsRef.current = [];

    if (activeTool === 'pen' || activeTool === 'signature') {
      if (drawnPoints.length >= 2) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: activeTool,
          color: strokeColor,
          strokeWidth,
          points: drawnPoints,
        });
      }
    } else if (activeTool === 'highlight') {
      const box = computeHighlightRect(start, finalPos, strokeWidth);
      if (box) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'highlight',
          color: strokeColor,
          strokeWidth,
          opacity: 0.35,
          ...box,
        });
      } else {
        redrawCanvasRef.current();
      }
    } else if (activeTool === 'rect' || activeTool === 'circle') {
      const x = Math.min(start.x, finalPos.x);
      const y = Math.min(start.y, finalPos.y);
      const width = Math.abs(finalPos.x - start.x);
      const height = Math.abs(finalPos.y - start.y);

      if (width >= 3 && height >= 3) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: activeTool,
          color: strokeColor,
          strokeWidth,
          x,
          y,
          width,
          height,
        });
      } else {
        redrawCanvasRef.current();
      }
    } else if (activeTool === 'arrow') {
      const dist = Math.hypot(finalPos.x - start.x, finalPos.y - start.y);
      if (dist >= 4) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'arrow',
          color: strokeColor,
          strokeWidth,
          x: start.x,
          y: start.y,
          endX: finalPos.x,
          endY: finalPos.y,
        });
      } else {
        redrawCanvasRef.current();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activePointerIdRef.current !== null) return;
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events in automated browsers may skip pointer capture
    }
    const pos = getCoordinatesFromClient(e.clientX, e.clientY);
    handleStartAt(pos);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    if (!isDrawingRef.current && !isDraggingSelectedRef.current) return;
    e.preventDefault();

    if (
      (activeTool === 'pen' || activeTool === 'signature') &&
      typeof e.nativeEvent.getCoalescedEvents === 'function'
    ) {
      const coalesced = e.nativeEvent.getCoalescedEvents();
      if (coalesced.length > 0) {
        for (const ce of coalesced) {
          handleMoveAt(getCoordinatesFromClient(ce.clientX, ce.clientY));
        }
        return;
      }
    }

    const pos = getCoordinatesFromClient(e.clientX, e.clientY);
    handleMoveAt(pos);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    const pos = getCoordinatesFromClient(e.clientX, e.clientY);
    handleEndAt(pos);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    cancelActiveInteraction();
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    const fallbackPos = currentPosRef.current || startPosRef.current;
    if (fallbackPos) {
      handleEndAt(fallbackPos);
    } else {
      cancelActiveInteraction();
    }
  };

  // Export baked PDF
  const handleExportAnnotatedPdf = async () => {
    if (!file || pageImages.length === 0) return;

    setProcessing(true);
    try {
      const newPdf = await PDFDocument.create();

      for (let pIdx = 0; pIdx < pageImages.length; pIdx++) {
        const bgImgData = pageImages[pIdx];
        const pageAnns = annotations.filter((a) => a.pageIndex === pIdx);

        // Render combined canvas
        const offCanvas = document.createElement('canvas');
        const img = new Image();
        img.src = bgImgData;
        await new Promise((res) => (img.onload = res));

        offCanvas.width = img.width;
        offCanvas.height = img.height;
        const ctx = offCanvas.getContext('2d')!;

        // Draw page image
        ctx.drawImage(img, 0, 0);

        // Draw annotations using the exact shared canvas renderer
        for (const ann of pageAnns) {
          if (ann.type === 'signature_stamp' && ann.imageData && ann.x !== undefined && ann.y !== undefined) {
            const stampImg = new Image();
            stampImg.src = ann.imageData;
            await new Promise((res) => {
              if (stampImg.complete) res(null);
              else {
                stampImg.onload = () => res(null);
                stampImg.onerror = () => res(null);
              }
            });
            drawAnnotationOnCanvas(ctx, ann, { [ann.imageData]: stampImg });
          } else {
            drawAnnotationOnCanvas(ctx, ann);
          }
        }

        const pagePngData = offCanvas.toDataURL('image/png');
        const embeddedPng = await newPdf.embedPng(pagePngData);
        const page = newPdf.addPage([img.width, img.height]);
        page.drawImage(embeddedPng, {
          x: 0,
          y: 0,
          width: img.width,
          height: img.height,
        });
      }

      const pdfBytes = await newPdf.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-annotated.pdf`);
      toast.success('Annotated PDF downloaded successfully!');
    } catch (err) {
      console.error('Failed to export annotated PDF', err);
      toast.error('Failed to export document');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setPageImages([]);
    annotationsRef.current = [];
    historyRef.current = [];
    historyStepRef.current = -1;
    setAnnotations([]);
    setHistory([]);
    setHistoryStep(-1);
    setSelectedId(null);
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 py-5 sm:py-8 max-w-6xl">
      <div className="mb-5 sm:mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Type className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Annotate PDF</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Add freehand drawings, highlights, text, geometric shapes, arrows, and signatures to any PDF page.
        </p>
      </div>

      {!file ? (
        <Card>
          <CardContent className="p-5 sm:p-7">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file to annotate"
              description="Freehand drawing, highlight, signatures, and text notes"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Top Control Bar */}
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3">
              {/* Pagination */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-semibold px-2">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Tools Selector */}
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border overflow-x-auto max-w-full scrollbar-none shrink-0 touch-manipulation">
                <Button
                  variant={activeTool === 'select' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs font-medium shrink-0 whitespace-nowrap"
                  onClick={() => setActiveTool('select')}
                  title="Select & move text, signatures, or shapes"
                >
                  <MousePointer className="h-3.5 w-3.5 mr-1 text-current" />
                  Select / Move
                </Button>
                <Button
                  variant={activeTool === 'pen' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('pen');
                    setSelectedId(null);
                  }}
                >
                  <PenTool className="h-3.5 w-3.5 mr-1" />
                  Pen
                </Button>
                <Button
                  variant={activeTool === 'highlight' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('highlight');
                    setSelectedId(null);
                    setStrokeColor('#fef08a'); // soft yellow default
                  }}
                >
                  <Highlighter className="h-3.5 w-3.5 mr-1" />
                  Highlight
                </Button>
                <Button
                  variant={activeTool === 'text' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('text');
                    setSelectedId(null);
                  }}
                >
                  <Type className="h-3.5 w-3.5 mr-1" />
                  Text
                </Button>
                <Button
                  variant={activeTool === 'rect' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('rect');
                    setSelectedId(null);
                  }}
                >
                  <Square className="h-3.5 w-3.5 mr-1" />
                  Box
                </Button>
                <Button
                  variant={activeTool === 'circle' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('circle');
                    setSelectedId(null);
                  }}
                >
                  <Circle className="h-3.5 w-3.5 mr-1" />
                  Circle
                </Button>
                <Button
                  variant={activeTool === 'arrow' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('arrow');
                    setSelectedId(null);
                  }}
                >
                  <MoveRight className="h-3.5 w-3.5 mr-1" />
                  Arrow
                </Button>
                <Button
                  variant={activeTool === 'signature' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setActiveTool('signature');
                    setSelectedId(null);
                    setStrokeColor('#1e3a8a'); // navy default
                  }}
                >
                  <FileSignature className="h-3.5 w-3.5 mr-1" />
                  Sign
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs border-indigo-500/30 text-indigo-600 dark:text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 shrink-0"
                  onClick={() => setIsVaultOpen(true)}
                  title="Open Saved Signature Vault"
                >
                  <Bookmark className="h-3.5 w-3.5 mr-1" />
                  Vault {savedSignatures.length > 0 && `(${savedSignatures.length})`}
                </Button>
              </div>

              {/* Undo / Redo / Clear / Export */}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleUndo}
                  disabled={historyStep <= 0}
                  title="Undo"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleRedo}
                  disabled={historyStep >= history.length - 1}
                  title="Redo"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={handleClearCurrentPage}
                  title="Clear Current Page"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  className="h-8 ml-2"
                  onClick={handleExportAnnotatedPdf}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Export PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tool Property Ribbon */}
          <div className="flex flex-wrap items-center gap-3 px-3 sm:px-4 py-2 bg-muted/40 rounded-lg text-xs border">
            {activeTool === 'select' ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant="outline"
                    className="shrink-0 whitespace-nowrap text-xs py-1 px-2.5 bg-primary/10 text-primary border-primary/20 flex items-center gap-1.5"
                  >
                    <MousePointer className="h-3.5 w-3.5 shrink-0" />
                    <span>Select & Move</span>
                  </Badge>
                  <p className="text-xs text-muted-foreground truncate sm:whitespace-normal">
                    {selectedId ? (
                      <span className="text-foreground font-medium">
                        Item selected • Drag to reposition
                      </span>
                    ) : (
                      'Tap any element on page to select & move'
                    )}
                  </p>
                </div>
                {selectedId && (
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto touch-manipulation">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs px-3 min-h-[34px]"
                      onClick={() => setSelectedId(null)}
                    >
                      Deselect
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs px-3 min-h-[34px] font-medium"
                      onClick={handleDeleteSelected}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete Selected
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Color Picker */}
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground">Color:</span>
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                    className="w-6 h-6 rounded border cursor-pointer bg-background"
                  />
                </div>

                {/* Stroke Width Slider */}
                {activeTool !== 'text' && (
                  <div className="flex items-center gap-2 w-36">
                    <span className="font-medium text-muted-foreground whitespace-nowrap">
                      Size: {strokeWidth}px
                    </span>
                    <Slider
                      value={[strokeWidth]}
                      min={1}
                      max={20}
                      step={1}
                      onValueChange={([val]) => setStrokeWidth(val)}
                    />
                  </div>
                )}

                {/* Text options */}
                {activeTool === 'text' && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-muted-foreground">Text:</span>
                      <Input
                        value={textInputVal}
                        onChange={(e) => setTextInputVal(e.target.value)}
                        className="h-7 text-xs w-36"
                        placeholder="Enter text"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 w-32">
                      <span className="font-medium text-muted-foreground">Font:</span>
                      <Slider
                        value={[fontSize]}
                        min={12}
                        max={60}
                        step={2}
                        onValueChange={([val]) => setFontSize(val)}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant={isBold ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setIsBold(!isBold)}
                      >
                        <Bold className="h-3 w-3" />
                      </Button>
                      <Button
                        variant={isItalic ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setIsItalic(!isItalic)}
                      >
                        <Italic className="h-3 w-3" />
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Interactive Workspace Canvas */}
          <div
            ref={containerRef}
            className="flex justify-center items-center bg-muted/30 border rounded-xl p-2 sm:p-4 overflow-auto min-h-[340px] sm:min-h-[500px]"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">Preparing high-resolution canvas...</p>
              </div>
            ) : pageImages[currentPage - 1] ? (
              <div
                className="relative shadow-lg border rounded bg-white overflow-hidden"
                style={{
                  backgroundImage: `url(${pageImages[currentPage - 1]})`,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onLostPointerCapture={handleLostPointerCapture}
                  style={{
                    touchAction: 'none',
                    cursor:
                      activeTool === 'select'
                        ? isDraggingSelected
                          ? 'grabbing'
                          : selectedId
                          ? 'move'
                          : 'default'
                        : 'crosshair',
                  }}
                  className="block max-w-full h-auto select-none"
                />
              </div>
            ) : (
              <div className="text-muted-foreground">No page loaded</div>
            )}
          </div>
        </div>
      )}

      {/* Signature Vault Modal */}
      <SignatureVaultModal
        open={isVaultOpen}
        onOpenChange={setIsVaultOpen}
        onInsertSignature={handleInsertSignatureFromVault}
        savedSignatures={savedSignatures}
        onSaveSignature={saveSignatureToStorage}
        onDeleteSignature={deleteSignatureFromStorage}
      />
    </div>
  );
}

interface SignatureVaultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsertSignature: (dataUrl: string) => void;
  savedSignatures: SavedSignature[];
  onSaveSignature: (sig: SavedSignature) => void;
  onDeleteSignature: (id: string) => void;
}

function SignatureVaultModal({
  open,
  onOpenChange,
  onInsertSignature,
  savedSignatures,
  onSaveSignature,
  onDeleteSignature,
}: SignatureVaultModalProps) {
  const [tab, setTab] = useState<'saved' | 'draw' | 'upload'>('saved');
  const [sigName, setSigName] = useState<string>('My Signature');
  const [inkColor, setInkColor] = useState<string>('#0f172a');
  const padRef = useRef<HTMLCanvasElement>(null);
  const padDrawingRef = useRef<boolean>(false);
  const padPointerIdRef = useRef<number | null>(null);
  const [padHasStrokes, setPadHasStrokes] = useState<boolean>(false);

  // Setup drawing canvas
  useEffect(() => {
    if (tab === 'draw' && padRef.current) {
      const canvas = padRef.current;
      canvas.width = 460;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setPadHasStrokes(false);
    }
  }, [tab, open]);

  const clearPad = () => {
    const canvas = padRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPadHasStrokes(false);
  };

  const getPadCoordinates = (clientX: number, clientY: number) => {
    const canvas = padRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY)),
    };
  };

  const handlePadPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (padPointerIdRef.current !== null) return;
    e.preventDefault();
    const canvas = padRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    padPointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events
    }

    const pos = getPadCoordinates(e.clientX, e.clientY);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    padDrawingRef.current = true;
    setPadHasStrokes(true);
  };

  const handlePadPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (padPointerIdRef.current !== e.pointerId || !padDrawingRef.current) return;
    e.preventDefault();
    const canvas = padRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPadCoordinates(e.clientX, e.clientY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const handlePadPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (padPointerIdRef.current !== e.pointerId) return;
    padPointerIdRef.current = null;
    padDrawingRef.current = false;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
  };

  const handleSaveAndUseDrawn = () => {
    const canvas = padRef.current;
    if (!canvas || !padHasStrokes) {
      toast.warning('Please draw your signature first');
      return;
    }

    const dataUrl = canvas.toDataURL('image/png');
    const newSig: SavedSignature = {
      id: `sig-${Date.now()}`,
      name: sigName.trim() || 'My Signature',
      dataUrl,
      createdAt: Date.now(),
    };

    onSaveSignature(newSig);
    onInsertSignature(dataUrl);
    toast.success('Signature saved to vault and dropped onto document!');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Convert white background to transparent
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, off.width, off.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          if (r > 215 && g > 215 && b > 215) {
            d[i + 3] = 0; // make white transparent
          }
        }
        ctx.putImageData(imgData, 0, 0);

        const transparentDataUrl = off.toDataURL('image/png');
        const newSig: SavedSignature = {
          id: `sig-${Date.now()}`,
          name: sigName.trim() || file.name.replace(/\.[^/.]+$/, ''),
          dataUrl: transparentDataUrl,
          createdAt: Date.now(),
        };

        onSaveSignature(newSig);
        onInsertSignature(transparentDataUrl);
        toast.success('Signature image saved & placed on document!');
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-indigo-500" />
            <DialogTitle className="text-base sm:text-lg">Signature Vault</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Save reusable signatures once. Insert onto any page with one tap.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-lg text-xs font-medium mb-3 border border-border/70">
          <button
            type="button"
            onClick={() => setTab('saved')}
            className={cn(
              'py-1.5 rounded-md transition-colors text-center',
              tab === 'saved' ? 'bg-card text-foreground shadow-xs font-semibold' : 'text-muted-foreground'
            )}
          >
            Vault ({savedSignatures.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('draw')}
            className={cn(
              'py-1.5 rounded-md transition-colors text-center',
              tab === 'draw' ? 'bg-card text-foreground shadow-xs font-semibold' : 'text-muted-foreground'
            )}
          >
            Draw New
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={cn(
              'py-1.5 rounded-md transition-colors text-center',
              tab === 'upload' ? 'bg-card text-foreground shadow-xs font-semibold' : 'text-muted-foreground'
            )}
          >
            Upload
          </button>
        </div>

        {tab === 'saved' && (
          <div className="space-y-3">
            {savedSignatures.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground space-y-2 border border-dashed rounded-lg">
                <Bookmark className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <p className="text-xs font-medium">No saved signatures yet</p>
                <p className="text-[11px] text-muted-foreground px-4">
                  Draw or upload your signature to save it securely in your browser vault.
                </p>
                <Button size="sm" variant="outline" onClick={() => setTab('draw')} className="h-7 text-xs">
                  Draw Signature Now
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {savedSignatures.map((sig) => (
                  <div
                    key={sig.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:border-indigo-500/40 transition-all gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-16 h-10 border rounded bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
                        <img src={sig.dataUrl} alt={sig.name} className="w-full h-full object-contain" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{sig.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(sig.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => onInsertSignature(sig.dataUrl)}
                        className="h-7 text-xs px-2.5"
                      >
                        Drop on PDF
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDeleteSignature(sig.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'draw' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label className="text-xs">Signature Name</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Ink:</span>
                  {[
                    { color: '#0f172a', title: 'Black' },
                    { color: '#1e3a8a', title: 'Navy' },
                    { color: '#2563eb', title: 'Blue' },
                    { color: '#b91c1c', title: 'Red' },
                  ].map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      onClick={() => setInkColor(c.color)}
                      style={{ backgroundColor: c.color }}
                      className={cn(
                        'w-4 h-4 rounded-full border transition-all',
                        inkColor === c.color ? 'ring-2 ring-primary ring-offset-1 scale-110' : ''
                      )}
                      title={c.title}
                    />
                  ))}
                </div>
              </div>
              <Input
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
                placeholder="e.g. Primary Signature"
                className="h-8 text-xs"
              />
            </div>

            {/* Drawing Pad Canvas */}
            <div className="border-2 border-dashed border-border rounded-lg bg-white overflow-hidden relative shadow-xs">
              <canvas
                ref={padRef}
                onPointerDown={handlePadPointerDown}
                onPointerMove={handlePadPointerMove}
                onPointerUp={handlePadPointerEnd}
                onPointerCancel={handlePadPointerEnd}
                onLostPointerCapture={handlePadPointerEnd}
                style={{ touchAction: 'none' }}
                className="w-full h-36 block select-none cursor-crosshair touch-none"
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={clearPad}
                  className="h-6 text-[10px] px-2 bg-white/95 text-slate-900 border-slate-300 hover:bg-slate-100 shadow-xs"
                >
                  <Eraser className="h-3 w-3 mr-1" />
                  Clear Pad
                </Button>
              </div>
              {!padHasStrokes && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400 text-xs">
                  Sign with finger or stylus here
                </div>
              )}
            </div>

            <Button
              type="button"
              onClick={handleSaveAndUseDrawn}
              disabled={!padHasStrokes}
              className="w-full h-9 text-xs"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Save to Vault & Drop on PDF
            </Button>
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Signature Name</Label>
              <Input
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
                placeholder="e.g. Scanned Signature"
                className="h-8 text-xs"
              />
            </div>

            <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-2 bg-muted/10">
              <Upload className="h-8 w-8 mx-auto text-indigo-500" />
              <p className="text-xs font-medium">Upload photo or scan of signature</p>
              <p className="text-[10px] text-muted-foreground">
                Automatic white-background removal makes it look like real transparent ink.
              </p>
              <label className="inline-block cursor-pointer">
                <span className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                  Select PNG or JPG
                </span>
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/jpg"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
