import { useState, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { toast } from 'sonner';
import { FileUploader } from '@/components/shared/FileUploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import {
  Minimize2,
  Download,
  RotateCcw,
  AlertTriangle,
  Info,
  CheckCircle2,
  ArrowDown,
  Loader2,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

type CompressionLevel = 'low' | 'medium' | 'high';

interface CompressionConfig {
  scale: number;
  quality: number;
  label: string;
  description: string;
}

const COMPRESSION_CONFIGS: Record<CompressionLevel, CompressionConfig> = {
  low: {
    scale: 2.0,
    quality: 0.85,
    label: 'Low Compression',
    description: 'Best quality, minimal size reduction',
  },
  medium: {
    scale: 1.5,
    quality: 0.65,
    label: 'Medium Compression',
    description: 'Balanced quality and size reduction',
  },
  high: {
    scale: 1.0,
    quality: 0.45,
    label: 'High Compression',
    description: 'Maximum size reduction, lower quality',
  },
};

interface CompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  reductionPercent: number;
  isLarger: boolean;
}

export default function CompressPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>('medium');
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [originalPdfBytes, setOriginalPdfBytes] = useState<ArrayBuffer | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const selectedFile = files[0];
    setFile(selectedFile);
    setResult(null);
    setProgress(0);
    setProgressMessage('');

    try {
      const buffer = await readFileAsArrayBuffer(selectedFile);
      setOriginalPdfBytes(buffer);
      toast.success(`Loaded "${selectedFile.name}" (${formatFileSize(selectedFile.size)})`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to read the PDF file.');
      setFile(null);
    }
  }, []);

  const handleRemoveFile = useCallback(() => {
    setFile(null);
    setOriginalPdfBytes(null);
    setResult(null);
    setProgress(0);
    setProgressMessage('');
  }, []);

  const compressPdf = useCallback(async () => {
    if (!originalPdfBytes || !file) return;

    setIsCompressing(true);
    setProgress(0);
    setResult(null);

    try {
      const config = COMPRESSION_CONFIGS[compressionLevel];

      setProgressMessage('Loading PDF...');
      setProgress(5);

      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(originalPdfBytes) }).promise;
      const totalPages = pdfDoc.numPages;

      setProgressMessage(`Processing ${totalPages} page${totalPages !== 1 ? 's' : ''}...`);
      setProgress(10);

      const newPdfDoc = await PDFDocument.create();

      for (let i = 1; i <= totalPages; i++) {
        setProgressMessage(`Rendering page ${i} of ${totalPages}...`);
        setProgress(10 + Math.round((i / totalPages) * 75));

        const page = await pdfDoc.getPage(i);
        const originalViewport = page.getViewport({ scale: 1.0 });
        const renderViewport = page.getViewport({ scale: config.scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;

        await page.render({ canvasContext: context, viewport: renderViewport }).promise;

        const jpegDataUrl = canvas.toDataURL('image/jpeg', config.quality);
        const jpegResponse = await fetch(jpegDataUrl);
        const jpegBytes = await jpegResponse.arrayBuffer();

        const jpegImage = await newPdfDoc.embedJpg(new Uint8Array(jpegBytes));

        const newPage = newPdfDoc.addPage([originalViewport.width, originalViewport.height]);
        newPage.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: originalViewport.width,
          height: originalViewport.height,
        });
      }

      setProgressMessage('Saving compressed PDF...');
      setProgress(90);

      const compressedBytes = await newPdfDoc.save();
      const compressedBlob = createPdfBlob(compressedBytes);

      pdfDoc.destroy();

      const originalSize = file.size;
      const compressedSize = compressedBlob.size;
      const reductionPercent = Math.round(((originalSize - compressedSize) / originalSize) * 100);
      const isLarger = compressedSize >= originalSize;

      setResult({
        blob: compressedBlob,
        originalSize,
        compressedSize,
        reductionPercent,
        isLarger,
      });

      setProgress(100);
      setProgressMessage('Compression complete!');

      if (isLarger) {
        toast.warning('Compressed file is larger than the original. The original PDF may already be well-optimized.');
      } else {
        toast.success(`Compressed successfully! Reduced by ${reductionPercent}%`);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to compress the PDF. Please try again.');
      setProgress(0);
      setProgressMessage('');
    } finally {
      setIsCompressing(false);
    }
  }, [originalPdfBytes, file, compressionLevel]);

  const handleDownload = useCallback(
    (useOriginal: boolean = false) => {
      if (!file) return;

      if (useOriginal && originalPdfBytes) {
        const blob = new Blob([originalPdfBytes], { type: 'application/pdf' });
        downloadBlob(blob, file.name);
        toast.success('Downloaded original PDF.');
        return;
      }

      if (result) {
        const name = file.name.replace(/\.pdf$/i, '') + '_compressed.pdf';
        downloadBlob(result.blob, name);
        toast.success('Downloaded compressed PDF.');
      }
    },
    [file, result, originalPdfBytes]
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setOriginalPdfBytes(null);
    setResult(null);
    setProgress(0);
    setProgressMessage('');
    setCompressionLevel('medium');
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10 text-red-500 mb-4">
          <Minimize2 className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Compress PDF</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Reduce your PDF file size with adjustable compression levels. All processing happens in your browser.
        </p>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border bg-blue-500/5 border-blue-500/20 p-4 mb-8">
        <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">How compression works</p>
          <p>
            This tool re-renders each page as a JPEG image at the selected quality level. Compression results depend on
            the PDF's contents — files with many images compress well, while text-heavy or already optimized PDFs may see
            minimal reduction or even a slight size increase.
          </p>
        </div>
      </div>

      {/* Upload */}
      {!file && (
        <FileUploader
          accept=".pdf,application/pdf"
          multiple={false}
          maxFiles={1}
          maxSize={200 * 1024 * 1024}
          onFilesSelected={handleFilesSelected}
          label="Upload PDF"
          description="Drag & drop your PDF file here, or click to browse"
          showFileList={false}
        />
      )}

      {/* Main Content */}
      {file && (
        <div className="space-y-6">
          {/* File Info */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <Minimize2 className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="font-medium text-sm truncate max-w-xs">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Original size: <span className="font-semibold text-foreground">{formatFileSize(file.size)}</span>
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={isCompressing}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </CardContent>
          </Card>

          {/* Compression Level Selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">Compression Level</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(Object.keys(COMPRESSION_CONFIGS) as CompressionLevel[]).map((level) => {
                const config = COMPRESSION_CONFIGS[level];
                const isSelected = compressionLevel === level;
                return (
                  <button
                    key={level}
                    onClick={() => setCompressionLevel(level)}
                    disabled={isCompressing}
                    className={cn(
                      'relative flex flex-col items-start rounded-lg border-2 p-4 text-left transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-muted hover:border-primary/30',
                      isCompressing && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={cn(
                          'w-3 h-3 rounded-full border-2',
                          isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                        )}
                      />
                      <span className="font-medium text-sm">{config.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-5">{config.description}</p>
                    <div className="mt-2 ml-5 flex gap-3 text-xs text-muted-foreground">
                      <span>Scale: {config.scale}x</span>
                      <span>Quality: {Math.round(config.quality * 100)}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compress Button */}
          {!result && (
            <Button
              onClick={compressPdf}
              disabled={isCompressing}
              className="w-full"
              size="lg"
            >
              {isCompressing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Compressing...
                </>
              ) : (
                <>
                  <Minimize2 className="h-4 w-4 mr-2" />
                  Compress PDF
                </>
              )}
            </Button>
          )}

          {/* Progress */}
          {isCompressing && (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{progressMessage}</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              {/* Size Comparison */}
              <Card className={result.isLarger ? 'border-amber-500/40' : 'border-green-500/40'}>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    {result.isLarger ? (
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    <h3 className="font-semibold">
                      {result.isLarger ? 'Compressed File is Larger' : 'Compression Successful'}
                    </h3>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Original</p>
                      <p className="text-lg font-bold">{formatFileSize(result.originalSize)}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <ArrowDown
                        className={cn(
                          'h-6 w-6',
                          result.isLarger ? 'text-amber-500 rotate-180' : 'text-green-500'
                        )}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Compressed</p>
                      <p className="text-lg font-bold">{formatFileSize(result.compressedSize)}</p>
                    </div>
                  </div>

                  <div className="mt-4 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium',
                        result.isLarger
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-green-500/10 text-green-600'
                      )}
                    >
                      {result.isLarger
                        ? `+${Math.abs(result.reductionPercent)}% larger`
                        : `${result.reductionPercent}% smaller`}
                    </span>
                  </div>

                  {result.isLarger && (
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      The original PDF is already well-optimized. You can download the original instead.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Download Buttons */}
              <div className={cn('grid gap-3', result.isLarger ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
                <Button onClick={() => handleDownload(false)} size="lg">
                  <Download className="h-4 w-4 mr-2" />
                  Download Compressed PDF
                </Button>
                {result.isLarger && (
                  <Button variant="outline" onClick={() => handleDownload(true)} size="lg">
                    <Download className="h-4 w-4 mr-2" />
                    Download Original PDF
                  </Button>
                )}
              </div>

              {/* Compress Again */}
              <Button variant="ghost" className="w-full" onClick={() => setResult(null)}>
                Try a different compression level
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
