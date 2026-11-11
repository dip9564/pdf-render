import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from 'pdf-lib';

// A4 Portrait exact dimensions in PDF points (72 pt = 1 inch)
export const A4_PORTRAIT_WIDTH = 595.28;
export const A4_PORTRAIT_HEIGHT = 841.89;

export const MAX_LOGO_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_EXISTING_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

export const DEFAULT_COLLEGE_NAME = 'KALYANI GOVERNMENT ENGINEERING COLLEGE';
export const DEFAULT_COLLEGE_FONT_SIZE_PT = 15;
export const MIN_COLLEGE_FONT_SIZE_PT = 12;
export const MAX_COLLEGE_FONT_SIZE_PT = 30;
export const DEFAULT_BORDER_MARGIN_PT = 44;
export const MIN_BORDER_MARGIN_PT = 24;
export const MAX_BORDER_MARGIN_PT = 64;
export const DEFAULT_LOGO_SIZE_PT = 74;
export const MIN_LOGO_SIZE_PT = 44;
export const MAX_LOGO_SIZE_PT = 110;

export type LogoMode = 'kgec' | 'custom' | 'none';
export type LogoPosition = 'left' | 'center';
export type LogoImageFormat = 'png' | 'jpg';

export interface LogoImagePayload {
  bytes: Uint8Array;
  format: LogoImageFormat;
  width: number;
  height: number;
}

export interface FrontPageDetails {
  collegeName: string;
  mainTitle: string;
  assignmentTitle: string;
  name: string;
  rollNo: string;
  registrationNo: string;
  department: string;
  subject: string;
  subjectCode: string;
  semester: string;
  year: string;
}

export interface FrontPageConfig {
  logoMode: LogoMode;
  logoPosition?: LogoPosition;
  logoSizePt?: number;
  collegeFontSizePt?: number;
  borderMarginPt?: number;
  logo?: LogoImagePayload | null;
  details: FrontPageDetails;
}

export type FrontPageErrorCode =
  | 'NO_LOGO_SELECTED'
  | 'INVALID_LOGO'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'CORRUPTED_PDF'
  | 'PDF_GENERATION_FAILED'
  | 'PDF_MERGE_FAILED';

export class FrontPageError extends Error {
  public readonly code: FrontPageErrorCode;

  constructor(code: FrontPageErrorCode, message: string) {
    super(message);
    this.name = 'FrontPageError';
    this.code = code;
  }
}

export interface ExistingPdfPageMeta {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  orientation: 'portrait' | 'landscape';
}

export interface ExistingPdfInfo {
  pageCount: number;
  pages: ExistingPdfPageMeta[];
  hasLandscapePages: boolean;
  hasPortraitPages: boolean;
  hasMixedDimensions: boolean;
  hasUnusualDimensions: boolean;
}

export interface MergeFrontPageResult {
  pdfBytes: Uint8Array;
  totalPages: number;
  originalPageCount: number;
  existingPdfInfo: ExistingPdfInfo;
}

export const EMPTY_FRONT_PAGE_DETAILS: FrontPageDetails = {
  collegeName: DEFAULT_COLLEGE_NAME,
  mainTitle: '',
  assignmentTitle: '',
  name: '',
  rollNo: '',
  registrationNo: '',
  department: '',
  subject: '',
  subjectCode: '',
  semester: '',
  year: '',
};

/**
 * Sanitizes strings so pdf-lib StandardFonts (WinAnsi encoding) never fail
 * on smart punctuation, Unicode spaces, emojis, or pasted characters.
 */
export function sanitizeWinAnsiText(input: string, preserveNewlines = false): string {
  if (!input) return '';

  const normalized = input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2212]/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '-')
    .replace(/\t/g, '  ');

  const lines = preserveNewlines ? normalized.split('\n') : [normalized.replace(/\n+/g, ' ')];

  return lines
    .map((line) => {
      let out = '';
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 32;
        if (
          (code >= 0x20 && code <= 0x7e) ||
          (code >= 0xa0 && code <= 0xff) ||
          code === 0x20ac || // €
          code === 0x2122 || // ™
          code === 0x0160 || // Š
          code === 0x0161 || // š
          code === 0x0152 || // Œ
          code === 0x0153 || // œ
          code === 0x0178    // Ÿ
        ) {
          out += ch;
        } else {
          out += ' ';
        }
      }
      return out.replace(/\s+/g, ' ').trim();
    })
    .filter((line, idx, arr) => preserveNewlines || idx === 0 || arr.length === 1)
    .join('\n')
    .trim();
}

/**
 * Safe text width measurement guarding against rare encoding edge cases.
 */
function safeTextWidth(font: PDFFont, text: string, size: number): number {
  const safe = sanitizeWinAnsiText(text, false);
  if (!safe) return 0;
  try {
    return font.widthOfTextAtSize(safe, size);
  } catch {
    const ascii = safe.replace(/[^\x20-\x7e]/g, '?');
    return font.widthOfTextAtSize(ascii, size);
  }
}

/**
 * Wraps text into lines within maxWidth using greedy word wrapping,
 * breaking overlong unbroken words cleanly so text never overflows boundaries.
 */
export function wrapTextToWidth(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const cleaned = sanitizeWinAnsiText(text, true);
  if (!cleaned) return [];

  const effectiveMaxWidth = Math.max(40, maxWidth);
  const paragraphs = cleaned.split('\n');
  const resultLines: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    const words = trimmedPara.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (safeTextWidth(font, candidate, fontSize) <= effectiveMaxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          resultLines.push(currentLine);
          currentLine = '';
        }

        // Handle exceptionally long single token (e.g. URL/long code without spaces)
        if (safeTextWidth(font, word, fontSize) > effectiveMaxWidth) {
          let chunk = '';
          for (const ch of word) {
            const nextChunk = chunk + ch;
            if (safeTextWidth(font, nextChunk, fontSize) > effectiveMaxWidth && chunk) {
              resultLines.push(chunk);
              chunk = ch;
            } else {
              chunk = nextChunk;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      resultLines.push(currentLine);
    }
  }

  return resultLines;
}

/**
 * Validates an uploaded logo File for format, extension, non-emptiness, and size.
 */
export function validateLogoFile(file: File): {
  valid: boolean;
  detectedType?: 'png' | 'jpg' | 'svg';
  error?: string;
} {
  if (!file) {
    return { valid: false, error: 'No logo file provided.' };
  }

  if (file.size === 0) {
    return { valid: false, error: `"${file.name}" is empty (0 bytes). Please choose a valid image.` };
  }

  if (file.size > MAX_LOGO_FILE_SIZE) {
    return {
      valid: false,
      error: `"${file.name}" exceeds the 10 MB logo limit. Please upload a smaller image.`,
    };
  }

  const lowerName = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const isPng = mime === 'image/png' || lowerName.endsWith('.png');
  const isJpg = mime === 'image/jpeg' || mime === 'image/jpg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
  const isSvg = mime === 'image/svg+xml' || lowerName.endsWith('.svg');

  if (!isPng && !isJpg && !isSvg) {
    return {
      valid: false,
      error: `Unsupported logo format "${file.name}". Please upload a PNG, JPG, JPEG, or SVG image.`,
    };
  }

  if (isSvg) return { valid: true, detectedType: 'svg' };
  if (isPng) return { valid: true, detectedType: 'png' };
  return { valid: true, detectedType: 'jpg' };
}

/**
 * Checks raw PNG / JPG magic bytes quickly so spoofed/corrupted binary files are caught early.
 */
export function detectRasterImageSignature(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length < 8) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

/**
 * Browser helper: validates and prepares a PNG, JPG, JPEG, or SVG file into
 * embed-ready raster bytes plus exact natural dimensions (preserving aspect ratio).
 */
export async function prepareLogoImageFromFile(file: File): Promise<LogoImagePayload> {
  const validation = validateLogoFile(file);
  if (!validation.valid || !validation.detectedType) {
    throw new FrontPageError('INVALID_LOGO', validation.error || 'Invalid logo file.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(arrayBuffer);

  if (validation.detectedType === 'svg') {
    const svgText = new TextDecoder().decode(rawBytes);
    if (!/<svg[\s>]/i.test(svgText)) {
      throw new FrontPageError('INVALID_LOGO', `"${file.name}" is not a valid SVG image.`);
    }
    return rasterizeSvgToPng(svgText, file.name);
  }

  // Verify binary signature matches a real image (reject spoofed .png/.jpg text files)
  const signature = detectRasterImageSignature(rawBytes);
  if (!signature) {
    throw new FrontPageError(
      'INVALID_LOGO',
      `"${file.name}" is corrupted or not a valid PNG/JPG image.`
    );
  }

  // Decode in browser Image to verify readability & extract natural dimensions
  const blobUrl = URL.createObjectURL(
    new Blob([rawBytes as unknown as BlobPart], {
      type: signature === 'png' ? 'image/png' : 'image/jpeg',
    })
  );
  try {
    const img = await loadHtmlImage(blobUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (!width || !height || width <= 0 || height <= 0) {
      throw new FrontPageError('INVALID_LOGO', `"${file.name}" has invalid image dimensions.`);
    }

    // Re-verify pdf-lib compatibility quickly; if exotic PNG/JPG encoding fails, normalize cleanly via canvas PNG
    try {
      const probeDoc = await PDFDocument.create();
      if (signature === 'png') {
        await probeDoc.embedPng(rawBytes);
      } else {
        await probeDoc.embedJpg(rawBytes);
      }
      return {
        bytes: rawBytes,
        format: signature,
        width,
        height,
      };
    } catch {
      const normalizedBytes = await rasterizeImageElementToPng(img);
      return {
        bytes: normalizedBytes,
        format: 'png',
        width,
        height,
      };
    }
  } catch (err) {
    if (err instanceof FrontPageError) throw err;
    throw new FrontPageError(
      'INVALID_LOGO',
      `Could not decode image "${file.name}". Please ensure it is a valid PNG, JPG, or SVG file.`
    );
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Browser helper: loads a bundled asset URL (such as kgec-logo.jpg) into a LogoImagePayload.
 */
export async function loadLogoPayloadFromUrl(
  url: string,
  formatHint: LogoImageFormat = 'jpg'
): Promise<LogoImagePayload> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new FrontPageError('INVALID_LOGO', 'Failed to load default KGEC logo asset.');
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const detected = detectRasterImageSignature(bytes) || formatHint;

  const blobUrl = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], {
      type: detected === 'png' ? 'image/png' : 'image/jpeg',
    })
  );
  try {
    const img = await loadHtmlImage(blobUrl);
    return {
      bytes,
      format: detected,
      width: img.naturalWidth || 1024,
      height: img.naturalHeight || 1024,
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = src;
  });
}

async function rasterizeImageElementToPng(img: HTMLImageElement): Promise<Uint8Array> {
  const w = img.naturalWidth || img.width || 512;
  const h = img.naturalHeight || img.height || 512;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new FrontPageError('INVALID_LOGO', 'Canvas 2D context unavailable for logo processing.');
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!pngBlob) {
    throw new FrontPageError('INVALID_LOGO', 'Failed to encode logo to PNG.');
  }
  return new Uint8Array(await pngBlob.arrayBuffer());
}

async function rasterizeSvgToPng(svgText: string, fileName: string): Promise<LogoImagePayload> {
  // Ensure explicit viewBox dimensions are parsed if width/height attributes are absent
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new FrontPageError('INVALID_LOGO', `"${fileName}" contains invalid SVG XML.`);
  }

  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
    throw new FrontPageError('INVALID_LOGO', `"${fileName}" does not contain a root <svg> element.`);
  }

  let baseW = parseFloat(svgEl.getAttribute('width') || '');
  let baseH = parseFloat(svgEl.getAttribute('height') || '');
  const viewBox = svgEl.getAttribute('viewBox');

  if ((!baseW || !baseH || isNaN(baseW) || isNaN(baseH)) && viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      baseW = parts[2];
      baseH = parts[3];
    }
  }

  if (!baseW || !baseH || isNaN(baseW) || isNaN(baseH) || baseW <= 0 || baseH <= 0) {
    baseW = 512;
    baseH = 512;
  }

  const targetMax = 768;
  const scale = targetMax / Math.max(baseW, baseH);
  const outW = Math.max(64, Math.round(baseW * scale));
  const outH = Math.max(64, Math.round(baseH * scale));

  // Set explicit pixel width/height on serialized SVG so all browsers rasterize crisply
  svgEl.setAttribute('width', String(outW));
  svgEl.setAttribute('height', String(outH));
  const serialized = new XMLSerializer().serializeToString(svgEl);

  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadHtmlImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new FrontPageError('INVALID_LOGO', 'Failed to initialize canvas for SVG rendering.');
    }
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);
    const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!pngBlob) {
      throw new FrontPageError('INVALID_LOGO', `Failed to rasterize SVG "${fileName}".`);
    }
    return {
      bytes: new Uint8Array(await pngBlob.arrayBuffer()),
      format: 'png',
      width: outW,
      height: outH,
    };
  } catch (err) {
    if (err instanceof FrontPageError) throw err;
    throw new FrontPageError('INVALID_LOGO', `Failed to render SVG logo "${fileName}".`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface StudentRowField {
  label: string;
  value: string;
}

function getActiveStudentRows(details: FrontPageDetails): StudentRowField[] {
  const candidates: StudentRowField[] = [
    { label: 'Name', value: sanitizeWinAnsiText(details.name) },
    { label: 'Roll No.', value: sanitizeWinAnsiText(details.rollNo) },
    { label: 'Registration No.', value: sanitizeWinAnsiText(details.registrationNo) },
    { label: 'Department', value: sanitizeWinAnsiText(details.department) },
    { label: 'Subject', value: sanitizeWinAnsiText(details.subject) },
    { label: 'Subject Code', value: sanitizeWinAnsiText(details.subjectCode) },
    { label: 'Semester', value: sanitizeWinAnsiText(details.semester) },
  ];
  return candidates.filter((row) => row.value.length > 0);
}

export function hasAnyVisibleFrontPageContent(config: FrontPageConfig): boolean {
  const d = config.details;
  const hasLogo = config.logoMode !== 'none' && Boolean(config.logo);
  const hasText = [
    d.collegeName,
    d.mainTitle,
    d.assignmentTitle,
    d.name,
    d.rollNo,
    d.registrationNo,
    d.department,
    d.subject,
    d.subjectCode,
    d.semester,
    d.year,
  ].some((v) => Boolean(v && v.trim().length > 0));
  return hasLogo || hasText;
}

function formatYearLine(rawYear: string): string {
  const clean = sanitizeWinAnsiText(rawYear);
  if (!clean) return '';
  if (/^year\s*:/i.test(clean)) {
    return clean;
  }
  return `Year: ${clean}`;
}

interface ComputedFrontPagePlan {
  scale: number;
  // Header
  drawLogo: boolean;
  logoRect: { x: number; y: number; width: number; height: number } | null;
  collegeFontSize: number;
  collegeLineHeight: number;
  collegeLines: string[];
  collegeAlign: 'left' | 'center';
  collegeBlockX: number;
  collegeBlockWidth: number;
  collegeFirstBaselineY: number;
  headerBottomY: number;
  // Titles (no horizontal rule underneath Main Title)
  mainTitleFontSize: number;
  mainTitleLineHeight: number;
  mainTitleLines: string[];
  mainTitleFirstBaselineY: number;
  assignmentTitleFontSize: number;
  assignmentTitleLineHeight: number;
  assignmentTitleLines: string[];
  assignmentTitleFirstBaselineY: number;
  titlesBottomY: number;
  // Student details
  detailFontSize: number;
  detailLineHeight: number;
  detailRowGap: number;
  labelStartX: number;
  colonX: number;
  valueStartX: number;
  detailRows: { label: string; valueLines: string[] }[];
  detailsFirstBaselineY: number;
  detailsBottomY: number;
  // Year
  yearFontSize: number;
  yearLineHeight: number;
  yearLines: string[];
  yearFirstBaselineY: number;
  // Overflow indicator
  totalRequiredHeight: number;
  fitsInsideBorder: boolean;
}

/**
 * Computes exact layout geometry for a given font/gap scale factor, ensuring
 * zero collisions, dynamic omission of empty fields, and preserved logo aspect ratio.
 */
function buildLayoutPlan(
  params: {
    innerLeft: number;
    innerRight: number;
    innerBottom: number;
    innerTop: number;
    innerWidth: number;
    innerHeight: number;
    logoMode: LogoMode;
    logoPosition: LogoPosition;
    logoSizePt: number;
    collegeFontSizePt: number;
    logoDims: { width: number; height: number } | null;
    collegeName: string;
    mainTitle: string;
    assignmentTitle: string;
    activeRows: StudentRowField[];
    yearText: string;
    timesRoman: PDFFont;
    timesRomanBold: PDFFont;
    helveticaBold: PDFFont;
  },
  scale: number
): ComputedFrontPagePlan {
  const {
    innerLeft,
    innerRight,
    innerBottom,
    innerTop,
    innerWidth,
    logoMode,
    logoPosition,
    logoSizePt,
    collegeFontSizePt,
    logoDims,
    collegeName,
    mainTitle,
    assignmentTitle,
    activeRows,
    yearText,
    timesRoman,
    timesRomanBold,
    helveticaBold,
  } = params;

  const headerPadTop = 24 * scale;
  const headerPadX = 20 * scale;
  const drawLogo = logoMode !== 'none' && logoDims !== null;

  // 1. Logo Geometry (strict aspect ratio preservation!)
  let logoRect: { x: number; y: number; width: number; height: number } | null = null;
  if (drawLogo && logoDims) {
    const targetBox = Math.max(32, logoSizePt * (0.55 + 0.45 * scale));
    const maxAllowedW =
      logoPosition === 'left'
        ? Math.min(targetBox * 1.65, innerWidth * 0.34)
        : Math.min(targetBox * 2.2, innerWidth * 0.6);
    const maxAllowedH = targetBox;
    const ratio = Math.min(maxAllowedW / logoDims.width, maxAllowedH / logoDims.height);
    const drawW = logoDims.width * ratio;
    const drawH = logoDims.height * ratio;

    const logoX =
      logoPosition === 'center'
        ? innerLeft + (innerWidth - drawW) / 2
        : innerLeft + headerPadX;
    const logoY = innerTop - headerPadTop - drawH;
    logoRect = { x: logoX, y: logoY, width: drawW, height: drawH };
  }

  // 2. Bold College Name Typography & Header Alignment
  const cleanCollege = sanitizeWinAnsiText(collegeName, true);
  let collegeBlockX = innerLeft + headerPadX;
  let collegeBlockWidth = innerWidth - 2 * headerPadX;
  const collegeAlign: 'left' | 'center' = 'center';

  if (logoRect && logoPosition === 'left') {
    const logoTextGap = 14 * scale;
    collegeBlockX = logoRect.x + logoRect.width + logoTextGap;
    collegeBlockWidth = Math.max(90, innerRight - headerPadX - collegeBlockX);
  } else {
    collegeBlockX = innerLeft + headerPadX;
    collegeBlockWidth = innerWidth - 2 * headerPadX;
  }

  const clampedRequestedCollegeSize = Math.min(
    MAX_COLLEGE_FONT_SIZE_PT,
    Math.max(MIN_COLLEGE_FONT_SIZE_PT, collegeFontSizePt)
  );
  const collegeFontSize = clampedRequestedCollegeSize * scale;
  const collegeLines = cleanCollege
    ? wrapTextToWidth(cleanCollege, timesRomanBold, collegeFontSize, collegeBlockWidth)
    : [];

  const collegeLineHeight = collegeFontSize * 1.24;
  const capHeightRatio = 0.68;
  const nCollegeLines = collegeLines.length;

  let collegeFirstBaselineY: number;
  let headerBottomY: number;

  if (logoRect && logoPosition === 'left') {
    if (nCollegeLines > 0) {
      const logoCenterY = logoRect.y + logoRect.height / 2;
      // Optically align vertical midpoint of all wrapped lines with the logo center
      const idealFirstBaseline =
        logoCenterY -
        (capHeightRatio / 2) * collegeFontSize +
        ((nCollegeLines - 1) * collegeLineHeight) / 2;
      const maxSafeFirstBaseline = innerTop - headerPadTop * 0.72 - capHeightRatio * collegeFontSize;
      collegeFirstBaselineY = Math.min(idealFirstBaseline, maxSafeFirstBaseline);

      const lastBaselineY = collegeFirstBaselineY - (nCollegeLines - 1) * collegeLineHeight;
      const textBottomY = lastBaselineY - collegeFontSize * 0.25;
      headerBottomY = Math.min(logoRect.y, textBottomY);
    } else {
      collegeFirstBaselineY = innerTop - headerPadTop - capHeightRatio * collegeFontSize;
      headerBottomY = logoRect.y;
    }
  } else if (logoRect && logoPosition === 'center') {
    if (nCollegeLines > 0) {
      const gapLogoToName = 16 * scale;
      collegeFirstBaselineY = logoRect.y - gapLogoToName - capHeightRatio * collegeFontSize;
      const lastBaselineY = collegeFirstBaselineY - (nCollegeLines - 1) * collegeLineHeight;
      headerBottomY = lastBaselineY - collegeFontSize * 0.25;
    } else {
      collegeFirstBaselineY = logoRect.y;
      headerBottomY = logoRect.y;
    }
  } else {
    // Without Logo: center college name symmetrically with balanced top padding
    if (nCollegeLines > 0) {
      collegeFirstBaselineY = innerTop - 26 * scale - capHeightRatio * collegeFontSize;
      const lastBaselineY = collegeFirstBaselineY - (nCollegeLines - 1) * collegeLineHeight;
      headerBottomY = lastBaselineY - collegeFontSize * 0.25;
    } else {
      collegeFirstBaselineY = innerTop - 16 * scale;
      headerBottomY = innerTop - 16 * scale;
    }
  }

  // 3. Main Title & Assignment Title (No horizontal separator line under Main Title)
  const titleMaxW = innerWidth - 64;
  let mainTitleFontSize = 19 * scale;
  let mainTitleLines = mainTitle
    ? wrapTextToWidth(mainTitle, helveticaBold, mainTitleFontSize, titleMaxW)
    : [];
  if (mainTitleLines.length > 3) {
    mainTitleFontSize = Math.max(12.5, 16 * scale);
    mainTitleLines = wrapTextToWidth(mainTitle, helveticaBold, mainTitleFontSize, titleMaxW);
  }
  const mainTitleLineHeight = mainTitleFontSize * 1.28;

  let assignmentTitleFontSize = 16.5 * scale;
  let assignmentTitleLines = assignmentTitle
    ? wrapTextToWidth(assignmentTitle, timesRoman, assignmentTitleFontSize, titleMaxW)
    : [];
  if (assignmentTitleLines.length > 3) {
    assignmentTitleFontSize = Math.max(12, 14.5 * scale);
    assignmentTitleLines = wrapTextToWidth(assignmentTitle, timesRoman, assignmentTitleFontSize, titleMaxW);
  }
  const assignmentTitleLineHeight = assignmentTitleFontSize * 1.28;

  const hasMainTitle = mainTitleLines.length > 0;
  const hasAssignmentTitle = assignmentTitleLines.length > 0;
  const hasHeaderContent = drawLogo || nCollegeLines > 0;

  const gapHeaderToTitle = hasHeaderContent ? 50 * scale : 40 * scale;
  let cursorY = headerBottomY - gapHeaderToTitle;

  let mainTitleFirstBaselineY = cursorY;
  if (hasMainTitle) {
    mainTitleFirstBaselineY = cursorY - 0.72 * mainTitleFontSize;
    const mainTitleLastBaselineY =
      mainTitleFirstBaselineY - (mainTitleLines.length - 1) * mainTitleLineHeight;
    cursorY = mainTitleLastBaselineY - 0.22 * mainTitleFontSize;
  }

  let assignmentTitleFirstBaselineY = cursorY;
  if (hasAssignmentTitle) {
    const gapBetweenTitles = hasMainTitle ? 18 * scale : 0;
    assignmentTitleFirstBaselineY =
      cursorY - gapBetweenTitles - capHeightRatio * assignmentTitleFontSize;
    const assignLastBaselineY =
      assignmentTitleFirstBaselineY - (assignmentTitleLines.length - 1) * assignmentTitleLineHeight;
    cursorY = assignLastBaselineY - 0.22 * assignmentTitleFontSize;
  }

  const titlesBottomY = hasMainTitle || hasAssignmentTitle ? cursorY : headerBottomY;

  // 4. Student Details Table (Non-empty rows only!)
  const detailFontSize = 13.5 * scale;
  const detailLineHeight = detailFontSize * 1.56;
  const detailRowGap = 3.5 * scale;

  const labelStartX = innerLeft + Math.max(46 * scale, innerWidth * 0.13);
  const maxLabelW =
    activeRows.length > 0
      ? Math.max(...activeRows.map((r) => safeTextWidth(timesRoman, r.label, detailFontSize)))
      : 0;
  const minLabelColW = Math.min(56 * scale, innerWidth * 0.22);
  const labelColWidth = Math.max(maxLabelW + 12 * scale, activeRows.length > 0 ? minLabelColW : 0);
  const colonX = labelStartX + labelColWidth;
  const colonW = safeTextWidth(timesRoman, ':', detailFontSize);
  const valueStartX = colonX + colonW + 6 * scale;
  const valueMaxW = Math.max(80, innerRight - 20 * scale - valueStartX);

  const detailRows = activeRows.map((row) => ({
    label: row.label,
    valueLines: wrapTextToWidth(row.value, timesRoman, detailFontSize, valueMaxW),
  }));

  const totalDetailSubLines = detailRows.reduce(
    (acc, r) => acc + Math.max(1, r.valueLines.length),
    0
  );
  const detailsBaselineSpan =
    detailRows.length > 0
      ? (totalDetailSubLines - 1) * detailLineHeight + (detailRows.length - 1) * detailRowGap
      : 0;

  // Year typography
  const yearFontSize = 14 * scale;
  const yearLineHeight = yearFontSize * 1.3;
  const yearLines = yearText ? wrapTextToWidth(yearText, timesRoman, yearFontSize, titleMaxW) : [];
  const yearBaselineSpan = yearLines.length > 0 ? (yearLines.length - 1) * yearLineHeight : 0;

  // Place student details cleanly in lower-middle zone while closing gaps if titles omitted
  const hasAnyTitle = hasMainTitle || hasAssignmentTitle;
  const gapTitleToDetailsMin = (hasAnyTitle || hasHeaderContent ? 44 : 28) * scale;
  const gapDetailsToYear = detailRows.length > 0 && yearLines.length > 0 ? 36 * scale : 0;
  const bottomMarginInsideBox = 28 * scale;
  const lowestSafeBaseline = innerBottom + bottomMarginInsideBox + yearFontSize * 0.2;

  const maxAllowedDetailsFirstBaseline =
    titlesBottomY - gapTitleToDetailsMin - capHeightRatio * detailFontSize;

  const preferredAnchorY = hasAnyTitle
    ? innerBottom + Math.min(346, (innerTop - innerBottom) * 0.46)
    : Math.min(innerBottom + (innerTop - innerBottom) * 0.56, titlesBottomY - 64 * scale);

  let detailsFirstBaselineY = Math.min(
    preferredAnchorY - capHeightRatio * detailFontSize,
    maxAllowedDetailsFirstBaseline
  );

  // Ensure details + Year fit cleanly above the bottom page border
  const neededBelowFirstDetail =
    detailRows.length > 0
      ? detailsBaselineSpan +
        (yearLines.length > 0 ? gapDetailsToYear + capHeightRatio * yearFontSize + yearBaselineSpan : 0)
      : 0;

  if (detailsFirstBaselineY - neededBelowFirstDetail < lowestSafeBaseline) {
    detailsFirstBaselineY = Math.min(
      maxAllowedDetailsFirstBaseline,
      lowestSafeBaseline + neededBelowFirstDetail
    );
  }

  const detailsBottomY =
    detailRows.length > 0
      ? detailsFirstBaselineY - detailsBaselineSpan - detailFontSize * 0.22
      : titlesBottomY;

  // Year baseline placement
  let yearFirstBaselineY: number;
  if (yearLines.length > 0) {
    if (detailRows.length > 0) {
      yearFirstBaselineY = detailsBottomY - gapDetailsToYear - capHeightRatio * yearFontSize;
    } else {
      const preferredYearBaseline = innerBottom + 132 * scale;
      const maxYearBaseline = titlesBottomY - gapTitleToDetailsMin - capHeightRatio * yearFontSize;
      yearFirstBaselineY = Math.min(preferredYearBaseline, maxYearBaseline);
      yearFirstBaselineY = Math.max(yearFirstBaselineY, lowestSafeBaseline + yearBaselineSpan);
    }
  } else {
    yearFirstBaselineY = detailsBottomY;
  }

  const finalLowestBaseline =
    yearLines.length > 0
      ? yearFirstBaselineY - yearBaselineSpan
      : detailRows.length > 0
        ? detailsFirstBaselineY - detailsBaselineSpan
        : titlesBottomY;

  const fitsInsideBorder =
    (detailRows.length === 0 || detailsFirstBaselineY <= maxAllowedDetailsFirstBaseline + 0.5) &&
    (yearLines.length === 0 ||
      detailRows.length > 0 ||
      yearFirstBaselineY <= titlesBottomY - gapTitleToDetailsMin - capHeightRatio * yearFontSize + 0.5) &&
    finalLowestBaseline >= lowestSafeBaseline - 0.5;

  return {
    scale,
    drawLogo,
    logoRect,
    collegeFontSize,
    collegeLineHeight,
    collegeLines,
    collegeAlign,
    collegeBlockX,
    collegeBlockWidth,
    collegeFirstBaselineY,
    headerBottomY,
    mainTitleFontSize,
    mainTitleLineHeight,
    mainTitleLines,
    mainTitleFirstBaselineY,
    assignmentTitleFontSize,
    assignmentTitleLineHeight,
    assignmentTitleLines,
    assignmentTitleFirstBaselineY,
    titlesBottomY,
    detailFontSize,
    detailLineHeight,
    detailRowGap,
    labelStartX,
    colonX,
    valueStartX,
    detailRows,
    detailsFirstBaselineY,
    detailsBottomY,
    yearFontSize,
    yearLineHeight,
    yearLines,
    yearFirstBaselineY,
    totalRequiredHeight: innerTop - finalLowestBaseline + bottomMarginInsideBox,
    fitsInsideBorder,
  };
}

/**
 * Generates an A4 Portrait Cover Page PDF (`Uint8Array`) cleanly using pdf-lib.
 */
export async function generateFrontPagePdf(config: FrontPageConfig): Promise<Uint8Array> {
  if (config.logoMode === 'custom' && !config.logo) {
    throw new FrontPageError(
      'NO_LOGO_SELECTED',
      'No custom college logo uploaded. Please upload a PNG, JPG, JPEG, or SVG file, or choose "KGEC Logo" / "Without Logo".'
    );
  }

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setCreator('PDF Render - Front Page Generator');
    pdfDoc.setProducer('pdf-lib');

    const safeTitle = sanitizeWinAnsiText(
      config.details.mainTitle || config.details.assignmentTitle || 'Front Page'
    );
    if (safeTitle) {
      pdfDoc.setTitle(safeTitle);
    }

    const page = pdfDoc.addPage([A4_PORTRAIT_WIDTH, A4_PORTRAIT_HEIGHT]);

    // Explicit pure white page background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_PORTRAIT_WIDTH,
      height: A4_PORTRAIT_HEIGHT,
      color: rgb(1, 1, 1),
    });

    const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const timesRomanBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Embed logo if active
    let embeddedLogo: PDFImage | null = null;
    let logoDims: { width: number; height: number } | null = null;

    if (config.logoMode !== 'none') {
      if (!config.logo || !config.logo.bytes || config.logo.bytes.length === 0) {
        throw new FrontPageError(
          'NO_LOGO_SELECTED',
          'College logo asset is missing. Please select KGEC Logo, upload a logo, or choose "Without Logo".'
        );
      }

      try {
        embeddedLogo =
          config.logo.format === 'png'
            ? await pdfDoc.embedPng(config.logo.bytes)
            : await pdfDoc.embedJpg(config.logo.bytes);
        logoDims = {
          width: config.logo.width || embeddedLogo.width,
          height: config.logo.height || embeddedLogo.height,
        };
      } catch {
        throw new FrontPageError(
          'INVALID_LOGO',
          'Failed to embed the selected logo image into PDF. Please upload a valid PNG, JPG, or SVG file.'
        );
      }
    }

    // Clamp border margins cleanly
    const borderMarginPt = Math.min(80, Math.max(20, config.borderMarginPt ?? DEFAULT_BORDER_MARGIN_PT));
    const innerLeft = borderMarginPt;
    const innerBottom = borderMarginPt;
    const innerRight = A4_PORTRAIT_WIDTH - borderMarginPt;
    const innerTop = A4_PORTRAIT_HEIGHT - borderMarginPt;
    const innerWidth = innerRight - innerLeft;
    const innerHeight = innerTop - innerBottom;

    // Outer black rectangular page border
    page.drawRectangle({
      x: innerLeft,
      y: innerBottom,
      width: innerWidth,
      height: innerHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1.4,
    });

    const activeRows = getActiveStudentRows(config.details);
    const yearText = formatYearLine(config.details.year);
    const layoutParams = {
      innerLeft,
      innerRight,
      innerBottom,
      innerTop,
      innerWidth,
      innerHeight,
      logoMode: config.logoMode,
      logoPosition: config.logoPosition ?? 'left',
      logoSizePt: config.logoSizePt ?? DEFAULT_LOGO_SIZE_PT,
      collegeFontSizePt: config.collegeFontSizePt ?? DEFAULT_COLLEGE_FONT_SIZE_PT,
      logoDims,
      collegeName: config.details.collegeName,
      mainTitle: config.details.mainTitle,
      assignmentTitle: config.details.assignmentTitle,
      activeRows,
      yearText,
      timesRoman,
      timesRomanBold,
      helveticaBold,
    };

    // Iteratively find largest clean scale factor so extreme inputs never overflow the inner border
    const scaleCandidates = [1.0, 0.94, 0.88, 0.82, 0.76, 0.70, 0.64, 0.58, 0.52];
    let plan = buildLayoutPlan(layoutParams, 1.0);
    for (const candidateScale of scaleCandidates) {
      const candidatePlan = buildLayoutPlan(layoutParams, candidateScale);
      plan = candidatePlan;
      if (candidatePlan.fitsInsideBorder) {
        break;
      }
    }

    const inkColor = rgb(0.06, 0.07, 0.09);

    // 1. Draw Logo
    if (embeddedLogo && plan.logoRect) {
      page.drawImage(embeddedLogo, {
        x: plan.logoRect.x,
        y: plan.logoRect.y,
        width: plan.logoRect.width,
        height: plan.logoRect.height,
      });
    }

    // 2. Draw Bold College Name
    if (plan.collegeLines.length > 0) {
      plan.collegeLines.forEach((line, idx) => {
        const lineW = safeTextWidth(timesRomanBold, line, plan.collegeFontSize);
        const baselineY = plan.collegeFirstBaselineY - idx * plan.collegeLineHeight;
        const x =
          plan.collegeAlign === 'center'
            ? plan.collegeBlockX + Math.max(0, (plan.collegeBlockWidth - lineW) / 2)
            : plan.collegeBlockX;

        page.drawText(line, {
          x,
          y: baselineY,
          size: plan.collegeFontSize,
          font: timesRomanBold,
          color: rgb(0, 0, 0),
        });
      });
    }

    // 3. Draw Centered Bold Main Title (no horizontal line beneath)
    if (plan.mainTitleLines.length > 0) {
      plan.mainTitleLines.forEach((line, idx) => {
        const lineW = safeTextWidth(helveticaBold, line, plan.mainTitleFontSize);
        const x = (A4_PORTRAIT_WIDTH - lineW) / 2;
        const baselineY = plan.mainTitleFirstBaselineY - idx * plan.mainTitleLineHeight;

        page.drawText(line, {
          x,
          y: baselineY,
          size: plan.mainTitleFontSize,
          font: helveticaBold,
          color: rgb(0, 0, 0),
        });
      });
    }

    // 4. Draw Centered Assignment Title directly beneath Main Title
    if (plan.assignmentTitleLines.length > 0) {
      plan.assignmentTitleLines.forEach((line, idx) => {
        const lineW = safeTextWidth(timesRoman, line, plan.assignmentTitleFontSize);
        const x = (A4_PORTRAIT_WIDTH - lineW) / 2;
        const baselineY =
          plan.assignmentTitleFirstBaselineY - idx * plan.assignmentTitleLineHeight;

        page.drawText(line, {
          x,
          y: baselineY,
          size: plan.assignmentTitleFontSize,
          font: timesRoman,
          color: inkColor,
        });
      });
    }

    // 5. Draw Active Student Details (strictly no blank lines or dangling colons)
    let detailY = plan.detailsFirstBaselineY;
    for (const row of plan.detailRows) {
      const firstBaselineY = detailY;

      page.drawText(row.label, {
        x: plan.labelStartX,
        y: firstBaselineY,
        size: plan.detailFontSize,
        font: timesRoman,
        color: inkColor,
      });

      page.drawText(':', {
        x: plan.colonX,
        y: firstBaselineY,
        size: plan.detailFontSize,
        font: timesRoman,
        color: inkColor,
      });

      const lines = row.valueLines.length > 0 ? row.valueLines : [''];
      lines.forEach((vLine, lineIdx) => {
        const lineBaselineY = firstBaselineY - lineIdx * plan.detailLineHeight;
        if (vLine) {
          page.drawText(vLine, {
            x: plan.valueStartX,
            y: lineBaselineY,
            size: plan.detailFontSize,
            font: timesRoman,
            color: inkColor,
          });
        }
      });

      detailY -=
        Math.max(1, lines.length) * plan.detailLineHeight + plan.detailRowGap;
    }

    // 6. Draw Centered Academic Year near bottom of student details
    if (plan.yearLines.length > 0) {
      plan.yearLines.forEach((line, idx) => {
        const lineW = safeTextWidth(timesRoman, line, plan.yearFontSize);
        const x = (A4_PORTRAIT_WIDTH - lineW) / 2;
        const baselineY = plan.yearFirstBaselineY - idx * plan.yearLineHeight;

        page.drawText(line, {
          x,
          y: baselineY,
          size: plan.yearFontSize,
          font: timesRoman,
          color: inkColor,
        });
      });
    }

    return await pdfDoc.save();
  } catch (err) {
    if (err instanceof FrontPageError) throw err;
    const msg = err instanceof Error ? err.message : 'Unexpected PDF generation error.';
    throw new FrontPageError('PDF_GENERATION_FAILED', `Failed to generate front page PDF: ${msg}`);
  }
}

/**
 * Checks whether a buffer starts with the PDF magic header `%PDF-` within the first 1024 bytes.
 */
export function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 5) return false;
  const searchLen = Math.min(bytes.length, 1024);
  for (let i = 0; i <= searchLen - 5; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and inspects an existing PDF buffer, explicitly detecting invalid,
 * empty, password-protected, corrupted, or unusual-dimension PDFs.
 */
export async function validateAndInspectExistingPdf(
  pdfData: ArrayBuffer | Uint8Array,
  fileName = 'document.pdf'
): Promise<ExistingPdfInfo> {
  const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);

  if (!bytes || bytes.length === 0) {
    throw new FrontPageError('INVALID_PDF', `"${fileName}" is empty (0 bytes).`);
  }

  if (bytes.length > MAX_EXISTING_PDF_SIZE) {
    throw new FrontPageError(
      'INVALID_PDF',
      `"${fileName}" exceeds the 100 MB size limit.`
    );
  }

  if (!hasPdfMagicHeader(bytes)) {
    throw new FrontPageError(
      'INVALID_PDF',
      `"${fileName}" is not a valid PDF file (missing %PDF- signature).`
    );
  }

  let doc: PDFDocument;
  let rawPages: ReturnType<PDFDocument['getPages']> = [];
  let pageCount = 0;

  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    if (doc.isEncrypted) {
      throw new FrontPageError(
        'ENCRYPTED_PDF',
        `"${fileName}" is password-protected or encrypted. Please unlock it first using the Protect & Unlock tool.`
      );
    }
    pageCount = doc.getPageCount();
    if (pageCount > 0) {
      rawPages = doc.getPages();
      // Force page box inspection inside try/catch in case of malformed page dictionary
      for (const p of rawPages) {
        p.getSize();
      }
    }
  } catch (err) {
    if (err instanceof FrontPageError) throw err;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/encrypt|password/i.test(errMsg)) {
      throw new FrontPageError(
        'ENCRYPTED_PDF',
        `"${fileName}" is password-protected or encrypted. Please unlock it first using the Protect & Unlock tool.`
      );
    }

    // Double check with ignoreEncryption: true to distinguish encrypted vs corrupted PDFs cleanly
    try {
      const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
      if (probe.isEncrypted) {
        throw new FrontPageError(
          'ENCRYPTED_PDF',
          `"${fileName}" is password-protected or encrypted. Please unlock it first using the Protect & Unlock tool.`
        );
      }
    } catch (probeErr) {
      if (probeErr instanceof FrontPageError) throw probeErr;
    }

    throw new FrontPageError(
      'CORRUPTED_PDF',
      `"${fileName}" appears to be corrupted or unreadable and could not be parsed.`
    );
  }

  if (pageCount === 0) {
    throw new FrontPageError('CORRUPTED_PDF', `"${fileName}" contains 0 pages.`);
  }

  const pages: ExistingPdfPageMeta[] = rawPages.map((p, idx) => {
    const { width, height } = p.getSize();
    const angle = ((p.getRotation()?.angle ?? 0) % 360 + 360) % 360;
    // Account for 90°/270° page rotation when computing visual orientation
    const visualWidth = angle === 90 || angle === 270 ? height : width;
    const visualHeight = angle === 90 || angle === 270 ? width : height;
    const orientation: 'portrait' | 'landscape' =
      visualWidth > visualHeight ? 'landscape' : 'portrait';

    return {
      pageNumber: idx + 1,
      width,
      height,
      rotation: angle,
      orientation,
    };
  });

  const hasLandscapePages = pages.some((p) => p.orientation === 'landscape');
  const hasPortraitPages = pages.some((p) => p.orientation === 'portrait');

  const firstW = Math.round(pages[0].width);
  const firstH = Math.round(pages[0].height);
  const hasMixedDimensions = pages.some(
    (p) => Math.abs(Math.round(p.width) - firstW) > 2 || Math.abs(Math.round(p.height) - firstH) > 2
  );

  const hasUnusualDimensions = pages.some((p) => {
    const minSide = Math.min(p.width, p.height);
    const maxSide = Math.max(p.width, p.height);
    const ratio = maxSide / Math.max(1, minSide);
    return minSide < 150 || maxSide > 2000 || ratio > 2.6;
  });

  return {
    pageCount,
    pages,
    hasLandscapePages,
    hasPortraitPages,
    hasMixedDimensions,
    hasUnusualDimensions,
  };
}

/**
 * Merges a generated Front Page PDF at Page 1 followed by all pages of the
 * existing PDF in exact original order without modifying or compressing original pages.
 */
export async function mergeFrontPageWithPdf(
  frontPageBytes: Uint8Array,
  existingPdfData: ArrayBuffer | Uint8Array,
  existingFileName = 'document.pdf'
): Promise<MergeFrontPageResult> {
  const existingPdfInfo = await validateAndInspectExistingPdf(existingPdfData, existingFileName);

  try {
    const frontDoc = await PDFDocument.load(frontPageBytes);
    const targetDoc = await PDFDocument.load(existingPdfData, { ignoreEncryption: false });
    const mergedDoc = await PDFDocument.create();

    mergedDoc.setCreator('PDF Render - Front Page Generator');
    mergedDoc.setProducer('pdf-lib');

    // Insert generated front page as Page 1
    const [copiedFrontPage] = await mergedDoc.copyPages(frontDoc, [0]);
    mergedDoc.addPage(copiedFrontPage);

    // Append every original page untouched in exact original order
    const targetIndices = targetDoc.getPageIndices();
    const copiedOriginalPages = await mergedDoc.copyPages(targetDoc, targetIndices);
    for (const origPage of copiedOriginalPages) {
      mergedDoc.addPage(origPage);
    }

    const pdfBytes = await mergedDoc.save();
    return {
      pdfBytes,
      totalPages: mergedDoc.getPageCount(),
      originalPageCount: targetIndices.length,
      existingPdfInfo,
    };
  } catch (err) {
    if (err instanceof FrontPageError) throw err;
    const msg = err instanceof Error ? err.message : 'Unexpected merge error.';
    throw new FrontPageError('PDF_MERGE_FAILED', `Failed to merge front page with PDF: ${msg}`);
  }
}

/**
 * Builds a clean, safe download filename for standalone or merged PDFs.
 */
export function buildFrontPageFilename(details: FrontPageDetails): string {
  const raw = (details.assignmentTitle || details.mainTitle || '').trim();
  if (!raw) return 'Front_Page.pdf';
  const safe = raw
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return safe ? `${safe}_Front_Page.pdf` : 'Front_Page.pdf';
}

export function buildMergedPdfFilename(originalFileName: string): string {
  const baseName = originalFileName.replace(/\.pdf$/i, '').trim() || 'Document';
  return `${baseName}_with_front_page.pdf`;
}
