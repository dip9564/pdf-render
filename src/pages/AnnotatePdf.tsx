import { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
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
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

type ToolType = 'select' | 'text' | 'highlight' | 'pen' | 'rect' | 'circle' | 'arrow' | 'signature';

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

  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
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

  // Drawing tracking
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPos, setStartPos] = useState<Point | null>(null);

  // Selection & moving tracking
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDraggingSelected, setIsDraggingSelected] = useState<boolean>(false);
  const [dragStartPoint, setDragStartPoint] = useState<Point | null>(null);
  const [dragAnnotationStart, setDragAnnotationStart] = useState<Annotation | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
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
        setAnnotations([]);
        setHistory([[]]);
        setHistoryStep(0);

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

  // Push annotation and manage undo/redo history
  const addAnnotation = (newAnn: Annotation) => {
    const nextAnnList = [...annotations, newAnn];
    const nextHistory = history.slice(0, historyStep + 1);
    nextHistory.push(nextAnnList);

    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(nextAnnList);
  };

  const handleUndo = () => {
    if (historyStep > 0) {
      const nextStep = historyStep - 1;
      setHistoryStep(nextStep);
      setAnnotations(history[nextStep]);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      const nextStep = historyStep + 1;
      setHistoryStep(nextStep);
      setAnnotations(history[nextStep]);
    }
  };

  const handleClearCurrentPage = () => {
    const remaining = annotations.filter((a) => a.pageIndex !== currentPage - 1);
    const nextHistory = history.slice(0, historyStep + 1);
    nextHistory.push(remaining);

    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(remaining);
    toast.success('Annotations on current page cleared');
  };

  // Canvas drawing & redraw
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageIdx = currentPage - 1;
    const pageAnns = annotations.filter((a) => a.pageIndex === pageIdx);

    for (const ann of pageAnns) {
      ctx.save();
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (ann.opacity) ctx.globalAlpha = ann.opacity;

      switch (ann.type) {
        case 'pen':
        case 'signature':
          if (ann.points && ann.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(ann.points[0].x, ann.points[0].y);
            for (let i = 1; i < ann.points.length; i++) {
              ctx.lineTo(ann.points[i].x, ann.points[i].y);
            }
            ctx.stroke();
          }
          break;

        case 'highlight':
          if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
            ctx.globalAlpha = 0.35;
            ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
          }
          break;

        case 'rect':
          if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
            ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
          }
          break;

        case 'circle':
          if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
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
            ctx.beginPath();
            ctx.moveTo(ann.x, ann.y);
            ctx.lineTo(ann.endX, ann.endY);
            ctx.stroke();

            // Arrow head
            const angle = Math.atan2(ann.endY - ann.y, ann.endX - ann.x);
            const headLength = 14;
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
      }

      ctx.restore();
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
  }, [currentPage, annotations, selectedId]);

  // Adjust canvas size to match current page image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageImages[currentPage - 1]) return;

    const img = new Image();
    img.src = pageImages[currentPage - 1];
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      redrawCanvas();
    };
  }, [currentPage, pageImages, redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Delete currently selected annotation
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    const remaining = annotations.filter((a) => a.id !== selectedId);
    const nextHistory = history.slice(0, historyStep + 1);
    nextHistory.push(remaining);
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
    setAnnotations(remaining);
    setSelectedId(null);
    toast.success('Annotation removed');
  }, [selectedId, annotations, history, historyStep]);

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

  // Mouse & Touch coordinate helper
  const getCoordinatesFromClient = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    return getCoordinatesFromClient(e.clientX, e.clientY);
  };

  const handleStartAt = (pos: Point) => {
    if (activeTool === 'select') {
      const pageIdx = currentPage - 1;
      const pageAnns = annotations.filter((a) => a.pageIndex === pageIdx);
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
        setIsDraggingSelected(true);
        setDragStartPoint(pos);
        setDragAnnotationStart(JSON.parse(JSON.stringify(hit)));
      } else {
        setSelectedId(null);
        setIsDraggingSelected(false);
        setDragStartPoint(null);
        setDragAnnotationStart(null);
      }
      return;
    }

    setIsDrawing(true);
    setStartPos(pos);

    if (activeTool === 'pen' || activeTool === 'signature') {
      setCurrentPoints([pos]);
    } else if (activeTool === 'text') {
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
      setIsDrawing(false);
    }
  };

  const handleMoveAt = (pos: Point) => {
    if (activeTool === 'select') {
      if (isDraggingSelected && dragStartPoint && dragAnnotationStart) {
        const dx = pos.x - dragStartPoint.x;
        const dy = pos.y - dragStartPoint.y;

        let updated: Annotation = { ...dragAnnotationStart };

        if (dragAnnotationStart.type === 'pen' || dragAnnotationStart.type === 'signature') {
          updated.points = dragAnnotationStart.points?.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
        } else if (dragAnnotationStart.type === 'arrow') {
          updated.x = (dragAnnotationStart.x ?? 0) + dx;
          updated.y = (dragAnnotationStart.y ?? 0) + dy;
          updated.endX = (dragAnnotationStart.endX ?? 0) + dx;
          updated.endY = (dragAnnotationStart.endY ?? 0) + dy;
        } else {
          updated.x = (dragAnnotationStart.x ?? 0) + dx;
          updated.y = (dragAnnotationStart.y ?? 0) + dy;
        }

        setAnnotations((prev) =>
          prev.map((a) => (a.id === dragAnnotationStart.id ? updated : a))
        );
      }
      return;
    }

    if (!isDrawing) return;

    if (activeTool === 'pen' || activeTool === 'signature') {
      setCurrentPoints((prev) => {
        const next = [...prev, pos];
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx && next.length > 1) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(next[next.length - 2].x, next[next.length - 2].y);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
          }
        }
        return next;
      });
    }
  };

  const handleEndAt = (pos: Point) => {
    if (activeTool === 'select') {
      if (isDraggingSelected && dragStartPoint && dragAnnotationStart) {
        const currentAnns = annotationsRef.current;
        const nextHistory = history.slice(0, historyStep + 1);
        nextHistory.push(currentAnns);
        setHistory(nextHistory);
        setHistoryStep(nextHistory.length - 1);
      }
      setIsDraggingSelected(false);
      setDragStartPoint(null);
      setDragAnnotationStart(null);
      return;
    }

    if (!isDrawing || !startPos) return;
    setIsDrawing(false);

    if (activeTool === 'pen' || activeTool === 'signature') {
      if (currentPoints.length > 0) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: activeTool,
          color: strokeColor,
          strokeWidth,
          points: currentPoints,
        });
      }
      setCurrentPoints([]);
    } else if (activeTool === 'highlight' || activeTool === 'rect') {
      const x = Math.min(startPos.x, pos.x);
      const y = Math.min(startPos.y, pos.y);
      const width = Math.abs(pos.x - startPos.x);
      const height = Math.abs(pos.y - startPos.y);

      if (width > 3 && height > 3) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: activeTool,
          color: strokeColor,
          strokeWidth,
          opacity: activeTool === 'highlight' ? 0.35 : 1.0,
          x,
          y,
          width,
          height,
        });
      }
    } else if (activeTool === 'circle') {
      const x = Math.min(startPos.x, pos.x);
      const y = Math.min(startPos.y, pos.y);
      const width = Math.abs(pos.x - startPos.x);
      const height = Math.abs(pos.y - startPos.y);

      if (width > 3 && height > 3) {
        addAnnotation({
          id: `ann-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'circle',
          color: strokeColor,
          strokeWidth,
          x,
          y,
          width,
          height,
        });
      }
    } else if (activeTool === 'arrow') {
      addAnnotation({
        id: `ann-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'arrow',
        color: strokeColor,
        strokeWidth,
        x: startPos.x,
        y: startPos.y,
        endX: pos.x,
        endY: pos.y,
      });
    }

    setStartPos(null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoordinates(e);
    handleStartAt(pos);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoordinates(e);
    handleMoveAt(pos);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoordinates(e);
    handleEndAt(pos);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      const t = e.touches[0];
      const pos = getCoordinatesFromClient(t.clientX, t.clientY);
      handleStartAt(pos);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      e.preventDefault();
      const t = e.touches[0];
      const pos = getCoordinatesFromClient(t.clientX, t.clientY);
      handleMoveAt(pos);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos =
      currentPoints.length > 0
        ? currentPoints[currentPoints.length - 1]
        : (startPos || { x: 0, y: 0 });
    handleEndAt(pos);
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

        // Draw annotations
        for (const ann of pageAnns) {
          ctx.save();
          ctx.strokeStyle = ann.color;
          ctx.fillStyle = ann.color;
          ctx.lineWidth = ann.strokeWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (ann.opacity) ctx.globalAlpha = ann.opacity;

          switch (ann.type) {
            case 'pen':
            case 'signature':
              if (ann.points && ann.points.length > 1) {
                ctx.beginPath();
                ctx.moveTo(ann.points[0].x, ann.points[0].y);
                for (let i = 1; i < ann.points.length; i++) {
                  ctx.lineTo(ann.points[i].x, ann.points[i].y);
                }
                ctx.stroke();
              }
              break;
            case 'highlight':
              if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
                ctx.globalAlpha = 0.35;
                ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
              }
              break;
            case 'rect':
              if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
                ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
              }
              break;
            case 'circle':
              if (ann.x !== undefined && ann.y !== undefined && ann.width && ann.height) {
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
                ctx.beginPath();
                ctx.moveTo(ann.x, ann.y);
                ctx.lineTo(ann.endX, ann.endY);
                ctx.stroke();
                const angle = Math.atan2(ann.endY - ann.y, ann.endX - ann.x);
                const headLength = 14;
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
          }
          ctx.restore();
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
    setAnnotations([]);
    setHistory([]);
    setHistoryStep(-1);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Type className="h-8 w-8 text-pink-500" />
          Annotate PDF
        </h1>
        <p className="text-muted-foreground mt-1">
          Add freehand drawings, highlights, text, geometric shapes, arrows, and signatures to any PDF page.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
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
                  <MousePointer className="h-3.5 w-3.5 mr-1 text-primary" />
                  Select / Move
                </Button>
                <Button
                  variant={activeTool === 'pen' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
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
                  className="h-8 px-2.5 text-xs"
                  onClick={() => {
                    setActiveTool('signature');
                    setSelectedId(null);
                    setStrokeColor('#1e3a8a'); // navy default
                  }}
                >
                  <FileSignature className="h-3.5 w-3.5 mr-1" />
                  Sign
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
                  className="h-8 bg-pink-600 hover:bg-pink-700 text-white ml-2"
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
            className="flex justify-center items-center bg-muted/30 border rounded-xl p-4 overflow-auto min-h-[500px]"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground py-20">
                <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
                <p className="text-sm">Preparing high-resolution canvas...</p>
              </div>
            ) : pageImages[currentPage - 1] ? (
              <div
                className="relative shadow-lg border rounded bg-white overflow-hidden"
                style={{
                  backgroundImage: `url(${pageImages[currentPage - 1]})`,
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={(e) => {
                    if (isDrawing || isDraggingSelected) handleMouseUp(e);
                  }}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
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
    </div>
  );
}
