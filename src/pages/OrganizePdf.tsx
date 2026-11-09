import { useState, useCallback, useRef } from 'react';
import { PDFDocument, degrees, PageSizes } from 'pdf-lib';
import { toast } from 'sonner';
import {
  LayoutGrid,
  RotateCw,
  Trash2,
  Copy,
  PlusCircle,
  Download,
  Loader2,
  GripVertical,
  RefreshCw,
  FileText,
  FileCheck,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

interface PageItem {
  id: string;
  originalIndex: number; // -1 indicates inserted blank page
  rotation: number; // 0, 90, 180, 270
  thumbnailUrl?: string;
  isBlank?: boolean;
}

export default function OrganizePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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

        let thumbs: string[] = [];
        try {
          thumbs = await renderAllPages(new Uint8Array(buffer.slice(0)), 0.4);
        } catch (e) {
          console.error('Error rendering previews', e);
        }

        const initialPages: PageItem[] = Array.from({ length: count }).map((_, i) => ({
          id: `page-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          originalIndex: i,
          rotation: 0,
          thumbnailUrl: thumbs[i] || '',
        }));

        setPages(initialPages);
        setSelectedPageIds(new Set());
        toast.success(`Loaded ${count} pages from "${selectedFile.name}"`);
      } catch (err) {
        console.error('Error loading PDF', err);
        toast.error('Failed to parse PDF document');
        setFile(null);
        setPdfData(null);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount, renderAllPages]
  );

  // Rotation
  const handleRotate = (id: string, delta: number = 90) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id === id) {
          return { ...p, rotation: (p.rotation + delta) % 360 };
        }
        return p;
      })
    );
  };

  // Rotate all
  const handleRotateAll = (delta: number = 90) => {
    setPages((prev) =>
      prev.map((p) => ({ ...p, rotation: (p.rotation + delta) % 360 }))
    );
  };

  // Delete
  const handleDelete = (id: string) => {
    if (pages.length <= 1) {
      toast.error('A PDF document must have at least one page');
      return;
    }
    setPages((prev) => prev.filter((p) => p.id !== id));
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Duplicate
  const handleDuplicate = (id: string) => {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      if (index === -1) return prev;
      const target = prev[index];
      const copy: PageItem = {
        ...target,
        id: `copy-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    toast.success('Page duplicated');
  };

  // Insert blank page
  const handleInsertBlank = (afterIndex: number = pages.length - 1) => {
    const blank: PageItem = {
      id: `blank-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      originalIndex: -1,
      rotation: 0,
      isBlank: true,
    };

    setPages((prev) => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, blank);
      return next;
    });
    toast.success('Blank page inserted');
  };

  // Drag and drop reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedIndex(null);
  };

  // Selection toggle
  const toggleSelect = (id: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Extract selected
  const handleExtractSelected = async () => {
    if (!pdfData || !file || selectedPageIds.size === 0) {
      toast.warning('Select at least one page to extract');
      return;
    }

    setProcessing(true);
    try {
      const srcDoc = await PDFDocument.load(pdfData);
      const newDoc = await PDFDocument.create();

      const selectedPagesList = pages.filter((p) => selectedPageIds.has(p.id));

      for (const item of selectedPagesList) {
        if (item.isBlank || item.originalIndex === -1) {
          const blankPage = newDoc.addPage(PageSizes.A4);
          if (item.rotation !== 0) {
            blankPage.setRotation(degrees(item.rotation));
          }
        } else {
          const [copied] = await newDoc.copyPages(srcDoc, [item.originalIndex]);
          const currentRotation = copied.getRotation().angle;
          copied.setRotation(degrees((currentRotation + item.rotation) % 360));
          newDoc.addPage(copied);
        }
      }

      const pdfBytes = await newDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-selected-pages.pdf`);
      toast.success(`Extracted ${selectedPagesList.length} pages`);
    } catch (err) {
      console.error('Failed to extract', err);
      toast.error('Failed to extract selected pages');
    } finally {
      setProcessing(false);
    }
  };

  // Save modified PDF
  const handleSaveModified = async () => {
    if (!pdfData || !file) return;

    setProcessing(true);
    try {
      const srcDoc = await PDFDocument.load(pdfData);
      const newDoc = await PDFDocument.create();

      for (const item of pages) {
        if (item.isBlank || item.originalIndex === -1) {
          const blankPage = newDoc.addPage(PageSizes.A4);
          if (item.rotation !== 0) {
            blankPage.setRotation(degrees(item.rotation));
          }
        } else {
          const [copied] = await newDoc.copyPages(srcDoc, [item.originalIndex]);
          const currentRotation = copied.getRotation().angle;
          copied.setRotation(degrees((currentRotation + item.rotation) % 360));
          newDoc.addPage(copied);
        }
      }

      const pdfBytes = await newDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-organized.pdf`);
      toast.success('Organized PDF downloaded successfully!');
    } catch (err) {
      console.error('Failed to save organized PDF', err);
      toast.error('Failed to generate organized PDF');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setPages([]);
    setSelectedPageIds(new Set());
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <LayoutGrid className="h-8 w-8 text-cyan-500" />
          PDF Page Organizer
        </h1>
        <p className="text-muted-foreground mt-1">
          Visually reorder pages, rotate, duplicate, insert blank sheets, and delete unwanted pages.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF document to organize"
              description="Visually arrange and edit page flow"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Action Bar */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 text-cyan-600 flex items-center justify-center font-bold">
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
                      {pages.length} {pages.length === 1 ? 'Page' : 'Pages'}
                    </Badge>
                    {selectedPageIds.size > 0 && (
                      <Badge variant="outline" className="text-xs text-cyan-600 border-cyan-500">
                        {selectedPageIds.size} selected
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleRotateAll(90)}>
                  <RotateCw className="h-4 w-4 mr-1.5" />
                  Rotate All
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleInsertBlank()}>
                  <PlusCircle className="h-4 w-4 mr-1.5" />
                  Insert Blank Page
                </Button>
                {selectedPageIds.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExtractSelected}
                    disabled={processing}
                  >
                    <FileCheck className="h-4 w-4 mr-1.5" />
                    Extract Selected
                  </Button>
                )}
                <Button
                  onClick={handleSaveModified}
                  disabled={processing}
                  className="bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  {processing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  Save & Download
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Organizer Grid */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Page Order</CardTitle>
              <CardDescription>
                Drag and drop cards to reorder. Use the quick controls below each card to rotate, duplicate, or delete individual pages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                  <p className="text-sm">Generating high-fidelity page previews...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {pages.map((item, index) => {
                    const isSelected = selectedPageIds.has(item.id);

                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`group relative rounded-lg border-2 p-2 transition-all bg-card flex flex-col justify-between ${
                          draggedIndex === index
                            ? 'opacity-40 border-cyan-400'
                            : isSelected
                            ? 'border-cyan-500 ring-2 ring-cyan-500/20 shadow'
                            : 'border-border hover:border-cyan-300'
                        }`}
                      >
                        {/* Drag Handle & Page Indicator */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5 px-0.5">
                          <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing">
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                            <span className="font-semibold text-foreground">#{index + 1}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.id)}
                            className="rounded border-input text-cyan-600 focus:ring-cyan-500 cursor-pointer h-3.5 w-3.5"
                          />
                        </div>

                        {/* Page Preview Thumbnail */}
                        <div
                          className="aspect-[3/4] bg-muted/40 rounded flex items-center justify-center overflow-hidden relative cursor-pointer"
                          onClick={() => toggleSelect(item.id)}
                        >
                          {item.isBlank ? (
                            <div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
                              <FileText className="h-6 w-6 stroke-[1.5]" />
                              <span className="text-[10px] uppercase font-semibold">Blank</span>
                            </div>
                          ) : item.thumbnailUrl ? (
                            <img
                              src={item.thumbnailUrl}
                              alt={`Page ${index + 1}`}
                              className="w-full h-full object-contain transition-transform duration-200"
                              style={{ transform: `rotate(${item.rotation}deg)` }}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">Page {index + 1}</span>
                          )}

                          {item.rotation !== 0 && (
                            <Badge
                              variant="secondary"
                              className="absolute top-1 right-1 text-[10px] px-1 py-0 h-4 bg-background/80"
                            >
                              {item.rotation}°
                            </Badge>
                          )}
                        </div>

                        {/* Actions below each card */}
                        <div className="flex items-center justify-between gap-1 mt-2 pt-1 border-t border-border/60">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-cyan-600"
                            title="Rotate 90° Clockwise"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRotate(item.id, 90);
                            }}
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-cyan-600"
                            title="Duplicate Page"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicate(item.id);
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete Page"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
