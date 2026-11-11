import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { pdfjsLib } from '@/lib/pdfWorker';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import {
  Document as DocxDocument,
  Paragraph as DocxParagraph,
  TextRun as DocxTextRun,
  HeadingLevel,
  Packer,
  PageBreak as DocxPageBreak,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import {
  FileText,
  FileSpreadsheet,
  FileCheck,
  Download,
  Copy,
  Check,
  RefreshCw,
  Printer,
  Table as TableIcon,
  Eye,
  Settings2,
  FileUp,
  FileType,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Info,
  ArrowRightLeft,
  Code,
  Image as ImageIcon,
  Scan,
  Languages,
  AlertCircle,
  CheckCircle2,
  Layers,
  Sliders,
  Coins,
  Percent,
} from 'lucide-react';
import {
  ConversionMode,
  ConversionOptions,
  ConversionProgress,
  ExtractedPageData,
  StructuredBlock,
  StructuredParagraph,
  StructuredTable,
  StructuredImage,
  StructuredCodeBlock,
  StructuredTwoColumnBlock,
  StructuredCalloutBlock,
} from '@/lib/pdfToDocx/types';
import { convertPdfToDocx } from '@/lib/pdfToDocx/pdfToDocxConverter';
import {
  parseDocxDocument,
  convertDocxModelToPdf,
  safeWinAnsi,
  safeDrawText,
  safeDrawRectangle,
  safeDrawLine,
  safeEncodeText,
  DocxDocumentModel,
} from '@/lib/docxToPdf/docxToPdfEngine';
import {
  extractIndividualTables,
  buildExcelWorkbook,
  buildTablesCsv,
  DetectedTable,
  TableCellModel,
} from '@/lib/pdfToExcel/pdfToExcelEngine';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FileUploader } from '@/components/shared/FileUploader';
import {
  readFileAsArrayBuffer,
  formatFileSize,
  downloadBlob,
  getPageSizeDimensions,
  createPdfBlob,
} from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DocumentConverterProps {
  initialTab?: 'word-to-pdf' | 'pdf-to-word' | 'pdf-to-excel';
}

interface TableRowData {
  cells: string[];
}

interface PageTableData {
  pageNumber: number;
  rows: TableRowData[];
  columnCount: number;
}

/**
 * Error boundary component to prevent application blank screen on unexpected rendering errors
 */
class ConversionErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ConversionErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 border border-destructive/30 bg-destructive/10 rounded-lg text-center space-y-3 m-4">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
          <h3 className="font-semibold text-destructive text-sm">Document Preview Display Notice</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {this.state.error?.message || 'An unexpected rendering error occurred while displaying document content.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Retry Preview
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Renders TextSpan array with bold, italic, monospace, underline, superscript, and subscript tags
 */
function renderFormattedSpans(spans: {
  text?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isMonospace?: boolean;
  isUnderline?: boolean;
  isSuperScript?: boolean;
  isSubScript?: boolean;
  confidence?: number;
  lowConfidence?: boolean;
}[]): React.ReactNode {
  return spans.map((s, sIdx) => {
    const content = s?.text || '';
    const isLowConf = Boolean(s?.lowConfidence);
    const reviewTitle = isLowConf
      ? s?.confidence !== undefined
        ? `Low OCR confidence (${Math.round(s.confidence)}%) — please verify`
        : 'Low OCR confidence — please verify'
      : undefined;
    const cls = cn(
      s?.isBold && 'font-bold',
      s?.isItalic && 'italic',
      s?.isMonospace && 'font-mono',
      s?.isUnderline && 'underline',
      isLowConf && 'bg-amber-200/70 dark:bg-amber-500/30 border-b border-dashed border-amber-600 rounded-[2px] px-0.5'
    );
    if (s?.isSuperScript) {
      return (
        <sup key={sIdx} className={cls} title={reviewTitle}>
          {content}
        </sup>
      );
    }
    if (s?.isSubScript) {
      return (
        <sub key={sIdx} className={cls} title={reviewTitle}>
          {content}
        </sub>
      );
    }
    return (
      <span key={sIdx} className={cls} title={reviewTitle}>
        {content}
      </span>
    );
  });
}

/**
 * Computes sequential list numbers per block list so numbered and step list previews display 1., 2., 3. / Step 1: accurately
 */
function renderBlockList(blocks: StructuredBlock[]): React.ReactNode {
  let numCounter = 0;
  let lastInstance: number | undefined = undefined;
  return blocks.map((block, bIdx) => {
    let displayNum: number | undefined;
    const listType = block?.type === 'list-item' ? (block as StructuredParagraph).listType : undefined;
    if (listType === 'numbered' || listType === 'step') {
      const inst = (block as StructuredParagraph).listInstance;
      if (inst !== lastInstance) {
        numCounter = 1;
        lastInstance = inst;
      } else {
        numCounter += 1;
      }
      displayNum = numCounter;
    } else {
      numCounter = 0;
      lastInstance = undefined;
    }
    return renderBlockContent(block, bIdx, displayNum);
  });
}

/**
 * Safely renders any extracted StructuredBlock in the live document preview
 * with bulletproof fallbacks for missing spans, plain text, code blocks, and 2-column layouts.
 */
function renderBlockContent(
  block: StructuredBlock,
  bIdx: number,
  listDisplayNumber?: number
): React.ReactNode {
  if (!block || typeof block !== 'object') return null;

  // 1. Table Block
  if (block.type === 'table') {
    const tbl = block as StructuredTable;
    const rows = Array.isArray(tbl?.rows) ? tbl.rows : [];
    const hasHeader = tbl?.hasHeaderRow !== false;
    return (
      <div key={bIdx} className="my-3 overflow-x-auto border rounded-md">
        <table className="min-w-full divide-y text-xs border-collapse">
          <tbody className="divide-y">
            {rows.map((r, rIdx) => (
              <tr
                key={rIdx}
                className={hasHeader && rIdx === 0 ? 'bg-muted/60 font-semibold' : 'hover:bg-muted/30'}
              >
                {Array.isArray(r) &&
                  r.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="p-2 border-r last:border-r-0 text-foreground"
                      style={{ textAlign: cell?.alignment || 'left' }}
                    >
                      {Array.isArray(cell?.spans) && cell.spans.length > 0
                        ? renderFormattedSpans(cell.spans)
                        : cell?.text || ''}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 2. Image Block
  if (block.type === 'image') {
    const img = block as StructuredImage;
    if (!img?.data) return null;
    const blob = new Blob([img.data as unknown as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    return (
      <div
        key={bIdx}
        className="my-3 flex"
        style={{
          justifyContent:
            img.alignment === 'center'
              ? 'center'
              : img.alignment === 'right'
              ? 'flex-end'
              : 'flex-start',
        }}
      >
        <img
          src={url}
          alt="Extracted figure"
          className="rounded border shadow-xs max-w-full"
          style={{
            maxHeight: Math.min(img.heightPt || 200, 280),
          }}
        />
      </div>
    );
  }

  // 3. Code Block (StructuredCodeBlock)
  if (block.type === 'code-block') {
    const cb = block as StructuredCodeBlock;
    const codeLines = Array.isArray(cb?.lines) && cb.lines.length > 0
      ? cb.lines.map((l) => (typeof l === 'string' ? l : l?.text || ''))
      : typeof cb?.rawCode === 'string'
      ? cb.rawCode.split('\n')
      : [''];

    return (
      <div
        key={bIdx}
        className="font-mono text-[11px] sm:text-xs bg-muted/60 p-3 rounded border border-l-4 border-l-blue-500 border-muted-foreground/20 whitespace-pre text-slate-800 dark:text-slate-200 overflow-x-auto my-2 shadow-xs"
      >
        {codeLines.join('\n')}
      </div>
    );
  }

  // 4. Two-Column Block (StructuredTwoColumnBlock)
  if (block.type === 'two-column') {
    const tcb = block as StructuredTwoColumnBlock;
    const leftBlocks = Array.isArray(tcb?.leftBlocks) ? tcb.leftBlocks : [];
    const rightBlocks = Array.isArray(tcb?.rightBlocks) ? tcb.rightBlocks : [];

    return (
      <div
        key={bIdx}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 my-3 p-3 bg-muted/10 rounded border border-dashed border-muted-foreground/30"
      >
        <div className="space-y-2">
          {renderBlockList(leftBlocks)}
        </div>
        <div className="space-y-2">
          {renderBlockList(rightBlocks)}
        </div>
      </div>
    );
  }

  // 5. Callout Container Block (StructuredCalloutBlock)
  if (block.type === 'callout') {
    const callout = block as StructuredCalloutBlock;
    const innerBlocks = Array.isArray(callout?.blocks) ? callout.blocks : [];
    const bgHex = callout?.backgroundColor ? `#${callout.backgroundColor}` : undefined;
    const borderHex = callout?.borderColor ? `#${callout.borderColor}` : undefined;
    const accentHex = callout?.accentColor ? `#${callout.accentColor}` : borderHex || '#3B82F6';

    return (
      <div
        key={bIdx}
        className="my-3 rounded-md border border-l-4 p-3.5 space-y-1.5 shadow-xs"
        style={{
          backgroundColor: bgHex || 'rgba(59, 130, 246, 0.08)',
          borderColor: borderHex || 'rgba(147, 197, 253, 0.6)',
          borderLeftColor: accentHex,
        }}
      >
        {renderBlockList(innerBlocks)}
      </div>
    );
  }

  // 6. Paragraph-like types ('heading', 'title', 'code', 'list-item', 'paragraph')
  const p = block as StructuredParagraph;
  const rawFallback =
    (p as any)?.text ||
    (p as any)?.rawText ||
    (typeof (block as any).content === 'string' ? (block as any).content : '');

  const spans =
    Array.isArray(p?.spans) && p.spans.length > 0
      ? p.spans
      : [
          {
            text: rawFallback,
            fontSize: p?.type === 'heading' ? 14 : 11,
            fontFamily: 'Arial',
            isBold: p?.type === 'heading' || false,
            isItalic: false,
            isMonospace: p?.type === 'code' || false,
          },
        ];

  if (p?.type === 'code') {
    return (
      <div
        key={bIdx}
        className="font-mono text-[11px] sm:text-xs bg-muted/60 p-2 rounded border border-muted-foreground/20 whitespace-pre-wrap text-slate-800 dark:text-slate-200 my-1"
      >
        {spans.map((s) => s?.text || '').join('')}
      </div>
    );
  }

  if (p?.type === 'heading' || p?.type === 'title') {
    const Tag = p?.type === 'title' ? 'h1' : p?.headingLevel === 1 ? 'h2' : p?.headingLevel === 2 ? 'h3' : 'h4';
    const cls =
      p?.type === 'title'
        ? 'text-xl sm:text-2xl font-bold mt-2 mb-3 text-foreground'
        : p?.headingLevel === 1
        ? 'text-lg sm:text-xl font-bold mt-4 mb-2 text-foreground'
        : p?.headingLevel === 2
        ? 'text-base sm:text-lg font-semibold mt-3 mb-1.5 text-foreground'
        : 'text-sm sm:text-base font-semibold mt-2 mb-1 text-foreground';

    return (
      <Tag
        key={bIdx}
        className={cls}
        style={{ textAlign: p?.alignment === 'justified' ? 'justify' : p?.alignment || 'left' }}
      >
        {renderFormattedSpans(spans)}
      </Tag>
    );
  }

  if (p?.type === 'list-item') {
    const isStep = p.listType === 'step';
    const isNumbered = p.listType === 'numbered';
    const indentPx = p.listLevel ? Math.min(48, p.listLevel * 18) : 0;
    return (
      <div
        key={bIdx}
        className="flex items-start gap-2 pl-2 my-1"
        style={indentPx > 0 ? { marginLeft: `${indentPx}px` } : undefined}
      >
        <span className="font-bold text-primary select-none mt-0.5 min-w-[16px] whitespace-nowrap">
          {isStep ? `Step ${listDisplayNumber || 1}:` : isNumbered ? `${listDisplayNumber || 1}.` : '•'}
        </span>
        <div style={{ textAlign: p?.alignment === 'justified' ? 'justify' : p?.alignment || 'left' }}>
          {renderFormattedSpans(spans)}
        </div>
      </div>
    );
  }

  // Normal paragraph
  return (
    <p
      key={bIdx}
      className="leading-relaxed my-1"
      style={{ textAlign: p?.alignment === 'justified' ? 'justify' : p?.alignment || 'left' }}
    >
      {renderFormattedSpans(spans)}
    </p>
  );
}

export default function DocumentConverter({ initialTab = 'word-to-pdf' }: DocumentConverterProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('tab') as 'word-to-pdf' | 'pdf-to-word' | 'pdf-to-excel' | null;
  const [activeTab, setActiveTab] = useState<'word-to-pdf' | 'pdf-to-word' | 'pdf-to-excel'>(
    activeTabParam || initialTab
  );

  // Sync tab with URL
  const handleTabChange = (val: string) => {
    const tab = val as 'word-to-pdf' | 'pdf-to-word' | 'pdf-to-excel';
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // ==========================================
  // TAB 1: WORD TO PDF STATE & LOGIC
  // ==========================================
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [wordLoading, setWordLoading] = useState<boolean>(false);
  const [wordConverting, setWordConverting] = useState<boolean>(false);
  const [wordHtml, setWordHtml] = useState<string>('');
  const [wordRawText, setWordRawText] = useState<string>('');
  const [docxModel, setDocxModel] = useState<DocxDocumentModel | null>(null);
  const [wordMetrics, setWordMetrics] = useState<{ words: number; chars: number; estPages: number }>({
    words: 0,
    chars: 0,
    estPages: 1,
  });

  // Word to PDF Configuration Settings
  const [pdfPageSize, setPdfPageSize] = useState<'A4' | 'Letter' | 'Legal'>('A4');
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [pdfFontFamily, setPdfFontFamily] = useState<'Helvetica' | 'TimesRoman' | 'Courier'>('Helvetica');
  const [pdfFontSize, setPdfFontSize] = useState<number>(11);
  const [pdfLineHeight, setPdfLineHeight] = useState<number>(1.4);
  const [pdfMargin, setPdfMargin] = useState<number>(40);
  const [includePageNumbers, setIncludePageNumbers] = useState<boolean>(true);
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [wordCopied, setWordCopied] = useState<boolean>(false);

  const wordPreviewRef = useRef<HTMLDivElement>(null);

  const handleWordFileSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setWordFile(file);
    setWordLoading(true);

    try {
      const buffer = await readFileAsArrayBuffer(file);

      // Parse structured DOCX OpenXML model (preserves page breaks, twip widths, tables, colors, code)
      try {
        const model = await parseDocxDocument(buffer);
        setDocxModel(model);
        if (model.orientation === 'landscape') {
          setPdfOrientation('landscape');
        }
      } catch (xmlErr) {
        console.warn('Advanced DOCX XML parsing fallback:', xmlErr);
        setDocxModel(null);
      }

      const resHtml = await mammoth.convertToHtml({ arrayBuffer: buffer });
      const resText = await mammoth.extractRawText({ arrayBuffer: buffer });

      const raw = resText.value || '';
      const words = raw.split(/\s+/).filter(Boolean).length;
      const chars = raw.length;
      const estPages = Math.max(1, Math.ceil(words / 380));

      setWordHtml(resHtml.value || '<p>Empty document</p>');
      setWordRawText(raw);
      setWordMetrics({ words, chars, estPages });
      toast.success(`Word document parsed: ${words.toLocaleString()} words found.`);
    } catch (err) {
      console.error('Failed to parse Word document:', err);
      toast.error('Could not read Word document (.docx). Ensure file is not corrupted.');
      setWordFile(null);
      setDocxModel(null);
    } finally {
      setWordLoading(false);
    }
  }, []);

  // Generate crisp Vector PDF from parsed Word Document using pdf-lib
  const handleConvertWordToPdf = async () => {
    if (!wordFile || (!wordHtml && !docxModel)) return;
    setWordConverting(true);
    toast.info('Generating high-fidelity PDF from Word document...');

    try {
      const cleanDocName = wordFile.name.replace(/\.[^/.]+$/, '');

      // High-Fidelity OpenXML Layout-Aware Engine
      if (docxModel && docxModel.elements.length > 0) {
        try {
          const pdfBlob = await convertDocxModelToPdf(
            docxModel,
            includePageNumbers,
            cleanDocName
          );
          downloadBlob(pdfBlob, `${cleanDocName}.pdf`);
          toast.success('Vector PDF generated preserving layout, page breaks, headings, tables & code styles!');
          setWordConverting(false);
          return;
        } catch (engineErr) {
          console.warn('Advanced DOCX layout engine fallback to standard renderer:', engineErr);
          // Seamlessly proceed to standard renderer below so conversion never fails
        }
      }

      const pdfDoc = await PDFDocument.create();

      // Embed fonts
      let fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      let fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      let fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

      if (pdfFontFamily === 'TimesRoman') {
        fontRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
        fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
      } else if (pdfFontFamily === 'Courier') {
        fontRegular = await pdfDoc.embedFont(StandardFonts.Courier);
        fontBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
        fontItalic = await pdfDoc.embedFont(StandardFonts.CourierOblique);
      }

      const { width: pageWidth, height: pageHeight } = getPageSizeDimensions(pdfPageSize, pdfOrientation);
      const printableWidth = pageWidth - pdfMargin * 2;
      const baseLineHeight = pdfFontSize * pdfLineHeight;

      // Parse HTML structure
      const parser = new DOMParser();
      const docDom = parser.parseFromString(wordHtml, 'text/html');
      const bodyChildren = Array.from(docDom.body.children);

      // If no block elements found, treat body text as paragraphs
      const blocks: Array<{ type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'table'; text: string; rows?: string[][] }> = [];

      if (bodyChildren.length === 0) {
        const textBlocks = (docDom.body.textContent || '').split('\n').filter((t) => t.trim().length > 0);
        textBlocks.forEach((tb) => blocks.push({ type: 'p', text: tb }));
      } else {
        bodyChildren.forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === 'h1') blocks.push({ type: 'h1', text: el.textContent?.trim() || '' });
          else if (tag === 'h2') blocks.push({ type: 'h2', text: el.textContent?.trim() || '' });
          else if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6')
            blocks.push({ type: 'h3', text: el.textContent?.trim() || '' });
          else if (tag === 'ul' || tag === 'ol') {
            const lis = el.querySelectorAll('li');
            lis.forEach((li) => blocks.push({ type: 'li', text: li.textContent?.trim() || '' }));
          } else if (tag === 'table') {
            const trs = el.querySelectorAll('tr');
            const tableRows: string[][] = [];
            trs.forEach((tr) => {
              const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim() || '');
              if (cells.length > 0) tableRows.push(cells);
            });
            if (tableRows.length > 0) blocks.push({ type: 'table', text: '', rows: tableRows });
          } else {
            const pText = el.textContent?.trim() || '';
            if (pText) blocks.push({ type: 'p', text: pText });
          }
        });
      }

      // Word wrapping helper
      const wrapText = (text: string, maxWidth: number, font: any, size: number): string[] => {
        // Sanitize string to WinAnsi compatible characters for standard fonts
        const sanitized = safeWinAnsi(text);

        const words = sanitized.split(/\s+/).filter(Boolean);
        if (words.length === 0) return [];
        const lines: string[] = [];
        let current = '';

        for (const w of words) {
          const test = current ? `${current} ${w}` : w;
          try {
            if (font.widthOfTextAtSize(test, size) <= maxWidth) {
              current = test;
            } else {
              if (current) lines.push(current);
              current = w;
            }
          } catch {
            current = test;
          }
        }
        if (current) lines.push(current);
        return lines;
      };

      // Page pagination coordinator
      let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      let cursorY = pageHeight - pdfMargin - (includeHeader ? 25 : 0);
      const bottomLimit = pdfMargin + (includePageNumbers ? 25 : 10);

      const ensureSpace = (neededHeight: number) => {
        if (cursorY - neededHeight < bottomLimit || !Number.isFinite(cursorY)) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          cursorY = pageHeight - pdfMargin - (includeHeader ? 25 : 0);
        }
      };

      for (const block of blocks) {
        if (block.type === 'h1') {
          const h1Size = Math.round(pdfFontSize * 1.6);
          const lines = wrapText(block.text, printableWidth, fontBold, h1Size);
          ensureSpace(lines.length * (h1Size * 1.3) + 16);
          cursorY -= 12; // top spacing
          for (const line of lines) {
            ensureSpace(h1Size * 1.3);
            safeDrawText(currentPage, line, {
              x: pdfMargin,
              y: cursorY,
              size: h1Size,
              font: fontBold,
              color: rgb(0.08, 0.1, 0.15),
            });
            cursorY -= h1Size * 1.3;
          }
          cursorY -= 8; // bottom spacing
        } else if (block.type === 'h2') {
          const h2Size = Math.round(pdfFontSize * 1.35);
          const lines = wrapText(block.text, printableWidth, fontBold, h2Size);
          ensureSpace(lines.length * (h2Size * 1.3) + 12);
          cursorY -= 10;
          for (const line of lines) {
            ensureSpace(h2Size * 1.3);
            safeDrawText(currentPage, line, {
              x: pdfMargin,
              y: cursorY,
              size: h2Size,
              font: fontBold,
              color: rgb(0.12, 0.15, 0.22),
            });
            cursorY -= h2Size * 1.3;
          }
          cursorY -= 6;
        } else if (block.type === 'h3') {
          const h3Size = Math.round(pdfFontSize * 1.15);
          const lines = wrapText(block.text, printableWidth, fontBold, h3Size);
          ensureSpace(lines.length * (h3Size * 1.3) + 8);
          cursorY -= 8;
          for (const line of lines) {
            ensureSpace(h3Size * 1.3);
            safeDrawText(currentPage, line, {
              x: pdfMargin,
              y: cursorY,
              size: h3Size,
              font: fontBold,
              color: rgb(0.15, 0.18, 0.25),
            });
            cursorY -= h3Size * 1.3;
          }
          cursorY -= 4;
        } else if (block.type === 'li') {
          const indent = 16;
          const liWidth = printableWidth - indent;
          const lines = wrapText(block.text, liWidth, fontRegular, pdfFontSize);
          for (let i = 0; i < lines.length; i++) {
            ensureSpace(baseLineHeight);
            if (i === 0) {
              safeDrawText(currentPage, '*', {
                x: pdfMargin + 4,
                y: cursorY,
                size: pdfFontSize,
                font: fontBold,
                color: rgb(0.3, 0.35, 0.45),
              });
            }
            safeDrawText(currentPage, lines[i], {
              x: pdfMargin + indent,
              y: cursorY,
              size: pdfFontSize,
              font: fontRegular,
              color: rgb(0.15, 0.18, 0.22),
            });
            cursorY -= baseLineHeight;
          }
          cursorY -= 2;
        } else if (block.type === 'table' && block.rows) {
          const colCount = Math.max(...block.rows.map((r) => r.length), 1);
          const colWidth = Math.max(30, printableWidth / colCount);
          const rowHeight = pdfFontSize * 1.8;

          for (const row of block.rows) {
            ensureSpace(rowHeight + 4);
            safeDrawLine(currentPage, {
              start: { x: pdfMargin, y: cursorY + 2 },
              end: { x: pdfMargin + printableWidth, y: cursorY + 2 },
              thickness: 0.5,
              color: rgb(0.8, 0.82, 0.85),
            });

            row.forEach((cellText, cIdx) => {
              const cellLines = wrapText(cellText, colWidth - 8, fontRegular, pdfFontSize - 1);
              if (cellLines[0]) {
                safeDrawText(currentPage, cellLines[0], {
                  x: pdfMargin + cIdx * colWidth + 4,
                  y: cursorY - pdfFontSize + 1,
                  size: pdfFontSize - 1,
                  font: fontRegular,
                  color: rgb(0.15, 0.18, 0.22),
                });
              }
            });
            cursorY -= rowHeight;
          }
          cursorY -= 8;
        } else {
          // Regular paragraph
          const lines = wrapText(block.text, printableWidth, fontRegular, pdfFontSize);
          for (const line of lines) {
            ensureSpace(baseLineHeight);
            safeDrawText(currentPage, line, {
              x: pdfMargin,
              y: cursorY,
              size: pdfFontSize,
              font: fontRegular,
              color: rgb(0.15, 0.18, 0.22),
            });
            cursorY -= baseLineHeight;
          }
          cursorY -= 6; // paragraph spacing
        }
      }

      // Headers and Footers
      const totalPages = pdfDoc.getPageCount();

      for (let i = 0; i < totalPages; i++) {
        const page = pdfDoc.getPage(i);

        if (includeHeader) {
          const cleanDocTitle = safeWinAnsi(cleanDocName).slice(0, 80);
          safeDrawText(page, cleanDocTitle, {
            x: pdfMargin,
            y: pageHeight - pdfMargin / 2 - 4,
            size: 8.5,
            font: fontRegular,
            color: rgb(0.5, 0.55, 0.6),
          });
          safeDrawLine(page, {
            start: { x: pdfMargin, y: pageHeight - pdfMargin / 2 - 8 },
            end: { x: pageWidth - pdfMargin, y: pageHeight - pdfMargin / 2 - 8 },
            thickness: 0.5,
            color: rgb(0.88, 0.9, 0.92),
          });
        }

        if (includePageNumbers) {
          const footerText = `Page ${i + 1} of ${totalPages}`;
          let textWidth = 60;
          try {
            textWidth = fontRegular.widthOfTextAtSize(footerText, 9);
          } catch {}
          safeDrawText(page, footerText, {
            x: pageWidth / 2 - textWidth / 2,
            y: pdfMargin / 2,
            size: 9,
            font: fontRegular,
            color: rgb(0.45, 0.5, 0.55),
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      downloadBlob(blob, `${cleanDocName}.pdf`);
      toast.success(`PDF successfully generated (${totalPages} pages)!`);
    } catch (err) {
      console.error('Word to PDF generation error:', err);
      toast.error('Failed to convert Word to PDF. Please try again.');
    } finally {
      setWordConverting(false);
    }
  };

  // Browser Print / Save as PDF
  const handlePrintWordDocument = () => {
    if (!wordHtml) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Pop-up was blocked. Please allow pop-ups for browser print.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${wordFile?.name || 'Document'} - Print / Save as PDF</title>
          <style>
            @page {
              size: ${pdfPageSize} ${pdfOrientation};
              margin: ${pdfMargin}pt;
            }
            body {
              font-family: ${pdfFontFamily === 'TimesRoman' ? '"Times New Roman", Times, serif' : pdfFontFamily === 'Courier' ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif'};
              font-size: ${pdfFontSize}pt;
              line-height: ${pdfLineHeight};
              color: #111827;
              padding: 20px;
            }
            h1 { font-size: ${Math.round(pdfFontSize * 1.6)}pt; margin-top: 1em; margin-bottom: 0.5em; color: #111827; }
            h2 { font-size: ${Math.round(pdfFontSize * 1.35)}pt; margin-top: 0.8em; margin-bottom: 0.4em; color: #1f2937; }
            h3 { font-size: ${Math.round(pdfFontSize * 1.15)}pt; margin-top: 0.6em; margin-bottom: 0.3em; color: #374151; }
            p { margin-bottom: 0.8em; }
            ul, ol { margin-bottom: 0.8em; padding-left: 20px; }
            li { margin-bottom: 0.3em; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
            th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          ${wordHtml}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  // ==========================================
  // TAB 2: PDF TO WORD STATE & LOGIC
  // ==========================================
  const [pdfToWordFile, setPdfToWordFile] = useState<File | null>(null);
  const [pdfToWordLoading, setPdfToWordLoading] = useState<boolean>(false);
  const [pdfToWordExporting, setPdfToWordExporting] = useState<boolean>(false);
  const [activeWordPreviewPage, setActiveWordPreviewPage] = useState<number>(1);
  const [wordExportCopied, setWordExportCopied] = useState<boolean>(false);

  // Conversion Options
  const [conversionMode, setConversionMode] = useState<ConversionMode>('editable');
  const [preservePageBreaks, setPreservePageBreaks] = useState<boolean>(true);
  const [smartHeadingDetection, setSmartHeadingDetection] = useState<boolean>(true);
  const [detectTables, setDetectTables] = useState<boolean>(true);
  const [detectCodeBlocks, setDetectCodeBlocks] = useState<boolean>(true);
  const [extractImages, setExtractImages] = useState<boolean>(true);
  const [enableOcr, setEnableOcr] = useState<boolean>(false);
  const [ocrLanguage, setOcrLanguage] = useState<string>('eng');
  const [defaultFontFamily, setDefaultFontFamily] = useState<string>('Arial');

  // Analyzed data & cached results
  const [analyzedPages, setAnalyzedPages] = useState<ExtractedPageData[]>([]);
  const [generatedDocxBlob, setGeneratedDocxBlob] = useState<Blob | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<ConversionProgress | null>(null);
  const [conversionStats, setConversionStats] = useState<{
    words: number;
    scannedCount: number;
    tablesCount: number;
    codeCount: number;
    imagesCount: number;
    ocrReviewCount: number;
    hasCoverPage: boolean;
  }>({
    words: 0,
    scannedCount: 0,
    tablesCount: 0,
    codeCount: 0,
    imagesCount: 0,
    ocrReviewCount: 0,
    hasCoverPage: false,
  });

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

  // Core execution runner
  const runConversionProcess = useCallback(
    async (file: File, optionsOverride?: Partial<ConversionOptions>) => {
      setPdfToWordLoading(true);
      setGeneratedDocxBlob(null);

      const options: ConversionOptions = {
        mode: conversionMode,
        preservePageBreaks,
        smartHeadingDetection,
        detectTables,
        detectCodeBlocks,
        extractImages,
        enableOcr,
        ocrLanguage,
        defaultFontFamily,
        ...optionsOverride,
      };

      try {
        const result = await convertPdfToDocx(file, options, (progress) => {
          setAnalysisProgress(progress);
        });

        setAnalyzedPages(result.pages);
        setGeneratedDocxBlob(result.docxBlob);
        setActiveWordPreviewPage(1);

        const hasCover = result.pages.some((p) => p.isCoverPage);
        setConversionStats({
          words: result.totalWords,
          scannedCount: result.scannedPagesCount,
          tablesCount: result.tablesCount,
          codeCount: result.codeBlocksCount,
          imagesCount: result.imagesCount,
          ocrReviewCount: result.ocrReviewCount || 0,
          hasCoverPage: hasCover,
        });

        toast.success(
          `Analysis complete: ${result.pages.length} pages, ${result.totalWords.toLocaleString()} words.`
        );
      } catch (err: any) {
        console.error('PDF to Word conversion failed:', err);
        const errMsg = String(err?.message || '');
        const isPassword =
          err?.name === 'PasswordException' ||
          errMsg.toLowerCase().includes('password') ||
          errMsg.toLowerCase().includes('encrypt');

        if (isPassword) {
          toast.error('This PDF is password-protected. Please unlock it in "Protect & Unlock" first.');
        } else if (errMsg.includes('valid PDF') || errMsg.includes('empty')) {
          toast.error(errMsg);
        } else {
          toast.error(err?.message || 'Could not parse PDF. File might be corrupted or in an unsupported format.');
        }
        setPdfToWordFile(null);
      } finally {
        setPdfToWordLoading(false);
        setAnalysisProgress(null);
      }
    },
    [
      conversionMode,
      preservePageBreaks,
      smartHeadingDetection,
      detectTables,
      detectCodeBlocks,
      extractImages,
      enableOcr,
      ocrLanguage,
      defaultFontFamily,
    ]
  );

  const handlePdfToWordFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const file = files[0];
      setPdfToWordFile(file);
      await runConversionProcess(file);
    },
    [runConversionProcess]
  );

  // Switch between Mode A and Mode B
  const handleModeChange = async (newMode: ConversionMode) => {
    setConversionMode(newMode);
    if (pdfToWordFile) {
      await runConversionProcess(pdfToWordFile, { mode: newMode });
    }
  };

  // Run OCR on scanned pages
  const handleTriggerOcr = async () => {
    if (!pdfToWordFile) return;
    setEnableOcr(true);
    toast.info('Starting Optical Character Recognition (OCR)...');
    await runConversionProcess(pdfToWordFile, { enableOcr: true });
  };

  // Download .DOCX
  const handleDownloadDocx = async () => {
    if (!pdfToWordFile) return;

    if (generatedDocxBlob) {
      const cleanDocName = pdfToWordFile.name.replace(/\.[^/.]+$/, '');
      downloadBlob(generatedDocxBlob, `${cleanDocName}.docx`);
      toast.success('Word document (.docx) successfully downloaded!');
      return;
    }

    setPdfToWordExporting(true);
    try {
      await runConversionProcess(pdfToWordFile);
    } finally {
      setPdfToWordExporting(false);
    }
  };

  const currentPageData = useMemo(() => {
    return analyzedPages[activeWordPreviewPage - 1] || analyzedPages[0];
  }, [analyzedPages, activeWordPreviewPage]);

  // ==========================================
  // TAB 3: PDF TO EXCEL STATE & LOGIC
  // ==========================================
  const [pdfToExcelFile, setPdfToExcelFile] = useState<File | null>(null);
  const [pdfToExcelLoading, setPdfToExcelLoading] = useState<boolean>(false);
  const [pdfToExcelExporting, setPdfToExcelExporting] = useState<boolean>(false);
  const [detectedTables, setDetectedTables] = useState<DetectedTable[]>([]);
  const [activeTableIndex, setActiveTableIndex] = useState<number>(0);
  const [excelPages, setExcelPages] = useState<PageTableData[]>([]);
  const [activeExcelPage, setActiveExcelPage] = useState<number>(1);
  const [excelLayout, setExcelLayout] = useState<'multi-sheet' | 'single-sheet'>('multi-sheet');
  const [autoParseNumbers, setAutoParseNumbers] = useState<boolean>(true);
  const [csvDelimiter, setCsvDelimiter] = useState<',' | '\t' | ';'>(',');
  const [excelCopied, setExcelCopied] = useState<boolean>(false);

  const handlePdfToExcelFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const file = files[0];
      setPdfToExcelFile(file);
      setPdfToExcelLoading(true);
      setDetectedTables([]);
      setActiveTableIndex(0);
      setExcelPages([]);

      try {
        const buffer = await readFileAsArrayBuffer(file);
        
        // Advanced Table Extraction Engine with Heading Recognition & Continuation Stitching
        const tables = await extractIndividualTables(buffer);
        setDetectedTables(tables);
        setActiveTableIndex(0);

        // Also build backward-compatible legacy pages for single-sheet fallback
        const pagesData: PageTableData[] = tables.map((tbl, idx) => ({
          pageNumber: tbl.startPage || idx + 1,
          rows: tbl.rows.map((row) => ({
            cells: row.map((c) => String(c.value ?? '')),
          })),
          columnCount: tbl.columnCount,
        }));
        setExcelPages(pagesData);
        setActiveExcelPage(1);

        const totalRows = tables.reduce((acc, t) => acc + t.rows.length, 0);
        const tableNames = tables.map((t) => `"${t.name}"`).join(', ');
        toast.success(
          `Extracted ${tables.length} table${tables.length > 1 ? 's' : ''}: ${tableNames} (${totalRows} total rows)`
        );
      } catch (err: any) {
        console.error('Failed to parse PDF for Excel:', err);
        if (err?.name === 'PasswordException') {
          toast.error('This PDF is password-protected. Please unlock it in "Protect & Unlock" first.');
        } else {
          toast.error(err?.message || 'Could not parse tables from PDF.');
        }
        setPdfToExcelFile(null);
      } finally {
        setPdfToExcelLoading(false);
      }
    },
    []
  );

  // Convert string to clean numeric value if applicable
  const parseCellVal = (val: string): string | number => {
    if (!autoParseNumbers) return val;
    const clean = val.replace(/[$,]/g, '').trim();
    if (/^-?\d+(\.\d+)?$/.test(clean)) {
      const num = Number(clean);
      if (!isNaN(num)) return num;
    }
    return val;
  };

  // Generate .XLSX Workbook using SheetJS (XLSX) with individual worksheets & professional styling
  const handleDownloadXlsx = () => {
    if (!pdfToExcelFile || detectedTables.length === 0) return;
    setPdfToExcelExporting(true);
    toast.info('Generating formatted Excel (.xlsx) workbook...');

    try {
      const cleanDocName = pdfToExcelFile.name.replace(/\.[^/.]+$/, '');
      const blob = buildExcelWorkbook(detectedTables, excelLayout);
      downloadBlob(blob, `${cleanDocName}.xlsx`);
      toast.success(
        `Excel workbook (${detectedTables.length} sheet${detectedTables.length > 1 ? 's' : ''}) downloaded!`
      );
    } catch (err) {
      console.error('Failed to export Excel:', err);
      toast.error('Failed to generate Excel workbook.');
    } finally {
      setPdfToExcelExporting(false);
    }
  };

  // Download as CSV
  const handleDownloadCsv = () => {
    if (!pdfToExcelFile || detectedTables.length === 0) return;
    const cleanDocName = pdfToExcelFile.name.replace(/\.[^/.]+$/, '');
    const csvContent = buildTablesCsv(detectedTables, csvDelimiter);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${cleanDocName}.csv`);
    toast.success('CSV file downloaded successfully!');
  };

  // Copy as TSV (Tab Separated) for instant 1-tap paste into Google Sheets / Excel
  const handleCopyTsv = () => {
    if (detectedTables.length === 0) return;
    const activeTbl = detectedTables[activeTableIndex] || detectedTables[0];
    const lines: string[] = [];

    // Header row
    if (activeTbl.headers && activeTbl.headers.length > 0) {
      lines.push(activeTbl.headers.join('\t'));
    }
    // Data rows
    for (const row of activeTbl.rows) {
      lines.push(row.map((c) => String(c.value ?? '')).join('\t'));
    }

    navigator.clipboard.writeText(lines.join('\n'));
    setExcelCopied(true);
    toast.success(`Copied table "${activeTbl.name}" to clipboard! Paste into Excel or Google Sheets (Ctrl+V).`);
    setTimeout(() => setExcelCopied(false), 2200);
  };

  // Helper metrics
  const totalTableRows = useMemo(
    () => detectedTables.reduce((acc, t) => acc + t.rows.length, 0),
    [detectedTables]
  );
  const currentTable = detectedTables[activeTableIndex] || detectedTables[0];
  const totalExcelRows = totalTableRows;
  const currentExcelPageData = excelPages.find((p) => p.pageNumber === activeExcelPage) || excelPages[0];

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-8 max-w-6xl">
      {/* Header */}
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs sm:text-sm font-medium mb-2.5">
          <ArrowRightLeft className="h-3.5 w-3.5" />
          100% Client-Side Conversion
        </div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-2">
          Document <span className="text-primary">Converter</span>
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-xl mx-auto">
          Convert Word to PDF, PDF to Word (.docx), and PDF to Excel (.xlsx) directly in your browser with zero server uploads.
        </p>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-2xl mx-auto mb-6 sm:mb-8 h-11 p-1 bg-muted/70 border border-border/60">
          <TabsTrigger value="word-to-pdf" className="text-xs sm:text-sm font-medium gap-1.5 data-[state=active]:shadow-sm">
            <FileType className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="hidden sm:inline">Word to PDF</span>
            <span className="sm:hidden">Word</span>
          </TabsTrigger>
          <TabsTrigger value="pdf-to-word" className="text-xs sm:text-sm font-medium gap-1.5 data-[state=active]:shadow-sm">
            <FileText className="h-4 w-4 text-primary" />
            <span className="hidden sm:inline">PDF to Word</span>
            <span className="sm:hidden">To Word</span>
          </TabsTrigger>
          <TabsTrigger value="pdf-to-excel" className="text-xs sm:text-sm font-medium gap-1.5 data-[state=active]:shadow-sm">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden sm:inline">PDF to Excel</span>
            <span className="sm:hidden">To Excel</span>
          </TabsTrigger>
        </TabsList>

        {/* ========================================================= */}
        {/* TAB 1: WORD TO PDF (.DOCX -> .PDF)                        */}
        {/* ========================================================= */}
        <TabsContent value="word-to-pdf" className="space-y-6">
          {!wordFile ? (
            <Card>
              <CardContent className="p-5 sm:p-7">
                <FileUploader
                  accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                  multiple={false}
                  onFilesSelected={handleWordFileSelected}
                  label="Drop Word Document (.docx)"
                  description="Upload any Microsoft Word document to convert to PDF offline"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* File Info Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-card border rounded-lg shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                    <FileType className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{wordFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(wordFile.size)} • {wordMetrics.words.toLocaleString()} words • ~{wordMetrics.estPages} est. pages
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setWordFile(null);
                      setWordHtml('');
                      setWordRawText('');
                    }}
                    className="h-8 text-xs touch-manipulation"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Change Document
                  </Button>
                </div>
              </div>

              {/* Conversion Settings & Controls */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Controls Panel */}
                <div className="lg:col-span-5 space-y-4">
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-blue-500" />
                        PDF Layout & Formatting
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Customize page size, font, margins, and header options
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 px-4 sm:px-5 pb-5 text-xs sm:text-sm">
                      {/* Page Size & Orientation */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Page Size</Label>
                          <Select
                            value={pdfPageSize}
                            onValueChange={(val) => setPdfPageSize(val as 'A4' | 'Letter' | 'Legal')}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Size" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="A4">A4 (210 × 297 mm)</SelectItem>
                              <SelectItem value="Letter">US Letter (8.5 × 11 in)</SelectItem>
                              <SelectItem value="Legal">Legal (8.5 × 14 in)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Orientation</Label>
                          <Select
                            value={pdfOrientation}
                            onValueChange={(val) => setPdfOrientation(val as 'portrait' | 'landscape')}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Orientation" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="portrait">Portrait</SelectItem>
                              <SelectItem value="landscape">Landscape</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Font Family & Base Size */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Font Family</Label>
                          <Select
                            value={pdfFontFamily}
                            onValueChange={(val) => setPdfFontFamily(val as any)}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Font" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Helvetica">Helvetica (Modern)</SelectItem>
                              <SelectItem value="TimesRoman">Times Roman (Classic)</SelectItem>
                              <SelectItem value="Courier">Courier (Monospace)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Base Font Size</Label>
                          <Select
                            value={String(pdfFontSize)}
                            onValueChange={(val) => setPdfFontSize(Number(val))}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Font Size" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10 pt (Compact)</SelectItem>
                              <SelectItem value="11">11 pt (Standard)</SelectItem>
                              <SelectItem value="12">12 pt (Large)</SelectItem>
                              <SelectItem value="14">14 pt (Extra Large)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Margins */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Page Margins</Label>
                        <Select
                          value={String(pdfMargin)}
                          onValueChange={(val) => setPdfMargin(Number(val))}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Margin" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="25">Compact (25 pt)</SelectItem>
                            <SelectItem value="40">Standard (40 pt)</SelectItem>
                            <SelectItem value="60">Wide (60 pt)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Toggles */}
                      <div className="pt-2 border-t space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Page Numbers Footer</Label>
                            <p className="text-[11px] text-muted-foreground">Add "Page X of Y" on each page</p>
                          </div>
                          <Switch
                            checked={includePageNumbers}
                            onCheckedChange={setIncludePageNumbers}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Document Header</Label>
                            <p className="text-[11px] text-muted-foreground">Print filename at the top of pages</p>
                          </div>
                          <Switch checked={includeHeader} onCheckedChange={setIncludeHeader} />
                        </div>
                      </div>

                      {/* Action Download Buttons */}
                      <div className="pt-4 space-y-2.5">
                        <Button
                          className="w-full h-11 text-sm font-semibold shadow-md touch-manipulation"
                          onClick={handleConvertWordToPdf}
                          disabled={wordConverting}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          {wordConverting ? 'Generating PDF...' : 'Convert & Download PDF'}
                        </Button>

                        <Button
                          variant="outline"
                          className="w-full h-9 text-xs touch-manipulation"
                          onClick={handlePrintWordDocument}
                        >
                          <Printer className="h-3.5 w-3.5 mr-1.5" />
                          Print / Save via Browser PDF
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Document Preview */}
                <div className="lg:col-span-7">
                  <Card className="h-full flex flex-col">
                    <CardHeader className="py-3 px-4 sm:px-5 border-b flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Eye className="h-4 w-4 text-blue-500" />
                          Document Live Preview
                        </CardTitle>
                        <CardDescription className="text-[11px]">
                          Formatted view of parsed Word headings, text & tables
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs touch-manipulation"
                        onClick={() => {
                          navigator.clipboard.writeText(wordRawText);
                          setWordCopied(true);
                          toast.success('Word text copied to clipboard!');
                          setTimeout(() => setWordCopied(false), 2000);
                        }}
                      >
                        {wordCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 mr-1" />
                            Copy Text
                          </>
                        )}
                      </Button>
                    </CardHeader>
                    <CardContent className="p-4 sm:p-6 flex-1 max-h-[560px] overflow-y-auto bg-muted/20">
                      <div
                        ref={wordPreviewRef}
                        className="bg-card p-6 sm:p-8 rounded-lg shadow-sm border text-foreground prose dark:prose-invert max-w-none text-xs sm:text-sm leading-relaxed overflow-x-auto [&_pre]:overflow-x-auto [&_pre]:p-3 [&_pre]:bg-muted/70 [&_pre]:rounded-md [&_pre]:font-mono [&_pre]:border [&_pre]:border-border/60 [&_table]:overflow-x-auto [&_table]:block sm:[&_table]:table"
                        style={{
                          fontFamily:
                            pdfFontFamily === 'TimesRoman'
                              ? '"Times New Roman", Times, serif'
                              : pdfFontFamily === 'Courier'
                              ? 'Courier, monospace'
                              : 'Helvetica, Arial, sans-serif',
                          fontSize: `${pdfFontSize}px`,
                          lineHeight: pdfLineHeight,
                        }}
                        dangerouslySetInnerHTML={{ __html: wordHtml }}
                      />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 2: PDF TO WORD (.PDF -> .DOCX)                        */}
        {/* ========================================================= */}
        <TabsContent value="pdf-to-word" className="space-y-6">
          {!pdfToWordFile ? (
            <Card>
              <CardContent className="p-5 sm:p-7">
                <FileUploader
                  accept=".pdf,application/pdf"
                  multiple={false}
                  onFilesSelected={handlePdfToWordFileSelected}
                  label="Drop PDF to Convert to Word (.docx)"
                  description="Upload any PDF to extract layout-aware text, tables, headings, code blocks, and embedded images"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* File Info Bar with Badges */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-card border rounded-lg shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{pdfToWordFile.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(pdfToWordFile.size)} • {analyzedPages.length} pages •{' '}
                        {conversionStats.words.toLocaleString()} words
                      </span>
                      {conversionStats.hasCoverPage && (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                          Cover Page
                        </Badge>
                      )}
                      {conversionStats.tablesCount > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          {conversionStats.tablesCount} Tables
                        </Badge>
                      )}
                      {conversionStats.codeCount > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-teal-600 dark:text-teal-400 border-teal-500/30">
                          {conversionStats.codeCount} Code Blocks
                        </Badge>
                      )}
                      {conversionStats.imagesCount > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-primary border-primary/30">
                          {conversionStats.imagesCount} Images
                        </Badge>
                      )}
                      {conversionStats.ocrReviewCount > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10">
                          {conversionStats.ocrReviewCount} OCR Review
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPdfToWordFile(null);
                      setAnalyzedPages([]);
                      setGeneratedDocxBlob(null);
                      setConversionStats({
                        words: 0,
                        scannedCount: 0,
                        tablesCount: 0,
                        codeCount: 0,
                        imagesCount: 0,
                        ocrReviewCount: 0,
                        hasCoverPage: false,
                      });
                    }}
                    className="h-8 text-xs touch-manipulation"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Change PDF
                  </Button>
                </div>
              </div>

              {/* Scanned Pages OCR Banner */}
              {conversionStats.scannedCount > 0 && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium">
                    <Scan className="h-4 w-4 shrink-0" />
                    <span>
                      Scanned PDF Detected: {conversionStats.scannedCount} page(s) contain image-only text.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Select value={ocrLanguage} onValueChange={setOcrLanguage}>
                      <SelectTrigger className="h-7 text-xs w-[120px] bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OCR_LANGUAGES.map((l) => (
                          <SelectItem key={l.code} value={l.code} className="text-xs">
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={handleTriggerOcr}
                      disabled={pdfToWordLoading}
                      className="h-7 text-xs shrink-0"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Run OCR on Scanned Pages
                    </Button>
                  </div>
                </div>
              )}

              {/* OCR Low-Confidence Review Banner */}
              {conversionStats.ocrReviewCount > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    OCR flagged {conversionStats.ocrReviewCount} uncertain word(s) with low recognition confidence — highlighted in yellow in both the preview and exported Word document for quick verification.
                  </span>
                </div>
              )}

              {/* Progress Indicator */}
              {pdfToWordLoading && analysisProgress && (
                <div className="p-4 bg-muted/40 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                      {analysisProgress.message}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {analysisProgress.percent}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-2 transition-all duration-300 rounded-full"
                      style={{ width: `${analysisProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Conversion Settings & Controls */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Controls */}
                <div className="lg:col-span-5 space-y-4">
                  {/* Mode Selector Card */}
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        Conversion Mode
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Select between editable reconstruction or visual exact replica
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 px-4 sm:px-5 pb-5">
                      {/* Mode A: Editable */}
                      <div
                        onClick={() => handleModeChange('editable')}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer transition-colors flex items-start gap-3 text-xs',
                          conversionMode === 'editable'
                            ? 'border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30'
                            : 'border-border hover:bg-muted/50'
                        )}
                      >
                        <div className="p-1.5 rounded-md bg-primary/15 text-primary mt-0.5">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground flex items-center gap-1.5">
                            High-Fidelity Editable Word
                            <Badge variant="secondary" className="text-[9px] py-0 px-1">
                              Default
                            </Badge>
                          </p>
                          <p className="text-muted-foreground leading-relaxed text-[11px]">
                            Reconstructs real paragraphs, headings, tables, code blocks, font styling, and embedded images while preserving page layout.
                          </p>
                        </div>
                      </div>

                      {/* Mode B: Visual */}
                      <div
                        onClick={() => handleModeChange('visual')}
                        className={cn(
                          'p-3 rounded-lg border cursor-pointer transition-colors flex items-start gap-3 text-xs',
                          conversionMode === 'visual'
                            ? 'border-primary bg-primary/10 shadow-xs ring-1 ring-primary/30'
                            : 'border-border hover:bg-muted/50'
                        )}
                      >
                        <div className="p-1.5 rounded-md bg-teal-500/15 text-teal-600 dark:text-teal-400 mt-0.5">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">
                            Visual Layout Preservation
                          </p>
                          <p className="text-muted-foreground leading-relaxed text-[11px]">
                            Renders each page as a pixel-perfect high-DPI image inside Word. Best for brochures and flyers (pages non-editable).
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Formatting Options (Enabled for Mode A) */}
                  {conversionMode === 'editable' && (
                    <Card>
                      <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Settings2 className="h-4 w-4 text-primary" />
                          Document Layout Options
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Configure layout reconstruction rules
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3.5 px-4 sm:px-5 pb-5 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Preserve Page Breaks</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Maintain original PDF page pagination
                            </p>
                          </div>
                          <Switch
                            checked={preservePageBreaks}
                            onCheckedChange={setPreservePageBreaks}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Smart Heading Hierarchy</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Detect titles & headings based on size
                            </p>
                          </div>
                          <Switch
                            checked={smartHeadingDetection}
                            onCheckedChange={setSmartHeadingDetection}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Reconstruct Real Tables</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Convert detected grids to Word tables
                            </p>
                          </div>
                          <Switch
                            checked={detectTables}
                            onCheckedChange={setDetectTables}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Format Code Blocks</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Style programming code with Consolas font
                            </p>
                          </div>
                          <Switch
                            checked={detectCodeBlocks}
                            onCheckedChange={setDetectCodeBlocks}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Extract Embedded Images</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Preserve images with original dimensions
                            </p>
                          </div>
                          <Switch
                            checked={extractImages}
                            onCheckedChange={setExtractImages}
                          />
                        </div>

                        <div className="pt-2 border-t space-y-1.5">
                          <Label className="text-xs">Primary Font Family</Label>
                          <Select
                            value={defaultFontFamily}
                            onValueChange={setDefaultFontFamily}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Arial">Arial (Standard)</SelectItem>
                              <SelectItem value="Calibri">Calibri (Modern)</SelectItem>
                              <SelectItem value="Times New Roman">Times New Roman (Formal)</SelectItem>
                              <SelectItem value="Georgia">Georgia (Editorial)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Action Download Button */}
                  <Button
                    className="w-full h-11 text-sm font-semibold shadow-md touch-manipulation"
                    onClick={handleDownloadDocx}
                    disabled={pdfToWordLoading || pdfToWordExporting}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {pdfToWordExporting
                      ? 'Generating .docx...'
                      : `Download Word Document (.DOCX)`}
                  </Button>
                </div>

                {/* Right Reconstructed Document Preview */}
                <div className="lg:col-span-7">
                  <Card className="h-full flex flex-col">
                    <CardHeader className="py-3 px-4 sm:px-5 border-b flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Eye className="h-4 w-4 text-primary" />
                          Document Layout Preview
                        </CardTitle>
                        <CardDescription className="text-[11px]">
                          {conversionMode === 'editable'
                            ? 'Page structure with reconstructed headings, tables & code'
                            : 'Visual layout replica mode preview'}
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-2">
                        {analyzedPages.length > 1 && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={activeWordPreviewPage <= 1}
                              onClick={() => setActiveWordPreviewPage((p) => Math.max(1, p - 1))}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <span className="text-xs px-1 font-medium">
                              Page {activeWordPreviewPage} of {analyzedPages.length}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={activeWordPreviewPage >= analyzedPages.length}
                              onClick={() =>
                                setActiveWordPreviewPage((p) =>
                                  Math.min(analyzedPages.length, p + 1)
                                )
                              }
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs touch-manipulation"
                          onClick={() => {
                            const full = analyzedPages.map((p) => `--- Page ${p.pageNumber} ---\n\n${p.rawText}`).join('\n\n');
                            navigator.clipboard.writeText(full);
                            setWordExportCopied(true);
                            toast.success('Document text copied to clipboard!');
                            setTimeout(() => setWordExportCopied(false), 2000);
                          }}
                        >
                          {wordExportCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 sm:p-6 flex-1 max-h-[580px] overflow-y-auto bg-muted/20">
                      <ConversionErrorBoundary>
                        {currentPageData ? (
                          <div className="bg-card p-5 sm:p-7 rounded-lg shadow-sm border space-y-4">
                            {/* Page Info Header */}
                            <div className="flex items-center justify-between pb-2 border-b text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  Page {currentPageData.pageNumber}
                                </span>
                                <Badge variant="outline" className="text-[10px] py-0 px-1">
                                  {currentPageData.orientation} ({Math.round(currentPageData.widthPt)} × {Math.round(currentPageData.heightPt)} pt)
                                </Badge>
                                {currentPageData.isCoverPage && (
                                  <Badge variant="secondary" className="text-[10px] py-0 px-1">
                                    Cover Page
                                  </Badge>
                                )}
                              </div>
                              <span>{Array.isArray(currentPageData.blocks) ? currentPageData.blocks.length : 0} elements</span>
                            </div>

                            {/* Render Blocks defensively */}
                            <div className="space-y-3 text-xs sm:text-sm text-foreground leading-relaxed">
                              {Array.isArray(currentPageData.blocks) &&
                                renderBlockList(currentPageData.blocks)}
                            </div>
                          </div>
                        ) : (
                          <p className="text-center text-xs text-muted-foreground py-8">
                            No page selected.
                          </p>
                        )}
                      </ConversionErrorBoundary>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 3: PDF TO EXCEL (.PDF -> .XLSX / .CSV)                */}
        {/* ========================================================= */}
        <TabsContent value="pdf-to-excel" className="space-y-6">
          {!pdfToExcelFile ? (
            <Card>
              <CardContent className="p-5 sm:p-7">
                <FileUploader
                  accept=".pdf,application/pdf"
                  multiple={false}
                  onFilesSelected={handlePdfToExcelFileSelected}
                  label="Drop PDF to Convert to Excel (.xlsx)"
                  description="Upload bank statements, invoices, tables, or financial reports to extract clean spreadsheet data"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* File Info Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-card border rounded-lg shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{pdfToExcelFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(pdfToExcelFile.size)} • {detectedTables.length} distinct table{detectedTables.length > 1 ? 's' : ''} detected • {totalTableRows} total rows
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPdfToExcelFile(null);
                      setDetectedTables([]);
                      setExcelPages([]);
                    }}
                    className="h-8 text-xs touch-manipulation"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Change PDF
                  </Button>
                </div>
              </div>

              {/* Conversion Settings & Controls */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Controls */}
                <div className="lg:col-span-5 space-y-4">
                  <Card>
                    <CardHeader className="pb-3 pt-4 px-4 sm:px-5">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-emerald-500" />
                        Spreadsheet Settings
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Configure sheets layout, number detection, and delimiters
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 px-4 sm:px-5 pb-5 text-xs sm:text-sm">
                      {/* Workbook Sheet Layout */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Workbook Sheet Layout</Label>
                        <Select
                          value={excelLayout}
                          onValueChange={(val) => setExcelLayout(val as 'multi-sheet' | 'single-sheet')}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Layout" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="multi-sheet">Separate Sheet per Table (Named by Table Heading)</SelectItem>
                            <SelectItem value="single-sheet">Single Sheet (All Tables Stacked)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Detected Tables Summary */}
                      {detectedTables.length > 0 && (
                        <div className="p-3 bg-muted/40 rounded-lg border border-border/60 space-y-2">
                          <Label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider">
                            Detected Tables ({detectedTables.length})
                          </Label>
                          <div className="flex flex-wrap gap-1.5">
                            {detectedTables.map((tbl, idx) => (
                              <button
                                key={tbl.id}
                                onClick={() => setActiveTableIndex(idx)}
                                className={cn(
                                  'text-xs px-2.5 py-1 rounded-md border text-left transition-colors touch-manipulation',
                                  activeTableIndex === idx
                                    ? 'bg-primary/10 border-primary text-primary font-medium'
                                    : 'bg-card hover:bg-muted/70 text-muted-foreground border-border'
                                )}
                              >
                                {tbl.name} ({tbl.rows.length} rows)
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Delimiter for CSV */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">CSV Export Delimiter</Label>
                        <Select
                          value={csvDelimiter}
                          onValueChange={(val) => setCsvDelimiter(val as any)}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Delimiter" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value=",">Comma (,)</SelectItem>
                            <SelectItem value="&#9;">Tab (\t)</SelectItem>
                            <SelectItem value=";">Semicolon (;)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Number detection */}
                      <div className="pt-2 border-t flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-xs font-medium">Professional Number & Currency Formatting</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Format currency (₹, $), percentages, and decimal numbers with native Excel calculation types
                          </p>
                        </div>
                        <Switch
                          checked={autoParseNumbers}
                          onCheckedChange={setAutoParseNumbers}
                        />
                      </div>

                      {/* Action Buttons */}
                      <div className="pt-3 space-y-2.5">
                        <Button
                          className="w-full h-11 text-sm font-semibold shadow-md touch-manipulation"
                          onClick={handleDownloadXlsx}
                          disabled={pdfToExcelExporting || detectedTables.length === 0}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          {pdfToExcelExporting
                            ? 'Generating XLSX...'
                            : `Download Excel (.XLSX) • ${detectedTables.length} Sheets`}
                        </Button>

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            className="h-9 text-xs touch-manipulation"
                            onClick={handleDownloadCsv}
                            disabled={detectedTables.length === 0}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                            Download .CSV
                          </Button>

                          <Button
                            variant="outline"
                            className="h-9 text-xs touch-manipulation"
                            onClick={handleCopyTsv}
                            disabled={detectedTables.length === 0}
                          >
                            {excelCopied ? (
                              <>
                                <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                Copy (TSV)
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Interactive Spreadsheet Grid Preview */}
                <div className="lg:col-span-7">
                  <Card className="h-full flex flex-col">
                    <CardHeader className="py-3 px-4 sm:px-5 border-b flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <TableIcon className="h-4 w-4 text-emerald-500" />
                          Table Preview: {currentTable?.name || 'Spreadsheet'}
                        </CardTitle>
                        <CardDescription className="text-[11px] flex items-center gap-2 flex-wrap pt-0.5">
                          {currentTable && (
                            <>
                              <span>{currentTable.rows.length} rows × {currentTable.columnCount} columns</span>
                              <span>•</span>
                              <span>Page {currentTable.startPage}{currentTable.endPage !== currentTable.startPage ? `-${currentTable.endPage}` : ''}</span>
                              {currentTable.rows.some((r) => r.some((c) => c.isCurrency)) && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                                  ₹/$ Currency
                                </Badge>
                              )}
                              {currentTable.rows.some((r) => r.some((c) => c.isPercent)) && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 text-blue-600 dark:text-blue-400 bg-blue-500/10">
                                  % Percent
                                </Badge>
                              )}
                              {currentTable.endPage > currentTable.startPage && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 text-primary bg-primary/10">
                                  Multi-page Stitched
                                </Badge>
                              )}
                            </>
                          )}
                        </CardDescription>
                      </div>

                      {/* Table Switcher */}
                      {detectedTables.length > 1 && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={activeTableIndex <= 0}
                            onClick={() => setActiveTableIndex((i) => Math.max(0, i - 1))}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="text-xs px-1 font-medium">
                            Table {activeTableIndex + 1} of {detectedTables.length}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={activeTableIndex >= detectedTables.length - 1}
                            onClick={() => setActiveTableIndex((i) => Math.min(detectedTables.length - 1, i + 1))}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </CardHeader>

                    <CardContent className="p-0 flex-1 max-h-[560px] overflow-auto bg-muted/20">
                      {currentTable && currentTable.rows.length > 0 ? (
                        <div className="min-w-full inline-block align-middle">
                          <table className="min-w-full border-collapse text-xs">
                            <thead className="bg-muted sticky top-0 z-10 border-b">
                              <tr>
                                <th className="w-10 p-2 text-center text-muted-foreground font-mono text-[10px] border-r">
                                  #
                                </th>
                                {Array.from({ length: currentTable.columnCount }).map((_, cIdx) => (
                                  <th
                                    key={cIdx}
                                    className="p-2 text-left font-mono text-[11px] font-semibold text-muted-foreground border-r last:border-r-0"
                                  >
                                    {String.fromCharCode(65 + (cIdx % 26))}
                                  </th>
                                ))}
                              </tr>
                              {currentTable.headers && currentTable.headers.length > 0 && (
                                <tr className="bg-muted/80 font-bold border-b text-foreground">
                                  <td className="p-2 text-center text-muted-foreground font-mono text-[10px] border-r">
                                    H
                                  </td>
                                  {currentTable.headers.map((h, hIdx) => (
                                    <td
                                      key={hIdx}
                                      className="p-2 text-xs font-semibold text-foreground border-r last:border-r-0"
                                    >
                                      {h}
                                    </td>
                                  ))}
                                </tr>
                              )}
                            </thead>
                            <tbody className="divide-y divide-border bg-card">
                              {currentTable.rows.map((row, rIdx) => (
                                <tr key={rIdx} className={cn(rIdx % 2 === 1 ? 'bg-muted/20' : '', 'hover:bg-muted/40 transition-colors')}>
                                  <td className="p-2 text-center text-muted-foreground font-mono text-[10px] bg-muted/30 border-r select-none">
                                    {rIdx + 1}
                                  </td>
                                  {row.map((cell, cIdx) => (
                                    <td
                                      key={cIdx}
                                      className={cn(
                                        'p-2 text-xs border-r last:border-r-0 max-w-[200px] truncate',
                                        cell.type === 'n' ? 'text-right font-mono' : 'text-left text-foreground',
                                        cell.isCurrency && 'text-emerald-600 dark:text-emerald-400 font-medium'
                                      )}
                                      title={cell.raw}
                                    >
                                      {cell.raw || <span className="text-muted-foreground/40 italic">-</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-8 text-center text-xs text-muted-foreground">
                          No table rows detected.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
