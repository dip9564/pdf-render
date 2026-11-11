import React, { useState, useCallback, useMemo } from 'react';
import { pdfjsLib } from '@/lib/pdfWorker';
import { createWorker } from 'tesseract.js';
import {
  FileText,
  Copy,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Search,
  FileCode,
  Scan,
  Sparkles,
  AlertTriangle,
  Languages,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileUploader } from '@/components/shared/FileUploader';
import { readFileAsArrayBuffer, formatFileSize } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PageText {
  pageNumber: number;
  text: string;
  wordCount: number;
  source: 'digital' | 'ocr' | 'empty';
  isOcrRunning?: boolean;
}

const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish (Español)' },
  { code: 'fra', label: 'French (Français)' },
  { code: 'deu', label: 'German (Deutsch)' },
  { code: 'ita', label: 'Italian (Italiano)' },
  { code: 'por', label: 'Portuguese (Português)' },
  { code: 'hin', label: 'Hindi (हिन्दी)' },
  { code: 'chi_sim', label: 'Chinese (简体中文)' },
  { code: 'jpn', label: 'Japanese (日本語)' },
];

export default function ExtractText() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [pagesText, setPagesText] = useState<PageText[]>([]);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedPageIdx, setCopiedPageIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'pages' | 'all'>('pages');

  // OCR States
  const [ocrLanguage, setOcrLanguage] = useState<string>('eng');
  const [isBatchOcrRunning, setIsBatchOcrRunning] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);

  // Render a PDF page onto an HTMLCanvasElement for OCR
  const renderPdfPageToCanvas = async (
    pdfDoc: any,
    pageNum: number,
    scale = 2.0
  ): Promise<HTMLCanvasElement> => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  };

  const handleFileSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    setFile(f);
    setLoading(true);
    setPagesText([]);

    try {
      const buffer = await readFileAsArrayBuffer(f);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const extracted: PageText[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        // Group text items by line (using vertical 'y' coordinate in transform)
        let lastY: number | null = null;
        let lineStrings: string[] = [];
        let lines: string[] = [];

        for (const item of content.items as any[]) {
          if (!('str' in item)) continue;
          const y = Math.round(item.transform[5]);

          if (lastY !== null && Math.abs(y - lastY) > 5) {
            lines.push(lineStrings.join(' '));
            lineStrings = [];
          }

          if (item.str.trim()) {
            lineStrings.push(item.str);
          }
          lastY = y;
        }

        if (lineStrings.length > 0) {
          lines.push(lineStrings.join(' '));
        }

        const pageRawText = lines.join('\n').trim();
        const words = pageRawText ? pageRawText.split(/\s+/).filter(Boolean).length : 0;
        const isEmpty = !pageRawText || pageRawText.length < 5;

        extracted.push({
          pageNumber: i,
          text: isEmpty ? '(No selectable digital text — scan with OCR below)' : pageRawText,
          wordCount: words,
          source: isEmpty ? 'empty' : 'digital',
        });
      }

      setPagesText(extracted);
      const emptyCount = extracted.filter((p) => p.source === 'empty').length;
      if (emptyCount > 0) {
        toast.info(
          `Extracted text: ${emptyCount} of ${pdf.numPages} pages appear to be scanned. OCR is available below.`,
          { duration: 5000 }
        );
      } else {
        toast.success(`Extracted digital text from all ${pdf.numPages} pages!`);
      }
    } catch (err) {
      console.error('Failed to extract text', err);
      toast.error('Failed to parse document text');
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run OCR on a single specific page
  const handleRunOcrSinglePage = async (pageIndex: number) => {
    if (!file) return;

    setPagesText((prev) =>
      prev.map((p, idx) => (idx === pageIndex ? { ...p, isOcrRunning: true } : p))
    );
    toast.info(`Starting OCR recognition on Page ${pageIndex + 1}...`);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const canvas = await renderPdfPageToCanvas(pdf, pageIndex + 1, 2.0);

      const worker = await createWorker(ocrLanguage);
      const ret = await worker.recognize(canvas);
      await worker.terminate();

      const ocrText = ret.data.text.trim();
      const words = ocrText ? ocrText.split(/\s+/).filter(Boolean).length : 0;

      setPagesText((prev) =>
        prev.map((p, idx) =>
          idx === pageIndex
            ? {
                ...p,
                text: ocrText || '(OCR Scan completed: No readable text detected)',
                wordCount: words,
                source: 'ocr',
                isOcrRunning: false,
              }
            : p
        )
      );

      toast.success(`OCR complete for Page ${pageIndex + 1}! (${words} words found)`);
    } catch (err) {
      console.error('OCR single page error:', err);
      toast.error(`OCR failed on Page ${pageIndex + 1}`);
      setPagesText((prev) =>
        prev.map((p, idx) => (idx === pageIndex ? { ...p, isOcrRunning: false } : p))
      );
    }
  };

  // Run Batch OCR across all pages or scanned pages
  const handleRunBatchOcr = async (onlyScannedPages = false) => {
    if (!file || pagesText.length === 0) return;

    const targets = onlyScannedPages
      ? pagesText.filter((p) => p.source === 'empty')
      : pagesText;

    if (targets.length === 0) {
      toast.info('No scanned pages found to process.');
      return;
    }

    setIsBatchOcrRunning(true);
    setBatchProgress({ current: 0, total: targets.length, percent: 0 });
    toast.info(`Initializing OCR engine for ${targets.length} pages...`);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const worker = await createWorker(ocrLanguage);

      for (let i = 0; i < targets.length; i++) {
        const targetPage = targets[i];
        setBatchProgress({
          current: i + 1,
          total: targets.length,
          percent: Math.round(((i + 1) / targets.length) * 100),
        });

        const canvas = await renderPdfPageToCanvas(pdf, targetPage.pageNumber, 2.0);
        const ret = await worker.recognize(canvas);
        const ocrText = ret.data.text.trim();
        const words = ocrText ? ocrText.split(/\s+/).filter(Boolean).length : 0;

        setPagesText((prev) =>
          prev.map((p) =>
            p.pageNumber === targetPage.pageNumber
              ? {
                  ...p,
                  text: ocrText || '(OCR completed: No readable text detected)',
                  wordCount: words,
                  source: 'ocr',
                }
              : p
          )
        );
      }

      await worker.terminate();
      toast.success(`Batch OCR scan complete for all ${targets.length} pages!`);
    } catch (err) {
      console.error('Batch OCR error:', err);
      toast.error('Batch OCR encountered an error. Please try again.');
    } finally {
      setIsBatchOcrRunning(false);
      setBatchProgress(null);
    }
  };

  // Total metrics
  const totalWords = useMemo(
    () => pagesText.reduce((acc, p) => acc + p.wordCount, 0),
    [pagesText]
  );
  const scannedPagesCount = useMemo(
    () => pagesText.filter((p) => p.source === 'empty').length,
    [pagesText]
  );
  const ocrPagesCount = useMemo(
    () => pagesText.filter((p) => p.source === 'ocr').length,
    [pagesText]
  );

  const fullDocumentText = useMemo(
    () =>
      pagesText
        .map((p) => `--- Page ${p.pageNumber} (${p.source.toUpperCase()}) ---\n\n${p.text}`)
        .join('\n\n'),
    [pagesText]
  );

  const fullMarkdownText = useMemo(
    () =>
      pagesText
        .map((p) => `## Page ${p.pageNumber}\n\n${p.text}`)
        .join('\n\n'),
    [pagesText]
  );

  // Copy full text
  const handleCopyAll = () => {
    navigator.clipboard.writeText(fullDocumentText);
    setCopiedAll(true);
    toast.success('All extracted text copied to clipboard!');
    setTimeout(() => setCopiedAll(false), 2000);
  };

  // Copy individual page
  const handleCopyPage = (pIdx: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPageIdx(pIdx);
    toast.success(`Page ${pIdx + 1} copied!`);
    setTimeout(() => setCopiedPageIdx(null), 2000);
  };

  // Download TXT
  const handleDownloadTxt = () => {
    if (!file) return;
    const blob = new Blob([fullDocumentText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    link.href = url;
    link.download = `${baseName}_extracted.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded as .TXT file');
  };

  // Download Markdown
  const handleDownloadMd = () => {
    if (!file) return;
    const blob = new Blob([fullMarkdownText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    link.href = url;
    link.download = `${baseName}_extracted.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded as .MD file');
  };

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return pagesText;
    const q = searchQuery.toLowerCase();
    return pagesText.filter((p) => p.text.toLowerCase().includes(q));
  }, [pagesText, searchQuery]);

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-4xl">
      <div className="mb-4 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Extract Text &amp; OCR</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Extract digital text or run optical character recognition (OCR) on scanned documents — 100% in your browser.
        </p>
      </div>

      {!file ? (
        <Card>
          <CardContent className="p-5 sm:p-7">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select PDF to Extract Text or OCR"
              description="Extracts digital text or scans image PDFs with Tesseract OCR"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* File details & Stats Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-xs shrink-0">
                PDF
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold truncate max-w-[200px] sm:max-w-md">
                  {file.name}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                  <span>{pagesText.length} pages</span>
                  <span>•</span>
                  <span>{totalWords.toLocaleString()} words</span>
                  <span>•</span>
                  <span>{formatFileSize(file.size)}</span>
                  {ocrPagesCount > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {ocrPagesCount} OCR scanned
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => {
                setFile(null);
                setPagesText([]);
                setSearchQuery('');
              }}
              disabled={loading || isBatchOcrRunning}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Change Document
            </Button>
          </div>

          {/* Scanned Document Alert Banner */}
          {scannedPagesCount > 0 && !isBatchOcrRunning && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start sm:items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5 sm:mt-0" />
                <div className="text-xs">
                  <p className="font-semibold text-foreground">
                    Scanned PDF Pages Detected ({scannedPagesCount} pages without digital text)
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    These pages contain images rather than selectable text. Run OCR to recognize the characters.
                  </p>
                </div>
              </div>

              <Button
                size="sm"
                className="text-xs h-8 px-3 shrink-0 self-end sm:self-auto touch-manipulation"
                onClick={() => handleRunBatchOcr(true)}
              >
                <Scan className="h-3.5 w-3.5 mr-1.5" />
                OCR Scanned Pages ({scannedPagesCount})
              </Button>
            </div>
          )}

          {/* Batch OCR Progress Indicator */}
          {isBatchOcrRunning && batchProgress && (
            <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-semibold">
                    Running OCR Scanner on Page {batchProgress.current} of {batchProgress.total}...
                  </span>
                </div>
                <span className="font-bold text-primary">
                  {batchProgress.percent}%
                </span>
              </div>
              <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${batchProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {loading ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-xs sm:text-sm">Reading and extracting text from PDF pages...</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Controls & Quick Action Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search inside extracted text..."
                    className="h-8 text-xs pl-8 pr-3"
                  />
                </div>

                {/* OCR Language Selector */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={ocrLanguage} onValueChange={setOcrLanguage}>
                    <SelectTrigger className="h-8 text-xs w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OCR_LANGUAGES.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code} className="text-xs">
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    onClick={() => handleRunBatchOcr(false)}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5 text-primary border-primary/30 bg-primary/5 hover:bg-primary/10"
                    disabled={isBatchOcrRunning}
                    title="Run OCR across all pages"
                  >
                    <Scan className="h-3.5 w-3.5 mr-1" />
                    OCR All
                  </Button>
                </div>

                {/* Export Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    onClick={handleCopyAll}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5"
                  >
                    {copiedAll ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500 mr-1" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 mr-1" />
                    )}
                    Copy All
                  </Button>
                  <Button
                    onClick={handleDownloadTxt}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    .TXT
                  </Button>
                  <Button
                    onClick={handleDownloadMd}
                    size="sm"
                    className="h-8 text-xs px-2.5"
                  >
                    <FileCode className="h-3.5 w-3.5 mr-1" />
                    .MD
                  </Button>
                </div>
              </div>

              {/* View Selector */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('pages')}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      viewMode === 'pages'
                        ? 'bg-card text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Page by Page ({filteredPages.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      viewMode === 'all'
                        ? 'bg-card text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Combined Document
                  </button>
                </div>

                {searchQuery && (
                  <span className="text-[11px] text-muted-foreground">
                    Matching {filteredPages.length} of {pagesText.length} pages
                  </span>
                )}
              </div>

              {/* Text Display */}
              {viewMode === 'pages' ? (
                <div className="space-y-3">
                  {filteredPages.map((p) => {
                    const pageIdx = p.pageNumber - 1;
                    return (
                      <Card key={p.pageNumber} className="border shadow-xs">
                        <CardHeader className="py-2.5 px-3.5 border-b bg-muted/20 flex flex-wrap items-center justify-between gap-2 space-y-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs font-semibold">
                              Page {p.pageNumber}
                            </Badge>

                            {p.source === 'ocr' ? (
                              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] h-5 py-0">
                                <Sparkles className="h-3 w-3 mr-1" />
                                OCR Recognized
                              </Badge>
                            ) : p.source === 'digital' ? (
                              <Badge variant="secondary" className="text-[10px] h-5 py-0">
                                Digital Text
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-amber-500 border-amber-500/30 text-[10px] h-5 py-0"
                              >
                                Scanned Page
                              </Badge>
                            )}

                            <span className="text-[11px] text-muted-foreground">
                              {p.wordCount} words
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {/* Run OCR on this specific page */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRunOcrSinglePage(pageIdx)}
                              disabled={p.isOcrRunning || isBatchOcrRunning}
                              className="h-6 text-[11px] px-2 text-primary border-primary/30 hover:bg-primary/10"
                            >
                              {p.isOcrRunning ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  Scanning...
                                </>
                              ) : (
                                <>
                                  <Scan className="h-3 w-3 mr-1" />
                                  {p.source === 'ocr' ? 'Re-run OCR' : 'Scan Page (OCR)'}
                                </>
                              )}
                            </Button>

                            {/* Copy Page */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopyPage(pageIdx, p.text)}
                              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                            >
                              {copiedPageIdx === pageIdx ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-500 mr-1" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copy
                                </>
                              )}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-3.5">
                          {p.isOcrRunning ? (
                            <div className="py-8 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                              <Loader2 className="h-6 w-6 animate-spin text-primary" />
                              <p className="text-xs">
                                Extracting text from image using Tesseract OCR...
                              </p>
                            </div>
                          ) : (
                            <pre
                              className={cn(
                                'text-xs font-mono leading-relaxed whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto',
                                p.source === 'empty'
                                  ? 'text-muted-foreground/60 italic'
                                  : 'text-foreground/90'
                              )}
                            >
                              {p.text}
                            </pre>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="border shadow-xs">
                  <CardContent className="p-4">
                    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/90 max-h-[500px] overflow-y-auto">
                      {fullDocumentText}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
