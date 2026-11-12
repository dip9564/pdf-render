import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDown,
  Bookmark,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  Link2,
  Loader2,
  Lock,
  Minimize2,
  Paperclip,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  XCircle,
} from 'lucide-react';
import { FileUploader } from '@/components/shared/FileUploader';
import { BeforeAfterPreview } from '@/components/compress/BeforeAfterPreview';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn, createPdfBlob, downloadBlob, formatFileSize, readFileAsArrayBuffer } from '@/lib/utils';
import {
  COMPRESSION_PRESETS,
  CompressionMode,
  DEFAULT_COMPRESSION_MODE,
} from '@/lib/compressPdf/config';
import {
  DocumentClassification,
  PdfAnalysisSummary,
  PdfCompressionError,
} from '@/lib/compressPdf/analyzer';
import { CompressionExecutionResult } from '@/lib/compressPdf/compressorEngine';
import { compressPdfClient } from '@/lib/compressPdf/compressClient';

const MODE_ORDER: CompressionMode[] = ['low', 'recommended', 'extreme'];

const CLASSIFICATION_LABELS: Record<DocumentClassification, { label: string; tone: string }> = {
  'text-only': {
    label: 'Text-Only Document',
    tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
  },
  scanned: {
    label: 'Scanned PDF',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  },
  'image-heavy': {
    label: 'Image-Heavy Document',
    tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
  },
  'mixed-content': {
    label: 'Mixed Text & Images',
    tone: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/25',
  },
  'vector-rich': {
    label: 'Vector Graphics / CAD',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatReductionPercent(pct: number): string {
  if (pct <= 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

export default function CompressPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string>('');
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);

  // Mode & options
  const [mode, setMode] = useState<CompressionMode>(DEFAULT_COMPRESSION_MODE);
  const [keepPasswordProtection, setKeepPasswordProtection] = useState<boolean>(true);
  const [allowSignedModification, setAllowSignedModification] = useState<boolean>(false);

  // Password flow state
  const [needsPassword, setNeedsPassword] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [activePassword, setActivePassword] = useState<string | undefined>(undefined);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Execution states
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [analysis, setAnalysis] = useState<PdfAnalysisSummary | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [result, setResult] = useState<CompressionExecutionResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      compressPdfClient.clearFileCache();
    };
  }, []);

  const runAnalysis = useCallback(
    async (bytes: Uint8Array, id: string, password?: string) => {
      abortControllerRef.current?.abort();
      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      setIsAnalyzing(true);
      setAnalysisError(null);
      setPasswordError(null);
      setProgress(4);
      setProgressMessage('Inspecting PDF structure & embedded assets...');

      try {
        const summary = await compressPdfClient.analyze(bytes, {
          fileId: id,
          password,
          signal: ctrl.signal,
          onProgress: (p, msg) => {
            setProgress(p);
            setProgressMessage(msg);
          },
        });

        setAnalysis(summary);
        setNeedsPassword(false);
        setActivePassword(password);
        setAllowSignedModification(false);
        setProgress(0);
        setProgressMessage('');
      } catch (err: unknown) {
        if (err instanceof PdfCompressionError) {
          if (err.code === 'CANCELLED') {
            setProgress(0);
            setProgressMessage('');
            return;
          }
          if (err.code === 'PASSWORD_REQUIRED') {
            setNeedsPassword(true);
            setAnalysis(null);
            setPasswordError(null);
            setProgress(0);
            setProgressMessage('');
            return;
          }
          if (err.code === 'INCORRECT_PASSWORD') {
            setNeedsPassword(true);
            setAnalysis(null);
            setPasswordError('Incorrect password. Please check and try again.');
            toast.error('Incorrect PDF password.');
            return;
          }
          setAnalysisError(err.message);
          toast.error(err.message);
        } else {
          const msg = err instanceof Error ? err.message : 'Unable to analyze PDF file.';
          setAnalysisError(msg);
          toast.error(msg);
        }
      } finally {
        setIsAnalyzing(false);
        if (abortControllerRef.current === ctrl) {
          abortControllerRef.current = null;
        }
      }
    },
    []
  );

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const selectedFile = files[0];
      const nextId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      compressPdfClient.clearFileCache();
      setFile(selectedFile);
      setFileId(nextId);
      setResult(null);
      setAnalysis(null);
      setAnalysisError(null);
      setNeedsPassword(false);
      setPasswordInput('');
      setActivePassword(undefined);
      setPasswordError(null);
      setAllowSignedModification(false);
      setKeepPasswordProtection(true);

      try {
        const buffer = await readFileAsArrayBuffer(selectedFile);
        const bytes = new Uint8Array(buffer);
        setOriginalBytes(bytes);
        await runAnalysis(bytes, nextId);
      } catch (err) {
        console.error(err);
        toast.error('Failed to read the selected PDF file.');
        setFile(null);
        setOriginalBytes(null);
      }
    },
    [runAnalysis]
  );

  const handleUnlockWithPassword = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!originalBytes || !fileId) return;
      if (!passwordInput) {
        setPasswordError('Please enter the document password.');
        return;
      }
      await runAnalysis(originalBytes, fileId, passwordInput);
    },
    [originalBytes, fileId, passwordInput, runAnalysis]
  );

  const handleCompress = useCallback(async () => {
    if (!originalBytes || !fileId || !analysis) return;

    if (analysis.isDigitallySigned && !allowSignedModification) {
      toast.warning('Please confirm the digital signature warning before compressing.');
      return;
    }

    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    setIsCompressing(true);
    setResult(null);
    setProgress(5);
    setProgressMessage(`Preparing ${COMPRESSION_PRESETS[mode].label}...`);

    try {
      const execResult = await compressPdfClient.compress(originalBytes, {
        fileId,
        mode,
        password: activePassword,
        allowModifyingSignedPdf: allowSignedModification,
        preservePasswordProtectionOnEncryptedPdf: keepPasswordProtection,
        signal: ctrl.signal,
        onProgress: (p, msg) => {
          setProgress(p);
          setProgressMessage(msg);
        },
      });

      setResult(execResult);
      setProgress(100);
      setProgressMessage('Compression & validation complete.');

      if (execResult.status === 'retained-original') {
        toast.info('Original PDF retained — file is already tightly optimized.');
      } else if (execResult.status === 'minimal-reduction') {
        toast.info(
          `Saved ${formatReductionPercent(execResult.reductionPercent)} (${formatFileSize(execResult.reductionBytes)}).`
        );
      } else {
        toast.success(
          `Compressed by ${formatReductionPercent(execResult.reductionPercent)} (saved ${formatFileSize(execResult.reductionBytes)})!`
        );
      }
    } catch (err: unknown) {
      if (err instanceof PdfCompressionError && err.code === 'CANCELLED') {
        setProgress(0);
        setProgressMessage('');
        toast.info('Compression cancelled.');
        return;
      }
      const message =
        err instanceof Error ? err.message : 'PDF compression failed unexpectedly.';
      toast.error(message);
      setProgress(0);
      setProgressMessage('');
    } finally {
      setIsCompressing(false);
      if (abortControllerRef.current === ctrl) {
        abortControllerRef.current = null;
      }
    }
  }, [
    originalBytes,
    fileId,
    analysis,
    allowSignedModification,
    mode,
    activePassword,
    keepPasswordProtection,
  ]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handleReset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    compressPdfClient.clearFileCache();
    setFile(null);
    setFileId('');
    setOriginalBytes(null);
    setAnalysis(null);
    setAnalysisError(null);
    setResult(null);
    setNeedsPassword(false);
    setPasswordInput('');
    setActivePassword(undefined);
    setPasswordError(null);
    setAllowSignedModification(false);
    setProgress(0);
    setProgressMessage('');
    setMode(DEFAULT_COMPRESSION_MODE);
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const blob = createPdfBlob(result.outputBytes);
    const baseName = file.name.replace(/\.pdf$/i, '');
    const outName =
      result.status === 'retained-original'
        ? `${baseName}.pdf`
        : `${baseName}_compressed.pdf`;
    downloadBlob(blob, outName);
    toast.success(`Downloaded "${outName}"`);
  }, [result, file]);

  const activePreset = useMemo(() => COMPRESSION_PRESETS[mode], [mode]);
  const classificationBadge = analysis ? CLASSIFICATION_LABELS[analysis.classification] : null;
  const isBusy = isAnalyzing || isCompressing;

  return (
    <div className="container mx-auto px-3.5 sm:px-6 py-7 sm:py-10 max-w-5xl overflow-x-hidden">
      {/* Page Header */}
      <div className="text-center mb-7 sm:mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400 border border-indigo-500/15 mb-3.5 shadow-sm">
          <Minimize2 className="h-6 w-6" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
          Compress PDF
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Smart PDF optimization engine that shrinks embedded images, deduplicates resources, and
          recompresses streams while preserving crisp text, vectors, links, and bookmarks.
        </p>
        <div className="mt-3 hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
          <ShieldCheck className="h-3.5 w-3.5 text-teal shrink-0" />
          <span>100% Client-Side • QPDF WASM + Adaptive Image Engine</span>
        </div>
      </div>

      {/* Upload State */}
      {!file && (
        <FileUploader
          accept=".pdf,application/pdf"
          multiple={false}
          maxFiles={1}
          maxSize={250 * 1024 * 1024}
          onFilesSelected={handleFilesSelected}
          label="Drop a PDF to inspect & compress"
          description="Supports scanned PDFs, mixed reports, forms, bookmarks, vector graphics, and password-protected documents"
          showFileList={false}
        />
      )}

      {/* Workspace when file loaded */}
      {file && (
        <div className="space-y-5 sm:space-y-6">
          {/* File Summary Header */}
          <Card className="border-border bg-card shadow-card">
            <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <FileArchive className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm sm:text-base text-foreground truncate max-w-[220px] sm:max-w-md">
                      {file.name}
                    </p>
                    {classificationBadge && (
                      <Badge
                        variant="outline"
                        className={cn('text-[11px] font-medium', classificationBadge.tone)}
                      >
                        {classificationBadge.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <span>
                      Original size:{' '}
                      <strong className="font-semibold text-foreground tabular-nums">
                        {formatFileSize(file.size)}
                      </strong>
                    </span>
                    {analysis && (
                      <>
                        <span>•</span>
                        <span>
                          {analysis.pageCount} {analysis.pageCount === 1 ? 'page' : 'pages'}
                        </span>
                        <span>•</span>
                        <span>PDF {analysis.pdfVersion}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isBusy}
                className="shrink-0 h-9"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Change
              </Button>
            </CardContent>
          </Card>

          {/* Password Entry Prompt */}
          {needsPassword && !analysis && (
            <Card className="border-indigo-500/30 bg-card shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary shrink-0" />
                  Password-Protected PDF
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  This document requires a password to decrypt and optimize its structure cleanly in
                  your browser.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleUnlockWithPassword}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                >
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={passwordInput}
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        if (passwordError) setPasswordError(null);
                      }}
                      placeholder="Enter PDF open password..."
                      aria-label="PDF password"
                      disabled={isAnalyzing}
                      className="pr-10 h-10"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    type="submit"
                    disabled={isAnalyzing || !passwordInput}
                    className="h-10 shrink-0"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Unlocking...
                      </>
                    ) : (
                      <>
                        <Unlock className="h-4 w-4 mr-2" />
                        Unlock &amp; Analyze
                      </>
                    )}
                  </Button>
                </form>
                {passwordError && (
                  <p className="mt-2.5 text-xs font-medium text-destructive flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    {passwordError}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Analysis Failure State */}
          {analysisError && !analysis && !isAnalyzing && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="p-5 flex items-start gap-3">
                <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-foreground">Unable to process this PDF</p>
                  <p className="text-muted-foreground mt-1 text-xs sm:text-sm">{analysisError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Progress Banner during Analyzing or Compressing */}
          {isBusy && (
            <Card className="border-primary/25 bg-card shadow-card">
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {progressMessage || 'Processing...'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="text-xs font-semibold tabular-nums text-primary">
                      {progress}%
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCancel}
                      className="h-8 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
                <div className="w-full bg-surface-secondary dark:bg-secondary rounded-full h-2.5 overflow-hidden border border-border/60">
                  <div
                    className="bg-primary h-full rounded-full transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Intelligent Pre-Compression Analysis Panel */}
          {analysis && (
            <Card className="border-border bg-card shadow-card">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <span>Intelligent Document Analysis</span>
                  </CardTitle>
                  <Badge variant="secondary" className="hidden sm:inline-flex text-[11px] font-medium">
                    Preset Suggested: {COMPRESSION_PRESETS[analysis.recommendedMode].shortLabel}
                  </Badge>
                </div>
                <CardDescription className="text-xs sm:text-sm leading-relaxed">
                  {analysis.recommendedReason}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Key Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                  <div className="rounded-xl border border-border/80 bg-surface-secondary/70 dark:bg-secondary/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      <span>Pages &amp; Text</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {analysis.pageCount} {analysis.pageCount === 1 ? 'Page' : 'Pages'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {analysis.totalTextChars.toLocaleString()} selectable chars
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-surface-secondary/70 dark:bg-secondary/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <ImageIcon className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                      <span>Embedded Images</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {analysis.uniqueImageCount} unique
                      {analysis.duplicateImageCount > 0 && (
                        <span className="text-teal dark:text-teal-400 font-medium ml-1">
                          (+{analysis.duplicateImageCount} dup)
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {analysis.oversizedImageCount150Dpi > 0
                        ? `${analysis.oversizedImageCount150Dpi} above 150 DPI`
                        : analysis.transparentImageCount > 0
                          ? `${analysis.transparentImageCount} with transparency`
                          : analysis.uniqueImageCount === 0
                            ? 'Pure text / vector PDF'
                            : 'Resolution within target'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-surface-secondary/70 dark:bg-secondary/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Layers className="h-3.5 w-3.5 text-teal shrink-0" />
                      <span>Fonts &amp; Vectors</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {analysis.embeddedFontCount} {analysis.embeddedFontCount === 1 ? 'Font' : 'Fonts'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {analysis.totalVectorOps.toLocaleString()} vector draw ops
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/80 bg-surface-secondary/70 dark:bg-secondary/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <Bookmark className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>Interactive Assets</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {analysis.linkCount + analysis.bookmarkCount + analysis.formFieldCount}{' '}
                      preserved items
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {analysis.bookmarkCount} bookmarks • {analysis.linkCount} links •{' '}
                      {analysis.formFieldCount} fields
                    </p>
                  </div>
                </div>

                {/* Extra attribute chips when present */}
                {(analysis.attachmentCount > 0 ||
                  analysis.annotationCount > 0 ||
                  analysis.transparentImageCount > 0 ||
                  analysis.isEncrypted) && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {analysis.transparentImageCount > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Layers className="h-3 w-3 text-teal" />
                        {analysis.transparentImageCount} Transparent SMask
                      </Badge>
                    )}
                    {analysis.annotationCount > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Link2 className="h-3 w-3 text-primary" />
                        {analysis.annotationCount} Annotations &amp; Links
                      </Badge>
                    )}
                    {analysis.attachmentCount > 0 && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Paperclip className="h-3 w-3 text-indigo-500" />
                        {analysis.attachmentCount} Embedded Attachments
                      </Badge>
                    )}
                    {analysis.isEncrypted && (
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Lock className="h-3 w-3 text-amber-500" />
                        Encrypted ({analysis.encryptionMethod})
                      </Badge>
                    )}
                  </div>
                )}

                {/* Digital Signature Warning */}
                {analysis.isDigitallySigned && (
                  <div className="rounded-xl border border-amber-500/45 bg-amber-500/10 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs sm:text-sm">
                        <p className="font-semibold text-foreground">
                          Digital Signature Detected ({analysis.signatureCount})
                        </p>
                        <p className="text-muted-foreground mt-0.5 leading-relaxed">
                          This PDF is cryptographically signed. Any byte-level optimization or
                          recompression will break and invalidate existing digital signatures.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none pl-7">
                      <input
                        type="checkbox"
                        checked={allowSignedModification}
                        onChange={(e) => setAllowSignedModification(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-xs font-medium text-foreground">
                        I understand compressing this document will invalidate existing digital
                        signatures
                      </span>
                    </label>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Compression Mode Selector */}
          {analysis && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Compression Mode</h2>
                {analysis.isEncrypted && activePassword && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="preserve-password"
                      checked={keepPasswordProtection}
                      onCheckedChange={setKeepPasswordProtection}
                      disabled={isBusy}
                    />
                    <Label htmlFor="preserve-password" className="text-xs text-muted-foreground cursor-pointer">
                      Keep AES-256 password on output
                    </Label>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {MODE_ORDER.map((modeId) => {
                  const preset = COMPRESSION_PRESETS[modeId];
                  const isSelected = mode === modeId;
                  return (
                    <button
                      key={modeId}
                      type="button"
                      onClick={() => {
                        setMode(modeId);
                        if (result && result.mode !== modeId) {
                          setResult(null);
                        }
                      }}
                      disabled={isBusy}
                      aria-pressed={isSelected}
                      className={cn(
                        'relative flex flex-col items-start rounded-2xl border-2 p-4 sm:p-5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 touch-manipulation bg-card shadow-card',
                        isSelected
                          ? 'border-primary bg-primary/[0.045] dark:bg-primary/[0.09] ring-2 ring-primary/15'
                          : 'border-border hover:border-indigo-400/50 dark:hover:border-indigo-400/40',
                        isBusy && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between w-full gap-1.5 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={cn(
                              'w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors',
                              isSelected
                                ? 'border-primary bg-primary'
                                : 'border-muted-foreground/45'
                            )}
                          />
                          <span className="font-semibold text-sm text-foreground leading-tight">
                            {preset.label}
                          </span>
                        </div>
                        <Badge
                          variant={modeId === 'recommended' ? 'default' : 'secondary'}
                          className={cn(
                            'text-[10px] shrink-0 font-medium px-2 py-0.5 ml-5 sm:ml-0',
                            modeId === 'extreme' &&
                              'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/15'
                          )}
                        >
                          {preset.badgeText}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed mb-3 pl-5">
                        {preset.description}
                      </p>

                      <ul className="space-y-1 pl-5 text-[11px] text-muted-foreground/95">
                        {preset.detailPoints.map((pt) => (
                          <li key={pt} className="flex items-start gap-1.5 leading-snug">
                            <span className="mt-1.5 h-1 w-1 rounded-full bg-primary/70 shrink-0" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>

              {/* Explicit Extreme Mode Quality Warning */}
              {activePreset.qualityWarning && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs sm:text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-foreground/90 leading-relaxed">{activePreset.qualityWarning}</p>
                </div>
              )}

              {/* Compress Action Button */}
              {!result && (
                <Button
                  type="button"
                  onClick={handleCompress}
                  disabled={
                    isBusy || (analysis.isDigitallySigned && !allowSignedModification)
                  }
                  size="lg"
                  className="w-full h-auto min-h-12 px-4 sm:px-8 py-2.5 text-sm sm:text-base font-semibold shadow-sm whitespace-normal text-center"
                >
                  {isCompressing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 shrink-0 animate-spin" />
                      <span>Optimizing PDF ({progress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Minimize2 className="h-4 w-4 mr-2 shrink-0" />
                      <span>Compress PDF ({activePreset.shortLabel})</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Compression Output Results + Quality Validation + Before/After Preview */}
          {result && (
            <div className="space-y-5">
              {/* Main Result Summary Card */}
              <Card
                className={cn(
                  'bg-card shadow-card',
                  result.status === 'retained-original'
                    ? 'border-amber-500/45'
                    : 'border-teal/45 dark:border-teal/35'
                )}
              >
                <CardContent className="p-5 sm:p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {result.status === 'retained-original' ? (
                        <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-teal shrink-0 mt-0.5" />
                      )}
                      <div>
                        <h3 className="text-base sm:text-lg font-semibold text-foreground">
                          {result.status === 'retained-original'
                            ? 'Already Optimized — Original File Retained'
                            : result.status === 'minimal-reduction'
                              ? 'Compression Complete (Minimal Reduction)'
                              : 'Compression Successful'}
                        </h3>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
                          {result.statusMessage}
                        </p>
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      className="self-start sm:self-center shrink-0 text-xs font-medium"
                    >
                      {COMPRESSION_PRESETS[result.mode].label}
                    </Badge>
                  </div>

                  {/* 4 Key Result Figures */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border bg-surface-secondary/75 dark:bg-secondary/45 p-3.5 text-center">
                      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                        Original Size
                      </p>
                      <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                        {formatFileSize(result.originalSizeBytes)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-surface-secondary/75 dark:bg-secondary/45 p-3.5 text-center">
                      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                        {result.status === 'retained-original' ? 'Output Size' : 'Compressed Size'}
                      </p>
                      <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                        {formatFileSize(result.compressedSizeBytes)}
                      </p>
                    </div>

                    <div
                      className={cn(
                        'rounded-xl border p-3.5 text-center',
                        result.reductionBytes > 0
                          ? 'border-teal/35 bg-teal/10 dark:bg-teal/15'
                          : 'border-border bg-surface-secondary/75 dark:bg-secondary/45'
                      )}
                    >
                      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                        File Size Reduction
                      </p>
                      <p
                        className={cn(
                          'text-base sm:text-lg font-bold tabular-nums inline-flex items-center justify-center gap-1',
                          result.reductionBytes > 0
                            ? 'text-teal-700 dark:text-teal-300'
                            : 'text-foreground'
                        )}
                      >
                        {result.reductionBytes > 0 && <ArrowDown className="h-4 w-4 shrink-0" />}
                        <span>{formatReductionPercent(result.reductionPercent)}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {result.reductionBytes > 0
                          ? `-${formatFileSize(result.reductionBytes)}`
                          : '0 B saved'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-surface-secondary/75 dark:bg-secondary/45 p-3.5 text-center">
                      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
                        Processing Time
                      </p>
                      <p className="text-base sm:text-lg font-bold text-foreground tabular-nums">
                        {formatDuration(result.durationMs)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {result.reEncrypted ? 'AES-256 Encrypted' : 'Validated Locally'}
                      </p>
                    </div>
                  </div>

                  {/* Optimization Breakdown & Integrity Validation */}
                  <div className="hidden sm:block rounded-xl border border-border/80 bg-surface-secondary/50 dark:bg-secondary/30 p-3.5 sm:p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
                        <FileCheck2 className="h-4 w-4 text-teal shrink-0" />
                        Post-Compression Verification Passed
                      </span>
                      {result.validation.visualCheckPerformed &&
                        result.validation.averageSsim !== null && (
                          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                            Visual Similarity: SSIM{' '}
                            <strong className="text-foreground">
                              {result.validation.averageSsim.toFixed(3)}
                            </strong>
                            {result.validation.minPsnrDb !== null &&
                              ` • PSNR ${result.validation.minPsnrDb.toFixed(1)} dB`}
                          </span>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <Badge variant="outline" className="font-normal">
                        QPDF &amp; PDF.js Verified
                      </Badge>
                      <Badge variant="outline" className="font-normal">
                        {result.analysis.pageCount}{' '}
                        {result.analysis.pageCount === 1 ? 'Page' : 'Pages'} Preserved
                      </Badge>
                      {result.analysis.totalTextChars > 0 && (
                        <Badge variant="outline" className="font-normal">
                          Text Selectable ({result.validation.compressedTextChars.toLocaleString()}{' '}
                          chars)
                        </Badge>
                      )}
                      {result.imageSummary.optimizedCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.imageSummary.optimizedCount} Images Optimized
                        </Badge>
                      )}
                      {result.imageSummary.downsampledCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.imageSummary.downsampledCount} Downsampled to{' '}
                          {COMPRESSION_PRESETS[result.mode].targetDpi} DPI
                        </Badge>
                      )}
                      {result.imageSummary.convertedToCcittCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.imageSummary.convertedToCcittCount} CCITT Group 4
                        </Badge>
                      )}
                      {result.imageSummary.convertedToGrayscaleCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.imageSummary.convertedToGrayscaleCount} Grayscale Scans
                        </Badge>
                      )}
                      {result.imageSummary.droppedOpaqueSmaskCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.imageSummary.droppedOpaqueSmaskCount} Redundant SMask Pruned
                        </Badge>
                      )}
                      {result.deduplicatedImagesRemoved > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.deduplicatedImagesRemoved} Duplicate Images Deduplicated
                        </Badge>
                      )}
                      {result.analysis.bookmarkCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.analysis.bookmarkCount} Bookmarks Kept
                        </Badge>
                      )}
                      {result.analysis.linkCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.analysis.linkCount} Hyperlinks Kept
                        </Badge>
                      )}
                      {result.analysis.formFieldCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.analysis.formFieldCount} Form Fields Kept
                        </Badge>
                      )}
                      {result.analysis.attachmentCount > 0 && (
                        <Badge variant="outline" className="font-normal">
                          {result.analysis.attachmentCount} Attachments Kept
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      type="button"
                      onClick={handleDownload}
                      size="lg"
                      className="w-full sm:w-auto sm:flex-1 h-auto min-h-11 py-2.5 px-4 sm:px-8 font-semibold whitespace-normal text-center"
                    >
                      <Download className="h-4 w-4 mr-2 shrink-0" />
                      <span>
                        {result.status === 'retained-original'
                          ? 'Download Original PDF'
                          : 'Download Compressed PDF'}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => setResult(null)}
                      className="w-full sm:w-auto h-auto min-h-11 py-2.5 px-4 sm:px-8 whitespace-normal text-center"
                    >
                      Try Another Compression Mode
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Before-and-After Visual Comparison */}
              {originalBytes && (
                <BeforeAfterPreview
                  originalBytes={originalBytes}
                  compressedBytes={result.outputBytes}
                  originalPassword={activePassword}
                  compressedPassword={result.reEncrypted ? activePassword : undefined}
                  pageCount={result.analysis.pageCount}
                  originalSizeBytes={result.originalSizeBytes}
                  compressedSizeBytes={result.compressedSizeBytes}
                  visualMetrics={result.validation.visualPagesCompared}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
