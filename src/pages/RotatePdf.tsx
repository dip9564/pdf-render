import { useState, useCallback } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { toast } from 'sonner';
import {
  RotateCw,
  RotateCcw,
  Download,
  Loader2,
  RefreshCw,
  CheckSquare,
  Square,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

interface PageRotateState {
  index: number;
  rotation: number; // accumulated user rotation in degrees: 0, 90, 180, 270
  selected: boolean;
  thumbnailUrl?: string;
}

export default function RotatePdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<PageRotateState[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);

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
          console.error('Error rendering thumbnails', e);
        }

        const initialPages: PageRotateState[] = Array.from({ length: count }).map((_, i) => ({
          index: i,
          rotation: 0,
          selected: false,
          thumbnailUrl: thumbs[i] || '',
        }));

        setPages(initialPages);
        toast.success(`Loaded "${selectedFile.name}" with ${count} pages`);
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

  const rotatePage = (index: number, angle: number) => {
    setPages((prev) =>
      prev.map((p, i) => {
        if (i === index) {
          return { ...p, rotation: (p.rotation + angle + 360) % 360 };
        }
        return p;
      })
    );
  };

  const rotateAllPages = (angle: number) => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        rotation: (p.rotation + angle + 360) % 360,
      }))
    );
    toast.info(`Rotated all pages by ${angle > 0 ? `+${angle}` : angle}°`);
  };

  const rotateSelectedPages = (angle: number) => {
    const selectedCount = pages.filter((p) => p.selected).length;
    if (selectedCount === 0) {
      toast.warning('No pages selected to rotate');
      return;
    }

    setPages((prev) =>
      prev.map((p) => {
        if (p.selected) {
          return { ...p, rotation: (p.rotation + angle + 360) % 360 };
        }
        return p;
      })
    );
    toast.info(`Rotated ${selectedCount} selected pages`);
  };

  const togglePageSelect = (index: number) => {
    setPages((prev) =>
      prev.map((p, i) => (i === index ? { ...p, selected: !p.selected } : p))
    );
  };

  const selectAll = () => setPages((prev) => prev.map((p) => ({ ...p, selected: true })));
  const deselectAll = () => setPages((prev) => prev.map((p) => ({ ...p, selected: false })));

  const handleDownloadRotatedPdf = async () => {
    if (!pdfData || !file) return;

    setProcessing(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const pdfPages = pdfDoc.getPages();

      for (let i = 0; i < pages.length; i++) {
        const userAngle = pages[i].rotation;
        if (userAngle !== 0) {
          const page = pdfPages[i];
          const existingRotation = page.getRotation().angle;
          const finalAngle = (existingRotation + userAngle) % 360;
          page.setRotation(degrees(finalAngle));
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-rotated.pdf`);
      toast.success('Rotated PDF downloaded successfully!');
    } catch (err) {
      console.error('Failed to rotate PDF', err);
      toast.error('Failed to save rotated PDF');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setPages([]);
  };

  const selectedCount = pages.filter((p) => p.selected).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <RotateCw className="h-8 w-8 text-amber-500" />
          Rotate PDF
        </h1>
        <p className="text-muted-foreground mt-1">
          Permanently rotate all pages or selected pages by 90°, 180°, or 270°.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file to rotate"
              description="Rotate specific pages or the entire document"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* File Header & Controls */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
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
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => rotateAllPages(90)}>
                  <RotateCw className="h-4 w-4 mr-1.5" />
                  Rotate All 90° CW
                </Button>
                <Button variant="outline" size="sm" onClick={() => rotateAllPages(180)}>
                  Rotate All 180°
                </Button>
                {selectedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-400 text-amber-600"
                    onClick={() => rotateSelectedPages(90)}
                  >
                    <RotateCw className="h-4 w-4 mr-1" />
                    Rotate Selected ({selectedCount})
                  </Button>
                )}
                <Button
                  onClick={handleDownloadRotatedPdf}
                  disabled={processing}
                  className="bg-amber-500 hover:bg-amber-600 text-white"
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

          {/* Page Grid */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Page Previews</CardTitle>
                  <CardDescription>
                    Click to select pages, or use individual buttons to rotate clockwise or counter-clockwise.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    <CheckSquare className="h-4 w-4 mr-1" />
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll}>
                    <Square className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                  <p className="text-sm">Rendering page thumbnails...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {pages.map((p) => (
                    <div
                      key={p.index}
                      className={`group relative rounded-lg border-2 p-2 transition-all bg-card flex flex-col justify-between ${
                        p.selected
                          ? 'border-amber-500 ring-2 ring-amber-500/20 shadow'
                          : 'border-border hover:border-amber-300'
                      }`}
                    >
                      {/* Top Checkbox & Page Number */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span className="font-semibold text-foreground">Page {p.index + 1}</span>
                        <input
                          type="checkbox"
                          checked={p.selected}
                          onChange={() => togglePageSelect(p.index)}
                          className="rounded border-input text-amber-500 focus:ring-amber-400 cursor-pointer h-3.5 w-3.5"
                        />
                      </div>

                      {/* Thumbnail with visual rotation */}
                      <div
                        className="aspect-[3/4] bg-muted/40 rounded flex items-center justify-center overflow-hidden relative cursor-pointer"
                        onClick={() => togglePageSelect(p.index)}
                      >
                        {p.thumbnailUrl ? (
                          <img
                            src={p.thumbnailUrl}
                            alt={`Page ${p.index + 1}`}
                            className="w-full h-full object-contain transition-transform duration-300"
                            style={{ transform: `rotate(${p.rotation}deg)` }}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">Page {p.index + 1}</span>
                        )}

                        {p.rotation !== 0 && (
                          <Badge
                            variant="secondary"
                            className="absolute top-1 right-1 text-[10px] px-1 py-0 h-4 bg-background/80 font-bold"
                          >
                            {p.rotation}°
                          </Badge>
                        )}
                      </div>

                      {/* Individual rotate controls */}
                      <div className="flex items-center justify-around gap-1 mt-2 pt-1 border-t border-border/60">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                          title="Rotate 90° Counter-Clockwise"
                          onClick={() => rotatePage(p.index, -90)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                          title="Rotate 90° Clockwise"
                          onClick={() => rotatePage(p.index, 90)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
