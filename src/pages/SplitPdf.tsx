import { useState, useCallback, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { toast } from 'sonner';
import {
  Scissors,
  Download,
  Loader2,
  CheckSquare,
  Square,
  FileArchive,
  RefreshCw,
  Layers,
  FileCheck,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

export default function SplitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<boolean[]>([]);
  const [rangeInput, setRangeInput] = useState<string>('1-2, 3-4');
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'extract' | 'all' | 'ranges'>('extract');

  const { renderAllPages, getPageCount } = usePdfRenderer();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setSelectedPages(new Array(count).fill(false));

        // Generate initial range placeholder
        if (count > 2) {
          const half = Math.ceil(count / 2);
          setRangeInput(`1-${half}, ${half + 1}-${count}`);
        } else {
          setRangeInput(`1-${count}`);
        }

        // Render thumbnails
        try {
          const thumbs = await renderAllPages(new Uint8Array(buffer.slice(0)), 0.4);
          setThumbnails(thumbs);
        } catch (err) {
          console.error('Error generating thumbnails', err);
          toast.error('Could not render some page thumbnails');
        }

        toast.success(`Loaded "${selectedFile.name}" with ${count} pages`);
      } catch (err) {
        console.error('Failed to parse PDF', err);
        toast.error('Failed to load PDF file. It might be corrupted or password-protected.');
        setFile(null);
        setPdfData(null);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount, renderAllPages]
  );

  const togglePageSelection = (index: number) => {
    setSelectedPages((prev) => {
      const updated = [...prev];
      updated[index] = !updated[index];
      return updated;
    });
  };

  const selectAll = () => {
    setSelectedPages(new Array(pageCount).fill(true));
  };

  const deselectAll = () => {
    setSelectedPages(new Array(pageCount).fill(false));
  };

  // Mode 1: Extract selected pages into one PDF
  const handleExtractSelected = async () => {
    if (!pdfData || !file) return;
    const selectedIndices = selectedPages
      .map((selected, index) => (selected ? index : -1))
      .filter((i) => i !== -1);

    if (selectedIndices.length === 0) {
      toast.warning('Please select at least one page to extract');
      return;
    }

    setProcessing(true);
    try {
      const srcDoc = await PDFDocument.load(pdfData);
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, selectedIndices);
      copiedPages.forEach((p) => newDoc.addPage(p));

      const pdfBytes = await newDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-extracted.pdf`);
      toast.success(`Successfully extracted ${selectedIndices.length} pages!`);
    } catch (err) {
      console.error('Failed to extract pages', err);
      toast.error('Failed to extract selected pages');
    } finally {
      setProcessing(false);
    }
  };

  // Mode 2: Split every page into separate PDF (download as ZIP)
  const handleSplitAll = async () => {
    if (!pdfData || !file) return;

    setProcessing(true);
    try {
      const srcDoc = await PDFDocument.load(pdfData);
      const zip = new JSZip();
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      for (let i = 0; i < pageCount; i++) {
        const newDoc = await PDFDocument.create();
        const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
        newDoc.addPage(copiedPage);
        const pdfBytes = await newDoc.save();
        zip.file(`${baseName}-page-${i + 1}.pdf`, pdfBytes);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${baseName}-all-pages.zip`);
      toast.success(`Successfully split into ${pageCount} separate PDFs!`);
    } catch (err) {
      console.error('Failed to split all pages', err);
      toast.error('Failed to split PDF');
    } finally {
      setProcessing(false);
    }
  };

  // Mode 3: Split by custom page ranges
  const parseRanges = (input: string, maxPages: number): number[][] => {
    const parts = input.split(',').map((p) => p.trim()).filter(Boolean);
    const result: number[][] = [];

    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
          throw new Error(`Invalid range format: "${part}"`);
        }
        const pages: number[] = [];
        for (let p = start; p <= Math.min(end, maxPages); p++) {
          pages.push(p - 1); // 0-indexed
        }
        if (pages.length > 0) result.push(pages);
      } else {
        const page = parseInt(part, 10);
        if (isNaN(page) || page < 1 || page > maxPages) {
          throw new Error(`Invalid page number: "${part}"`);
        }
        result.push([page - 1]);
      }
    }
    return result;
  };

  const handleSplitByRanges = async () => {
    if (!pdfData || !file) return;

    let ranges: number[][];
    try {
      ranges = parseRanges(rangeInput, pageCount);
      if (ranges.length === 0) {
        toast.warning('Please provide at least one valid page range');
        return;
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid page range syntax');
      return;
    }

    setProcessing(true);
    try {
      const srcDoc = await PDFDocument.load(pdfData);
      const zip = new JSZip();
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      for (let r = 0; r < ranges.length; r++) {
        const pageIndices = ranges[r];
        const newDoc = await PDFDocument.create();
        const copied = await newDoc.copyPages(srcDoc, pageIndices);
        copied.forEach((p) => newDoc.addPage(p));
        const pdfBytes = await newDoc.save();

        const rangeLabel = pageIndices.length === 1
          ? `page-${pageIndices[0] + 1}`
          : `pages-${pageIndices[0] + 1}-to-${pageIndices[pageIndices.length - 1] + 1}`;
        zip.file(`${baseName}-part-${r + 1}-${rangeLabel}.pdf`, pdfBytes);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${baseName}-split-ranges.zip`);
      toast.success(`Successfully generated ${ranges.length} range files!`);
    } catch (err) {
      console.error('Failed to split by ranges', err);
      toast.error('Failed to generate range files');
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setThumbnails([]);
    setSelectedPages([]);
    setPageCount(0);
  };

  const selectedCount = selectedPages.filter(Boolean).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Scissors className="h-8 w-8 text-orange-500" />
          Split PDF
        </h1>
        <p className="text-muted-foreground mt-1">
          Separate PDF pages into individual documents, extract specific pages, or split by custom ranges.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file here"
              description="Extract pages, split into separate PDFs, or split by ranges"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* File summary banner */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center font-bold">
                  PDF
                </div>
                <div>
                  <h3 className="font-semibold text-sm sm:text-base truncate max-w-md">
                    {file.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <Badge variant="secondary" className="text-xs">
                      {pageCount} {pageCount === 1 ? 'Page' : 'Pages'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleReset} disabled={loading || processing}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Choose Another File
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Splitting Modes */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="extract" className="flex items-center gap-2">
                <FileCheck className="h-4 w-4" />
                <span className="hidden sm:inline">Extract</span> Selected Pages
              </TabsTrigger>
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Split Every Page
              </TabsTrigger>
              <TabsTrigger value="ranges" className="flex items-center gap-2">
                <Scissors className="h-4 w-4" />
                Custom Ranges
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: Extract Selected Pages */}
            <TabsContent value="extract" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">Select Pages to Extract</CardTitle>
                      <CardDescription>
                        Click on thumbnails to select pages. Selected pages will be combined into a new single PDF.
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
                      <Button
                        onClick={handleExtractSelected}
                        disabled={selectedCount === 0 || processing}
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        {processing ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <Download className="h-4 w-4 mr-1.5" />
                        )}
                        Extract ({selectedCount}) {selectedCount === 1 ? 'Page' : 'Pages'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                      <p className="text-sm">Rendering page previews...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {Array.from({ length: pageCount }).map((_, idx) => {
                        const isSelected = selectedPages[idx];
                        const thumb = thumbnails[idx];

                        return (
                          <div
                            key={idx}
                            onClick={() => togglePageSelection(idx)}
                            className={`group relative rounded-lg border-2 p-1.5 cursor-pointer transition-all bg-card ${
                              isSelected
                                ? 'border-orange-500 ring-2 ring-orange-500/20 shadow-md'
                                : 'border-border hover:border-orange-300'
                            }`}
                          >
                            <div className="aspect-[3/4] bg-muted/40 rounded flex items-center justify-center overflow-hidden relative">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={`Page ${idx + 1}`}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">Page {idx + 1}</span>
                              )}

                              <div
                                className={`absolute top-1.5 left-1.5 rounded-full p-0.5 transition-colors ${
                                  isSelected
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-black/40 text-white/70 group-hover:bg-black/60'
                                }`}
                              >
                                {isSelected ? (
                                  <CheckSquare className="h-3.5 w-3.5" />
                                ) : (
                                  <Square className="h-3.5 w-3.5" />
                                )}
                              </div>
                            </div>
                            <div className="mt-1 text-center text-xs font-medium text-muted-foreground">
                              Page {idx + 1}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: Split Every Page */}
            <TabsContent value="all" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Split Every Page into Individual PDFs</CardTitle>
                  <CardDescription>
                    Each page in your document will become its own 1-page PDF. All files will be zipped and downloaded.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-4 flex items-center gap-4">
                    <FileArchive className="h-10 w-10 text-orange-500 shrink-0" />
                    <div>
                      <h4 className="font-medium text-sm">Download as ZIP archive</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Contains {pageCount} single-page PDF files, neatly named and formatted.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={handleSplitAll}
                    disabled={processing}
                    size="lg"
                    className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    {processing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Split into {pageCount} PDFs & Download ZIP
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: Split by Custom Ranges */}
            <TabsContent value="ranges" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Split by Page Ranges</CardTitle>
                  <CardDescription>
                    Specify page intervals separated by commas. Each range will be saved as a separate PDF and packaged into a ZIP.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ranges">Page Ranges</Label>
                    <Input
                      id="ranges"
                      placeholder="e.g. 1-3, 4-7, 8-10"
                      value={rangeInput}
                      onChange={(e) => setRangeInput(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Total pages available: <strong>{pageCount}</strong>. Example: <code>1-3, 4-6, 7</code>
                    </p>
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={handleSplitByRanges}
                      disabled={processing || !rangeInput.trim()}
                      className="bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      {processing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Process Ranges & Download ZIP
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
