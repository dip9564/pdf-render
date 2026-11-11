import { pdfjsLib } from '@/lib/pdfWorker';
import { createWorker } from 'tesseract.js';
import {
  ExtractedPageData,
  ConversionOptions,
  ConversionProgress,
} from './types';
import { analyzePdfPage } from './layoutAnalyzer';
import { buildHighFidelityDocx, buildVisualLayoutDocx } from './docxEngine';
import { runStructuredOcrOnPage } from './ocrProcessor';

export interface ConvertResult {
  docxBlob: Blob;
  pages: ExtractedPageData[];
  totalWords: number;
  scannedPagesCount: number;
  tablesCount: number;
  codeBlocksCount: number;
  imagesCount: number;
  ocrReviewCount: number;
}

export async function convertPdfToDocx(
  file: File,
  options: ConversionOptions,
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConvertResult> {
  if (!file || file.size === 0) {
    throw new Error('Selected PDF file is empty (0 bytes). Please upload a valid PDF document.');
  }

  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Could not read PDF data. File appears to be empty or inaccessible.');
  }

  // Quick check for PDF signature within the first 1024 bytes (PDF spec allows leading comments/whitespace)
  const probeBytes = new Uint8Array(buffer.slice(0, Math.min(1024, buffer.byteLength)));
  const headerStr = String.fromCharCode(...probeBytes);
  if (!headerStr.includes('%PDF')) {
    throw new Error('The selected file is not a valid PDF document (missing %PDF header).');
  }

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  }

  const baseUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    password: '',
    cMapUrl: `${normalizedBase}assets/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${normalizedBase}assets/pdfjs/standard_fonts/`,
  }).promise;

  const totalPages = pdfDoc.numPages;
  const pages: ExtractedPageData[] = [];

  // Stage 1: Analyze each page layout & structure
  for (let i = 1; i <= totalPages; i++) {
    onProgress?.({
      stage: 'analyzing',
      currentPage: i,
      totalPages,
      message: `Analyzing layout & structure of Page ${i} of ${totalPages}...`,
      percent: Math.round(((i - 0.5) / totalPages) * 60),
    });

    try {
      const page = await pdfDoc.getPage(i);
      const pageData = await analyzePdfPage(page, options);
      pages.push(pageData);
    } catch (pageErr) {
      console.warn(`Resilient fallback parsing for Page ${i}:`, pageErr);
      try {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const textLines = textContent.items
          .map((item: any) => item.str || '')
          .filter((t: string) => t.trim().length > 0);
        pages.push({
          pageNumber: i,
          widthPt: 595.28,
          heightPt: 841.89,
          orientation: 'portrait',
          marginsPt: { top: 54, bottom: 54, left: 54, right: 54 },
          blocks: textLines.map((l: string) => ({
            type: 'paragraph' as const,
            alignment: 'left' as const,
            spans: [
              {
                text: l,
                fontSize: 11,
                fontFamily: options.defaultFontFamily,
                isBold: false,
                isItalic: false,
                isMonospace: false,
                color: '#111827',
              },
            ],
          })),
          rawText: textLines.join('\n'),
          wordCount: textLines.join(' ').split(/\s+/).filter(Boolean).length,
          isScanned: textLines.length === 0,
          isCoverPage: false,
          hasTables: false,
          hasCode: false,
          hasImages: false,
        });
      } catch (innerErr) {
        console.error(`Page ${i} could not be extracted:`, innerErr);
      }
    }
  }

  // Stage 2: Structured OCR for Scanned Pages (with preprocessing, deskewing, table/heading recovery, and confidence flagging)
  const scannedIndices: number[] = [];
  pages.forEach((p, idx) => {
    if (p.isScanned) scannedIndices.push(idx);
  });

  if (options.enableOcr && scannedIndices.length > 0) {
    onProgress?.({
      stage: 'ocr',
      currentPage: 1,
      totalPages: scannedIndices.length,
      message: `Initializing OCR engine for ${scannedIndices.length} scanned page(s)...`,
      percent: 65,
    });

    try {
      const worker = await createWorker(options.ocrLanguage || 'eng');

      for (let sIdx = 0; sIdx < scannedIndices.length; sIdx++) {
        const pageIdx = scannedIndices[sIdx];
        const scPage = pages[pageIdx];
        onProgress?.({
          stage: 'ocr',
          currentPage: sIdx + 1,
          totalPages: scannedIndices.length,
          message: `Preprocessing, deskewing & reconstructing Scanned Page ${scPage.pageNumber}...`,
          percent: 65 + Math.round(((sIdx + 1) / scannedIndices.length) * 22),
        });

        const pdfPage = await pdfDoc.getPage(scPage.pageNumber);
        const ocrPageData = await runStructuredOcrOnPage(pdfPage, worker, options);

        if (ocrPageData.blocks.length > 0 && ocrPageData.wordCount > 0) {
          // Preserve scanner header/footer metadata if present prior to OCR and replace full-page scan image without duplicating
          if (!ocrPageData.headerText && scPage.headerText) {
            ocrPageData.headerText = scPage.headerText;
          }
          if (!ocrPageData.footerText && scPage.footerText) {
            ocrPageData.footerText = scPage.footerText;
          }
          if (!ocrPageData.hasPageNumbers && scPage.hasPageNumbers) {
            ocrPageData.hasPageNumbers = scPage.hasPageNumbers;
          }
          pages[pageIdx] = ocrPageData;
        }
      }

      await worker.terminate();
    } catch (ocrErr) {
      console.warn('OCR processing warning:', ocrErr);
    }
  }

  // Stage 3: Build Word Document (.docx)
  onProgress?.({
    stage: 'building',
    currentPage: totalPages,
    totalPages,
    message:
      options.mode === 'visual'
        ? 'Reconstructing visual replica in Word...'
        : 'Building high-fidelity editable Word document...',
    percent: 90,
  });

  let docxBlob: Blob;
  if (options.mode === 'visual') {
    docxBlob = await buildVisualLayoutDocx(pdfDoc, pages);
  } else {
    try {
      docxBlob = await buildHighFidelityDocx(pages, options);
    } catch (buildErr) {
      console.warn('buildHighFidelityDocx fallback to visual layout:', buildErr);
      docxBlob = await buildVisualLayoutDocx(pdfDoc, pages);
    }
  }

  onProgress?.({
    stage: 'complete',
    currentPage: totalPages,
    totalPages,
    message: 'Word document (.docx) ready!',
    percent: 100,
  });

  const totalWords = pages.reduce((acc, p) => acc + p.wordCount, 0);
  const scannedPagesCount = pages.filter((p) => p.isScanned).length;
  const tablesCount = pages.filter((p) => p.hasTables).length;
  const codeBlocksCount = pages.filter((p) => p.hasCode).length;
  const imagesCount = pages.filter((p) => p.hasImages).length;
  const ocrReviewCount = pages.reduce((acc, p) => acc + (p.ocrReviewCount || 0), 0);

  return {
    docxBlob,
    pages,
    totalWords,
    scannedPagesCount,
    tablesCount,
    codeBlocksCount,
    imagesCount,
    ocrReviewCount,
  };
}
