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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, [currentPage, annotations]);

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

  // Mouse event handlers for canvas drawing
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoordinates(e);
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

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const pos = getCanvasCoordinates(e);

    if (activeTool === 'pen' || activeTool === 'signature') {
      setCurrentPoints((prev) => {
        const next = [...prev, pos];
        // Live drawing on canvas
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

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPos) return;
    const pos = getCanvasCoordinates(e);
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
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border">
                <Button
                  variant={activeTool === 'pen' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setActiveTool('pen')}
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
                  onClick={() => setActiveTool('text')}
                >
                  <Type className="h-3.5 w-3.5 mr-1" />
                  Text
                </Button>
                <Button
                  variant={activeTool === 'rect' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setActiveTool('rect')}
                >
                  <Square className="h-3.5 w-3.5 mr-1" />
                  Box
                </Button>
                <Button
                  variant={activeTool === 'circle' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setActiveTool('circle')}
                >
                  <Circle className="h-3.5 w-3.5 mr-1" />
                  Circle
                </Button>
                <Button
                  variant={activeTool === 'arrow' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setActiveTool('arrow')}
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
          <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-muted/40 rounded-lg text-xs border">
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
                  className="cursor-crosshair block"
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
