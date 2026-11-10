import React, { useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  FileText,
  Copy,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Search,
  BookOpen,
  FileCode,
  AlignLeft,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileUploader } from '@/components/shared/FileUploader';
import { readFileAsArrayBuffer, formatFileSize } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PageText {
  pageNumber: number;
  text: string;
  wordCount: number;
}

export default function ExtractText() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [pagesText, setPagesText] = useState<PageText[]>([]);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedPageIdx, setCopiedPageIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'pages' | 'all'>('pages');

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

        extracted.push({
          pageNumber: i,
          text: pageRawText || '(No selectable text found on this page)',
          wordCount: words,
        });
      }

      setPagesText(extracted);
      toast.success(`Extracted text from ${pdf.numPages} pages!`);
    } catch (err) {
      console.error('Failed to extract text', err);
      toast.error('Failed to extract text from document');
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Total metrics
  const totalWords = useMemo(
    () => pagesText.reduce((acc, p) => acc + p.wordCount, 0),
    [pagesText]
  );
  const fullDocumentText = useMemo(
    () =>
      pagesText
        .map((p) => `--- Page ${p.pageNumber} ---\n\n${p.text}`)
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
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
          <FileText className="h-7 w-7 text-sky-500" />
          Extract Text & Markdown
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          Extract raw text or clean Markdown from any PDF document without sending data to servers.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-6 sm:p-8">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select PDF to Extract Text"
              description="Extracts all selectable text with page numbers & formatting"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* File details & Stats Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-sky-500/10 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                PDF
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold truncate max-w-[200px] sm:max-w-md">{file.name}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{pagesText.length} pages</span>
                  <span>•</span>
                  <span>{totalWords.toLocaleString()} words</span>
                  <span>•</span>
                  <span>{formatFileSize(file.size)}</span>
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
              disabled={loading}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Change Document
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
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

                {/* Export Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    onClick={handleCopyAll}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5"
                  >
                    {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-500 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
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
                    className="h-8 text-xs px-2.5 bg-sky-600 hover:bg-sky-700 text-white"
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
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                      viewMode === 'pages' ? 'bg-background shadow-xs font-semibold' : 'text-muted-foreground'
                    )}
                  >
                    Page by Page ({filteredPages.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                      viewMode === 'all' ? 'bg-background shadow-xs font-semibold' : 'text-muted-foreground'
                    )}
                  >
                    Combined Text
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
                  {filteredPages.map((p, idx) => (
                    <Card key={p.pageNumber} className="border shadow-xs">
                      <CardHeader className="py-2.5 px-3.5 border-b bg-muted/20 flex flex-row items-center justify-between space-y-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs font-semibold">
                            Page {p.pageNumber}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {p.wordCount} words
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyPage(p.pageNumber - 1, p.text)}
                          className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                        >
                          {copiedPageIdx === p.pageNumber - 1 ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-500 mr-1" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3 mr-1" />
                              Copy Page
                            </>
                          )}
                        </Button>
                      </CardHeader>
                      <CardContent className="p-3.5">
                        <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/90 max-h-[300px] overflow-y-auto">
                          {p.text}
                        </pre>
                      </CardContent>
                    </Card>
                  ))}
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
