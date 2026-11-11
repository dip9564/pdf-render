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
  ChevronLeft,
  ChevronRight,
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

        const initialPages: PageItem[] = Array.from({ length: count }).map((_, i) => ({
          id: `page-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          originalIndex: i,
          rotation: 0,
          thumbnailUrl: '',
        }));

        setPages(initialPages);
        setSelectedPageIds(new Set());
        setLoading(false);

        // Render thumbnails progressively
        try {
          await renderAllPages(
            new Uint8Array(buffer.slice(0)),
            0.4,
            (current, _, dataUrl) => {
              setPages((prev) => {
                const next = [...prev];
                if (next[current - 1]) {
                  next[current - 1] = { ...next[current - 1], thumbnailUrl: dataUrl };
                }
                return next;
              });
            }
          );
        } catch (e) {
          console.error('Error rendering previews', e);
        }

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

  const selectAll = () => {
    setSelectedPageIds(new Set(pages.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedPageIds(new Set());
  };

  const selectOdd = () => {
    setSelectedPageIds(new Set(pages.filter((_, i) => i % 2 === 0).map((p) => p.id)));
    toast.info('Selected odd pages (1, 3, 5...)');
  };

  const selectEven = () => {
    setSelectedPageIds(new Set(pages.filter((_, i) => i % 2 === 1).map((p) => p.id)));
    toast.info('Selected even pages (2, 4, 6...)');
  };

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

  const movePage = (index: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pages.length) return;
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
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
    <div className="container mx-auto px-3 sm:px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:py-8 max-w-6xl">
      <div className="mb-5 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">PDF Page Organizer</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Visually reorder pages, rotate, duplicate, insert blank sheets, and delete unwanted pages.
        </p>
      </div>

      {!file ? (
        <Card>
          <CardContent className="p-5 sm:p-7">
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
        <div className="space-y-4 sm:space-y-6">
          {/* Mobile Compact File Header */}
          <div className="sm:hidden flex items-center justify-between pb-2 mb-1 border-b">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
                PDF
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate max-w-[170px]">{file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {pages.length} {pages.length === 1 ? 'page' : 'pages'} • {formatFileSize(file.size)}
                  {selectedPageIds.size > 0 && ` • ${selectedPageIds.size} selected`}
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

          {/* Desktop File Header & Action Bar */}
          <Card className="hidden sm:block">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
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
                      <Badge variant="outline" className="text-xs text-primary border-primary/40">
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

          {/* Organizer Grid Card */}
          <Card>
            <CardHeader className="p-3.5 pb-2.5 sm:p-6 sm:pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base sm:text-lg">Page Order & Selection</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Reorder with arrows, select pages to extract, or rotate and duplicate individual cards.
                  </CardDescription>
                </div>

                {/* Batch selection buttons */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-7 px-2">
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectOdd} className="text-xs h-7 px-2">
                    Odd (1,3..)
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectEven} className="text-xs h-7 px-2">
                    Even (2,4..)
                  </Button>
                  {selectedPageIds.size > 0 && (
                    <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs h-7 px-2">
                      Clear ({selectedPageIds.size})
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleRotateAll(90)} className="text-xs h-7 px-2 sm:hidden">
                    <RotateCw className="h-3 w-3 mr-1" />
                    Rotate All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3.5 pt-1 sm:p-6 sm:pt-0">
              {loading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">Generating high-fidelity page previews...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
                  {pages.map((item, index) => {
                    const isSelected = selectedPageIds.has(item.id);

                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        className={`group relative rounded-xl border-2 p-2 transition-[border-color,box-shadow,opacity] bg-card flex flex-col justify-between ${
                          draggedIndex === index
                            ? 'opacity-40 border-primary/60'
                            : isSelected
                            ? 'border-primary ring-2 ring-primary/20 shadow'
                            : 'border-border hover:border-primary/40'
                        }`}
                      >
                        {/* Drag Handle, Mobile Reorder & Page Indicator */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5 px-0.5">
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground touch-manipulation sm:hidden"
                              disabled={index === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(index, 'left');
                              }}
                              title="Move Left"
                            >
                              <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 hidden sm:block cursor-grab active:cursor-grabbing" />
                            <span className="font-semibold text-foreground text-[11px] sm:text-xs">#{index + 1}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground touch-manipulation sm:hidden"
                              disabled={index === pages.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(index, 'right');
                              }}
                              title="Move Right"
                            >
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.id)}
                            className="rounded border-input accent-primary cursor-pointer h-4 w-4 touch-manipulation"
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
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
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
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
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

          {/* Mobile Sticky Bottom Action Bar */}
          <div
            data-testid="organize-mobile-action-bar"
            className="sm:hidden sticky z-30 pt-1"
            style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="bg-card/95 backdrop-blur-md border border-primary/30 rounded-2xl p-3 shadow-xl space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="font-semibold text-foreground pl-0.5 truncate">
                  <span>
                    {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                  </span>
                  {selectedPageIds.size > 0 && (
                    <span className="text-primary ml-1.5">• {selectedPageIds.size} selected</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleInsertBlank()}
                    disabled={processing}
                    className="text-[11px] h-7 px-2 touch-manipulation"
                  >
                    <PlusCircle className="h-3 w-3 mr-1" />
                    + Blank
                  </Button>
                  {selectedPageIds.size > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleExtractSelected}
                      disabled={processing}
                      className="text-[11px] h-7 px-2.5 touch-manipulation"
                    >
                      <FileCheck className="h-3 w-3 mr-1" />
                      Extract ({selectedPageIds.size})
                    </Button>
                  )}
                </div>
              </div>

              <Button
                type="button"
                onClick={handleSaveModified}
                disabled={processing}
                className="w-full h-10 text-xs font-semibold shadow-sm touch-manipulation"
              >
                {processing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    Saving Organized PDF...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-1.5" />
                    Save &amp; Download PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
