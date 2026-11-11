import { useState, useCallback, useRef } from 'react';
import { pdfjsLib } from '@/lib/pdfWorker';
import JSZip from 'jszip';
import { toast } from 'sonner';
import {
  ImageDown,
  Download,
  Loader2,
  CheckSquare,
  Square,
  FileArchive,
  RefreshCw,
  Image as ImageIcon,
  Eye,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

interface ConvertedImage {
  pageNumber: number;
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
}

export default function PdfToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<boolean[]>([]);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [scale, setScale] = useState<number>(2.0); // 1.0 = standard, 2.0 = high res, 3.0 = ultra
  const [loading, setLoading] = useState<boolean>(false);
  const [converting, setConverting] = useState<boolean>(false);
  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([]);

  const { renderAllPages, getPageCount } = usePdfRenderer();

  const handleFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const selectedFile = files[0];
      setFile(selectedFile);
      setLoading(true);
      setConvertedImages([]);

      try {
        const buffer = await readFileAsArrayBuffer(selectedFile);
        setPdfData(buffer);
        const count = await getPageCount(new Uint8Array(buffer.slice(0)));
        setPageCount(count);
        setSelectedPages(new Array(count).fill(true)); // Select all by default

        setThumbnails(new Array(count).fill(''));
        try {
          const thumbs = await renderAllPages(
            new Uint8Array(buffer.slice(0)),
            0.35,
            (current, _, dataUrl) => {
              setThumbnails((prev) => {
                const next = [...prev];
                next[current - 1] = dataUrl;
                return next;
              });
            }
          );
          setThumbnails(thumbs);
        } catch (e) {
          console.error('Error rendering thumbnails', e);
        }

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

  const togglePageSelection = (index: number) => {
    setSelectedPages((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const selectAll = () => setSelectedPages(new Array(pageCount).fill(true));
  const deselectAll = () => setSelectedPages(new Array(pageCount).fill(false));
  const selectOdd = () => {
    setSelectedPages(Array.from({ length: pageCount }, (_, i) => i % 2 === 0));
    toast.info('Selected odd pages (1, 3, 5...)');
  };
  const selectEven = () => {
    setSelectedPages(Array.from({ length: pageCount }, (_, i) => i % 2 === 1));
    toast.info('Selected even pages (2, 4, 6...)');
  };

  const handleConvert = async () => {
    if (!pdfData || !file) return;

    const selectedIndices = selectedPages
      .map((sel, idx) => (sel ? idx : -1))
      .filter((i) => i !== -1);

    if (selectedIndices.length === 0) {
      toast.warning('Please select at least one page to convert');
      return;
    }

    setConverting(true);
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfData.slice(0)) }).promise;
      const results: ConvertedImage[] = [];

      for (const pageIdx of selectedIndices) {
        const pageNum = pageIdx + 1;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: ctx, viewport }).promise;

        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, format === 'jpeg' ? 0.92 : undefined);

        // Convert dataURL to Blob
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob(
            (b) => resolve(b || new Blob()),
            mimeType,
            format === 'jpeg' ? 0.92 : undefined
          );
        });

        results.push({
          pageNumber: pageNum,
          dataUrl,
          blob,
          width: viewport.width,
          height: viewport.height,
        });
      }

      pdf.destroy();
      setConvertedImages(results);
      toast.success(`Successfully converted ${results.length} pages to ${format.toUpperCase()}!`);
    } catch (err) {
      console.error('Error converting pages to images', err);
      toast.error('Failed to convert pages to images');
    } finally {
      setConverting(false);
    }
  };

  const downloadSingleImage = (img: ConvertedImage) => {
    if (!file) return;
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const ext = format === 'png' ? 'png' : 'jpg';
    downloadBlob(img.blob, `${baseName}-page-${img.pageNumber}.${ext}`);
  };

  const downloadAllZip = async () => {
    if (convertedImages.length === 0 || !file) return;
    const zip = new JSZip();
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const ext = format === 'png' ? 'png' : 'jpg';

    convertedImages.forEach((img) => {
      zip.file(`${baseName}-page-${img.pageNumber}.${ext}`, img.blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${baseName}-images.zip`);
    toast.success('ZIP download started');
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setThumbnails([]);
    setSelectedPages([]);
    setConvertedImages([]);
  };

  const selectedCount = selectedPages.filter(Boolean).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
            <ImageDown className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">PDF to Images</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Extract high-resolution images from your PDF pages in PNG or JPG format.
        </p>
      </div>

      {!file ? (
        <Card>
          <CardContent className="p-5 sm:p-7">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file to convert"
              description="Convert pages to PNG or JPG images with custom resolutions"
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
                  {pageCount} {pageCount === 1 ? 'page' : 'pages'} • {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={handleReset}
              disabled={loading || converting}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Change
            </Button>
          </div>

          {/* Desktop File details card */}
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
                      {pageCount} {pageCount === 1 ? 'Page' : 'Pages'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleReset} disabled={loading || converting}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Choose Another File
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Settings and Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Conversion Settings & Pages</CardTitle>
              <CardDescription>
                Select output format, resolution quality, and which pages you wish to extract.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                <div className="space-y-2">
                  <Label>Image Format</Label>
                  <Select value={format} onValueChange={(v: 'png' | 'jpeg') => setFormat(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">PNG (Lossless, sharp text)</SelectItem>
                      <SelectItem value="jpeg">JPG / JPEG (Compact file size)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Resolution Quality</Label>
                  <Select value={String(scale)} onValueChange={(v) => setScale(parseFloat(v))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select resolution" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Standard (72 DPI - Fast)</SelectItem>
                      <SelectItem value="2">High Definition (150 DPI - Recommended)</SelectItem>
                      <SelectItem value="3">Ultra HD (300 DPI - Print Quality)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Page Selection Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-7 sm:h-8 px-2 sm:px-3">
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectOdd} className="text-xs h-7 sm:h-8 px-2">
                    Odd (1,3..)
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectEven} className="text-xs h-7 sm:h-8 px-2">
                    Even (2,4..)
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs h-7 sm:h-8 px-2 sm:px-3">
                    <Square className="h-3.5 w-3.5 mr-1" />
                    Clear
                  </Button>
                  <span className="text-xs text-muted-foreground ml-1">
                    {selectedCount} of {pageCount} selected
                  </span>
                </div>

                <Button
                  onClick={handleConvert}
                  disabled={converting || selectedCount === 0}
                  className="w-full sm:w-auto text-xs sm:text-sm"
                >
                  {converting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <ImageIcon className="h-4 w-4 mr-1.5" />
                  )}
                  Convert {selectedCount} {selectedCount === 1 ? 'Page' : 'Pages'} to {format.toUpperCase()}
                </Button>
              </div>

              {/* Thumbnails grid */}
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">Preparing page thumbnails...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pt-2">
                  {Array.from({ length: pageCount }).map((_, idx) => {
                    const isSelected = selectedPages[idx];
                    const thumb = thumbnails[idx];

                    return (
                      <div
                        key={idx}
                        onClick={() => togglePageSelection(idx)}
                        className={`group relative rounded-xl border-2 p-1.5 cursor-pointer transition-[border-color,box-shadow] bg-card ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/20 shadow-sm'
                            : 'border-border hover:border-primary/40'
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
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-black/45 text-white/80 group-hover:bg-black/65'
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

          {/* Converted Images Gallery */}
          {convertedImages.length > 0 && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Converted Images ({convertedImages.length})</CardTitle>
                    <CardDescription>
                      Download individual images or get all of them packed in a convenient ZIP file.
                    </CardDescription>
                  </div>
                  <Button onClick={downloadAllZip}>
                    <FileArchive className="h-4 w-4 mr-2" />
                    Download All as ZIP
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {convertedImages.map((img) => (
                    <div
                      key={img.pageNumber}
                      className="border rounded-lg p-3 bg-muted/20 flex flex-col justify-between space-y-3"
                    >
                      <div className="aspect-[3/4] bg-card rounded overflow-hidden flex items-center justify-center border">
                        <img
                          src={img.dataUrl}
                          alt={`Converted page ${img.pageNumber}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Page {img.pageNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {img.width} × {img.height}px • {formatFileSize(img.blob.size)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadSingleImage(img)}
                          className="h-8 text-xs"
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mobile Floating Action Bar for Quick Convert */}
          {selectedCount > 0 && convertedImages.length === 0 && (
            <div className="sm:hidden fixed bottom-4 left-3 right-3 z-40">
              <div className="bg-card/95 backdrop-blur-md border border-primary/35 rounded-xl p-2.5 shadow-xl flex items-center justify-between gap-2">
                <div className="text-xs font-semibold pl-1">
                  <span>{selectedCount} of {pageCount} pages</span>
                </div>
                <Button
                  onClick={handleConvert}
                  disabled={converting}
                  size="sm"
                  className="text-xs h-8 px-3 shadow-xs"
                >
                  {converting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 mr-1" />
                  )}
                  Convert to {format.toUpperCase()}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
