import { useState, useCallback, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import { toast } from 'sonner';
import {
  Combine,
  GripVertical,
  Trash2,
  Download,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  Loader2,
  FileText,
  Plus,
} from 'lucide-react';
import { cn, formatFileSize, readFileAsArrayBuffer, downloadBlob, generateId, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

interface UploadedPdf {
  id: string;
  file: File;
  data: ArrayBuffer;
  pageCount: number;
  selectedPages: boolean[];
  thumbnailUrl: string | null;
  showPageSelector: boolean;
  pageThumbnails: string[];
  loadingThumbnails: boolean;
}

export default function MergePdf() {
  const [pdfs, setPdfs] = useState<UploadedPdf[]>([]);
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const { renderPage, renderAllPages, getPageCount } = usePdfRenderer();

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLoading(true);

      try {
        const newPdfs: UploadedPdf[] = [];

        for (const file of files) {
          try {
            const data = await readFileAsArrayBuffer(file);
            const dataClone = data.slice(0);
            const pageCount = await getPageCount(new Uint8Array(dataClone));
            let thumbnailUrl: string | null = null;

            try {
              thumbnailUrl = await renderPage(new Uint8Array(data.slice(0)), 1, 0.4);
            } catch {
              // Thumbnail rendering failed, proceed without it
            }

            newPdfs.push({
              id: generateId(),
              file,
              data,
              pageCount,
              selectedPages: new Array(pageCount).fill(true),
              thumbnailUrl,
              showPageSelector: false,
              pageThumbnails: [],
              loadingThumbnails: false,
            });
          } catch (err) {
            toast.error(`Failed to load "${file.name}"`);
            console.error(err);
          }
        }

        setPdfs((prev) => [...prev, ...newPdfs]);
        if (newPdfs.length > 0) {
          toast.success(`Added ${newPdfs.length} PDF${newPdfs.length > 1 ? 's' : ''}`);
        }
      } catch (err) {
        toast.error('Failed to process files');
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount, renderPage]
  );

  const removePdf = useCallback((id: string) => {
    setPdfs((prev) => prev.filter((p) => p.id !== id));
    toast.success('PDF removed');
  }, []);

  const togglePageSelector = useCallback(
    async (id: string) => {
      setPdfs((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          return { ...p, showPageSelector: !p.showPageSelector };
        })
      );

      const pdf = pdfs.find((p) => p.id === id);
      if (pdf && pdf.pageThumbnails.length === 0 && !pdf.loadingThumbnails) {
        setPdfs((prev) =>
          prev.map((p) => (p.id === id ? { ...p, loadingThumbnails: true } : p))
        );

        try {
          const thumbnails = await renderAllPages(new Uint8Array(pdf.data.slice(0)), 0.4);
          setPdfs((prev) =>
            prev.map((p) =>
              p.id === id
                ? { ...p, pageThumbnails: thumbnails, loadingThumbnails: false }
                : p
            )
          );
        } catch (err) {
          console.error('Failed to render page thumbnails:', err);
          setPdfs((prev) =>
            prev.map((p) => (p.id === id ? { ...p, loadingThumbnails: false } : p))
          );
          toast.error('Failed to load page thumbnails');
        }
      }
    },
    [pdfs, renderAllPages]
  );

  const togglePage = useCallback((pdfId: string, pageIndex: number) => {
    setPdfs((prev) =>
      prev.map((p) => {
        if (p.id !== pdfId) return p;
        const newSelected = [...p.selectedPages];
        newSelected[pageIndex] = !newSelected[pageIndex];
        return { ...p, selectedPages: newSelected };
      })
    );
  }, []);

  const selectAllPages = useCallback((pdfId: string) => {
    setPdfs((prev) =>
      prev.map((p) => {
        if (p.id !== pdfId) return p;
        return { ...p, selectedPages: new Array(p.pageCount).fill(true) };
      })
    );
  }, []);

  const deselectAllPages = useCallback((pdfId: string) => {
    setPdfs((prev) =>
      prev.map((p) => {
        if (p.id !== pdfId) return p;
        return { ...p, selectedPages: new Array(p.pageCount).fill(false) };
      })
    );
  }, []);

  // Drag & drop reordering
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Make the drag ghost slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      dragCounter.current++;
      if (index !== dragIndex) {
        setDragOverIndex(index);
      }
    },
    [dragIndex]
  );

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOverIndex(null);
      setDragIndex(null);

      if (dragIndex === null || dragIndex === dropIndex) return;

      setPdfs((prev) => {
        const newPdfs = [...prev];
        const [movedItem] = newPdfs.splice(dragIndex, 1);
        newPdfs.splice(dropIndex, 0, movedItem);
        return newPdfs;
      });
    },
    [dragIndex]
  );

  const movePdf = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pdfs.length) return;
    const reordered = [...pdfs];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setPdfs(reordered);
  };

  const mergePdfs = useCallback(async () => {
    if (pdfs.length === 0) {
      toast.error('Please add at least one PDF');
      return;
    }

    const totalSelectedPages = pdfs.reduce(
      (sum, p) => sum + p.selectedPages.filter(Boolean).length,
      0
    );

    if (totalSelectedPages === 0) {
      toast.error('Please select at least one page');
      return;
    }

    setMerging(true);

    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdf of pdfs) {
        const sourcePdf = await PDFDocument.load(pdf.data);
        const pageIndices = pdf.selectedPages
          .map((selected, index) => (selected ? index : -1))
          .filter((index) => index !== -1);

        if (pageIndices.length === 0) continue;

        const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      }

      const mergedBytes = await mergedPdf.save();
      const blob = createPdfBlob(mergedBytes);
      downloadBlob(blob, 'merged.pdf');

      toast.success(`Merged ${totalSelectedPages} pages successfully!`);
    } catch (err) {
      toast.error('Failed to merge PDFs');
      console.error('Merge error:', err);
    } finally {
      setMerging(false);
    }
  }, [pdfs]);

  const totalPages = pdfs.reduce((sum, p) => sum + p.pageCount, 0);
  const selectedPagesCount = pdfs.reduce(
    (sum, p) => sum + p.selectedPages.filter(Boolean).length,
    0
  );

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Combine className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Merge PDFs</h1>
        </div>
        <p className="text-muted-foreground">
          Combine multiple PDF files into a single document. Drag to reorder and select specific pages.
        </p>
      </div>

      <FileUploader
        accept=".pdf,application/pdf"
        multiple
        maxFiles={50}
        maxSize={100 * 1024 * 1024}
        onFilesSelected={handleFilesSelected}
        label="Upload PDF Files"
        description="Drag & drop PDF files here, or click to browse"
        showFileList={false}
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading PDFs...</span>
        </div>
      )}

      {pdfs.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-semibold">Uploaded PDFs</h2>
              <Badge variant="secondary">{pdfs.length} files</Badge>
              <Badge variant="outline">{selectedPagesCount}/{totalPages} pages selected</Badge>
            </div>
            <Button onClick={mergePdfs} disabled={merging || selectedPagesCount === 0} className="w-full sm:w-auto">
              {merging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Merge & Download
                </>
              )}
            </Button>
          </div>

          <div className="space-y-2">
            {pdfs.map((pdf, index) => (
              <Card
                key={pdf.id}
                className={cn(
                  'transition-all',
                  dragOverIndex === index && 'border-primary bg-primary/5 border-2',
                  dragIndex === index && 'opacity-50'
                )}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragEnter={(e) => handleDragEnter(e, index)}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    {/* Reorder Up/Down arrows for mobile + drag handle for desktop */}
                    <div className="flex flex-col items-center justify-center shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground touch-manipulation"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          movePdf(index, 'up');
                        }}
                        title="Move Up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 hidden sm:block cursor-grab active:cursor-grabbing" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground touch-manipulation"
                        disabled={index === pdfs.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          movePdf(index, 'down');
                        }}
                        title="Move Down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Thumbnail */}
                    <div className="h-16 w-12 rounded border bg-muted overflow-hidden shrink-0">
                      {pdf.thumbnailUrl ? (
                        <img
                          src={pdf.thumbnailUrl}
                          alt={`${pdf.file.name} preview`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs sm:text-sm truncate">{pdf.file.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mt-0.5">
                        <span className="text-[11px] sm:text-xs text-muted-foreground whitespace-nowrap">
                          {pdf.pageCount} page{pdf.pageCount !== 1 ? 's' : ''} • {formatFileSize(pdf.file.size)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant={pdf.showPageSelector ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => togglePageSelector(pdf.id)}
                        className="h-7 text-xs px-2 gap-1 touch-manipulation font-normal border-primary/30"
                        title="Click to select specific pages to merge"
                      >
                        <span className="font-semibold text-primary">
                          {pdf.selectedPages.filter(Boolean).length}/{pdf.pageCount}
                        </span>
                        <span className="hidden sm:inline text-muted-foreground">pages</span>
                        {pdf.showPageSelector ? (
                          <ChevronUp className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePdf(pdf.id)}
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Remove PDF"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Page Selector */}
                  {pdf.showPageSelector && (
                    <div className="mt-4 border-t pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium">Page Selection</span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectAllPages(pdf.id)}
                            className="text-xs h-7"
                          >
                            <CheckSquare className="mr-1 h-3 w-3" />
                            Select All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deselectAllPages(pdf.id)}
                            className="text-xs h-7"
                          >
                            <Square className="mr-1 h-3 w-3" />
                            Deselect All
                          </Button>
                        </div>
                      </div>

                      {pdf.loadingThumbnails ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          <span className="ml-2 text-sm text-muted-foreground">
                            Loading thumbnails...
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                          {pdf.selectedPages.map((isSelected, pageIdx) => (
                            <div
                              key={pageIdx}
                              className={cn(
                                'relative cursor-pointer rounded-md overflow-hidden border-2 transition-all',
                                isSelected
                                  ? 'border-primary ring-1 ring-primary/30'
                                  : 'border-muted opacity-50 hover:opacity-75'
                              )}
                              onClick={() => togglePage(pdf.id, pageIdx)}
                            >
                              {pdf.pageThumbnails[pageIdx] ? (
                                <img
                                  src={pdf.pageThumbnails[pageIdx]}
                                  alt={`Page ${pageIdx + 1}`}
                                  className="w-full h-auto"
                                />
                              ) : (
                                <div className="aspect-[3/4] bg-muted flex items-center justify-center">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}

                              {/* Checkbox overlay */}
                              <div className="absolute top-1 right-1">
                                {isSelected ? (
                                  <CheckSquare className="h-4 w-4 text-primary bg-white rounded-sm" />
                                ) : (
                                  <Square className="h-4 w-4 text-muted-foreground bg-white rounded-sm" />
                                )}
                              </div>

                              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5">
                                {pageIdx + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Add more files */}
          <div className="flex justify-center pt-2">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple
              maxFiles={50 - pdfs.length}
              maxSize={100 * 1024 * 1024}
              onFilesSelected={handleFilesSelected}
              label="Add More PDFs"
              description="Drop more files or click to browse"
              showFileList={false}
              className="w-full"
            />
          </div>

          {/* Bottom merge button */}
          <div className="flex justify-center pt-4 pb-8">
            <Button
              size="lg"
              onClick={mergePdfs}
              disabled={merging || selectedPagesCount === 0}
              className="px-8"
            >
              {merging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Merging {selectedPagesCount} pages...
                </>
              ) : (
                <>
                  <Combine className="mr-2 h-4 w-4" />
                  Merge {selectedPagesCount} Pages into One PDF
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {pdfs.length === 0 && !loading && (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Plus className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <CardTitle className="text-lg mb-1">No PDFs Added Yet</CardTitle>
            <CardDescription>
              Upload PDF files above to start merging them into a single document.
            </CardDescription>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
