import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createPdfBlob } from '@/lib/utils';

export interface DocxTextRun {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  colorHex: string; // e.g. "1F2937"
  fontFamily: string; // e.g. "Consolas", "Courier New", "Arial", "Times New Roman"
  fontSize: number; // in points
  isPageBreak?: boolean;
  isLineBreak?: boolean;
}

export interface DocxParagraphData {
  type: 'paragraph' | 'heading' | 'title' | 'code';
  headingLevel?: 1 | 2 | 3 | 4;
  runs: DocxTextRun[];
  alignment: 'left' | 'center' | 'right' | 'justified';
  indentLeftPt: number;
  spacingBeforePt: number;
  spacingAfterPt: number;
  isCodeBlock: boolean;
  shadingHex?: string;
  keepWithNext: boolean;
  pageBreakBefore: boolean;
}

export interface DocxTableCellData {
  runs: DocxTextRun[];
  widthPt: number;
  shadingHex?: string;
  alignment: 'left' | 'center' | 'right';
  hasBorderTop: boolean;
  hasBorderBottom: boolean;
  hasBorderLeft: boolean;
  hasBorderRight: boolean;
}

export interface DocxTableData {
  type: 'table';
  rows: DocxTableCellData[][];
  totalWidthPt: number;
}

export type DocxBlockElement = DocxParagraphData | DocxTableData;

export interface DocxDocumentModel {
  pageWidthPt: number;
  pageHeightPt: number;
  orientation: 'portrait' | 'landscape';
  marginsPt: { top: number; bottom: number; left: number; right: number };
  elements: DocxBlockElement[];
  headerText?: string;
  footerText?: string;
  hasCoverPage: boolean;
}

// Convert Hex string (e.g. "1F2937", "#2563EB", "auto") to pdf-lib rgb
function parseColorHex(hex?: string): { r: number; g: number; b: number } {
  if (!hex || hex.toLowerCase() === 'auto' || hex.length < 6) {
    return { r: 0.1, g: 0.12, b: 0.15 }; // Default near-black
  }
  const cleanHex = hex.replace('#', '').trim();
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { r: 0.1, g: 0.12, b: 0.15 };
  }
  return { r, g, b };
}

/**
 * Extracts OpenXML DOCX structure with formatting, page breaks, tables, and code blocks
 */
export async function parseDocxDocument(buffer: ArrayBuffer): Promise<DocxDocumentModel> {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid Word document: word/document.xml missing');
  }

  const docXmlText = await docXmlFile.async('text');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXmlText, 'text/xml');

  // Default Geometry (A4 Portrait)
  let pageWidthPt = 595.28;
  let pageHeightPt = 841.89;
  let orientation: 'portrait' | 'landscape' = 'portrait';
  let marginsPt = { top: 54, bottom: 54, left: 54, right: 54 };

  // Section Properties: <w:sectPr>
  const sectPrList = xmlDoc.getElementsByTagName('w:sectPr');
  if (sectPrList.length > 0) {
    const lastSect = sectPrList[sectPrList.length - 1];
    const pgSz = lastSect.getElementsByTagName('w:pgSz')[0];
    if (pgSz) {
      const wVal = pgSz.getAttribute('w:w');
      const hVal = pgSz.getAttribute('w:h');
      const orientVal = pgSz.getAttribute('w:orient');
      if (wVal && hVal) {
        pageWidthPt = Number(wVal) / 20;
        pageHeightPt = Number(hVal) / 20;
      }
      if (orientVal === 'landscape') {
        orientation = 'landscape';
        if (pageWidthPt < pageHeightPt) {
          const temp = pageWidthPt;
          pageWidthPt = pageHeightPt;
          pageHeightPt = temp;
        }
      }
    }

    const pgMar = lastSect.getElementsByTagName('w:pgMar')[0];
    if (pgMar) {
      const topVal = pgMar.getAttribute('w:top');
      const bottomVal = pgMar.getAttribute('w:bottom');
      const leftVal = pgMar.getAttribute('w:left');
      const rightVal = pgMar.getAttribute('w:right');
      marginsPt = {
        top: topVal ? Math.max(36, Number(topVal) / 20) : 54,
        bottom: bottomVal ? Math.max(36, Number(bottomVal) / 20) : 54,
        left: leftVal ? Math.max(36, Number(leftVal) / 20) : 54,
        right: rightVal ? Math.max(36, Number(rightVal) / 20) : 54,
      };
    }
  }

  const bodyEl = xmlDoc.getElementsByTagName('w:body')[0];
  if (!bodyEl) {
    throw new Error('Invalid Word document: w:body element not found');
  }

  const elements: DocxBlockElement[] = [];

  // Parse Body Children in Order
  const childNodes = Array.from(bodyEl.childNodes);

  for (const node of childNodes) {
    if (node.nodeType !== 1) continue; // Only element nodes
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();

    // 1. PARAGRAPH (<w:p>)
    if (tagName === 'w:p') {
      const pPr = el.getElementsByTagName('w:pPr')[0];

      let pStyle = '';
      let alignment: 'left' | 'center' | 'right' | 'justified' = 'left';
      let indentLeftPt = 0;
      let keepWithNext = false;
      let pageBreakBefore = false;
      let shadingHex: string | undefined = undefined;

      if (pPr) {
        // Style (e.g. Title, Heading1, Heading2, Code)
        const pStyleEl = pPr.getElementsByTagName('w:pStyle')[0];
        if (pStyleEl) {
          pStyle = (pStyleEl.getAttribute('w:val') || '').toLowerCase();
        }

        // Alignment
        const jcEl = pPr.getElementsByTagName('w:jc')[0];
        if (jcEl) {
          const jcVal = jcEl.getAttribute('w:val') || 'left';
          if (jcVal === 'center') alignment = 'center';
          else if (jcVal === 'right') alignment = 'right';
          else if (jcVal === 'both') alignment = 'justified';
        }

        // Left Indentation
        const indEl = pPr.getElementsByTagName('w:ind')[0];
        if (indEl) {
          const leftVal = indEl.getAttribute('w:left');
          if (leftVal) {
            const nVal = Number(leftVal);
            if (Number.isFinite(nVal) && nVal > 0) {
              indentLeftPt = nVal / 20;
            }
          }
        }

        // Keep With Next
        if (pPr.getElementsByTagName('w:keepNext').length > 0) {
          keepWithNext = true;
        }

        // Page Break Before
        if (pPr.getElementsByTagName('w:pageBreakBefore').length > 0) {
          pageBreakBefore = true;
        }

        // Shading
        const shdEl = pPr.getElementsByTagName('w:shd')[0];
        if (shdEl) {
          const fill = shdEl.getAttribute('w:fill');
          if (fill && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'none') {
            shadingHex = fill;
          }
        }
      }

      // Check Heading classification
      let type: 'paragraph' | 'heading' | 'title' | 'code' = 'paragraph';
      let headingLevel: 1 | 2 | 3 | 4 | undefined = undefined;

      if (pStyle.includes('title')) {
        type = 'title';
        keepWithNext = true;
      } else if (pStyle.includes('heading1') || pStyle === '1') {
        type = 'heading';
        headingLevel = 1;
        keepWithNext = true;
      } else if (pStyle.includes('heading2') || pStyle === '2') {
        type = 'heading';
        headingLevel = 2;
        keepWithNext = true;
      } else if (pStyle.includes('heading3') || pStyle === '3') {
        type = 'heading';
        headingLevel = 3;
        keepWithNext = true;
      } else if (pStyle.includes('code') || pStyle.includes('source') || pStyle.includes('mono')) {
        type = 'code';
      }

      // Extract Runs (<w:r>)
      const runNodes = Array.from(el.getElementsByTagName('w:r'));
      const runs: DocxTextRun[] = [];

      for (const rNode of runNodes) {
        // Extract text and inline breaks in exact document order
        let text = '';
        for (const child of Array.from(rNode.childNodes)) {
          const nodeName = (child.nodeName || '').toLowerCase();
          if (nodeName.endsWith('t')) {
            text += child.textContent || '';
          } else if (nodeName.endsWith('br')) {
            const brType = (child as Element).getAttribute?.('w:type');
            if (brType === 'page') {
              pageBreakBefore = true;
            } else {
              text += '\n';
            }
          } else if (nodeName.endsWith('cr')) {
            text += '\n';
          } else if (nodeName.endsWith('tab')) {
            text += '    '; // 4 spaces for tabs/indentation
          }
        }

        if (!text) continue;

        const rPr = rNode.getElementsByTagName('w:rPr')[0];
        let isBold = type === 'title' || type === 'heading';
        let isItalic = false;
        let isUnderline = false;
        let colorHex = '111827';
        let fontFamily = type === 'code' ? 'Consolas' : 'Helvetica';
        let fontSize =
          type === 'title' ? 22 : headingLevel === 1 ? 14 : headingLevel === 2 ? 12 : headingLevel === 3 ? 11 : 10;

        if (rPr) {
          if (rPr.getElementsByTagName('w:b').length > 0) isBold = true;
          if (rPr.getElementsByTagName('w:i').length > 0) isItalic = true;
          if (rPr.getElementsByTagName('w:u').length > 0) isUnderline = true;

          const colorEl = rPr.getElementsByTagName('w:color')[0];
          if (colorEl) {
            const cVal = colorEl.getAttribute('w:val');
            if (cVal) colorHex = cVal;
          }

          const fontEl = rPr.getElementsByTagName('w:rFonts')[0];
          if (fontEl) {
            const fontVal = fontEl.getAttribute('w:ascii') || fontEl.getAttribute('w:hAnsi') || '';
            const fLower = fontVal.toLowerCase();
            if (fLower.includes('consolas') || fLower.includes('courier') || fLower.includes('mono')) {
              fontFamily = 'Consolas';
              type = 'code';
            } else if (fLower.includes('times') || fLower.includes('serif')) {
              fontFamily = 'TimesRoman';
            } else {
              fontFamily = 'Helvetica';
            }
          }

          const szEl = rPr.getElementsByTagName('w:sz')[0];
          if (szEl) {
            const szVal = szEl.getAttribute('w:val');
            if (szVal) {
              const numSz = Number(szVal);
              if (Number.isFinite(numSz) && numSz > 0) {
                fontSize = numSz / 2; // half-points to points
              }
            }
          }
        }

        runs.push({
          text,
          isBold,
          isItalic,
          isUnderline,
          colorHex,
          fontFamily,
          fontSize,
        });
      }

      // Check if paragraph is purely a page break
      if (runs.length === 0 && !pageBreakBefore) {
        continue;
      }

      const isCodeBlock = type === 'code' || runs.some((r) => r.fontFamily === 'Consolas');

      elements.push({
        type,
        headingLevel,
        runs,
        alignment,
        indentLeftPt,
        spacingBeforePt: type === 'title' ? 16 : headingLevel === 1 ? 14 : headingLevel === 2 ? 10 : 4,
        spacingAfterPt: type === 'title' ? 12 : headingLevel ? 6 : isCodeBlock ? 2 : 6,
        isCodeBlock,
        shadingHex: isCodeBlock ? shadingHex || 'F8FAFC' : shadingHex,
        keepWithNext,
        pageBreakBefore,
      });
    }

    // 2. TABLE (<w:tbl>)
    else if (tagName === 'w:tbl') {
      const trNodes = Array.from(el.getElementsByTagName('w:tr'));
      const rows: DocxTableCellData[][] = [];
      let totalWidthPt = 0;

      for (const tr of trNodes) {
        const tcNodes = Array.from(tr.getElementsByTagName('w:tc'));
        const cellRow: DocxTableCellData[] = [];
        let rowWidthPt = 0;

        for (const tc of tcNodes) {
          const tcPr = tc.getElementsByTagName('w:tcPr')[0];
          let cellWidthPt = 100;
          let cellShadingHex: string | undefined = undefined;

          if (tcPr) {
            const tcW = tcPr.getElementsByTagName('w:tcW')[0];
            if (tcW) {
              const wVal = tcW.getAttribute('w:w');
              if (wVal) {
                const numW = Number(wVal);
                if (Number.isFinite(numW) && numW > 0) {
                  cellWidthPt = Math.max(30, numW / 20);
                }
              }
            }

            const shd = tcPr.getElementsByTagName('w:shd')[0];
            if (shd) {
              const fill = shd.getAttribute('w:fill');
              if (fill && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'none') {
                cellShadingHex = fill;
              }
            }
          }

          rowWidthPt += cellWidthPt;

          // Extract text runs inside cell
          const cellRuns: DocxTextRun[] = [];
          const cellPList = Array.from(tc.getElementsByTagName('w:p'));

          for (const cp of cellPList) {
            const rList = Array.from(cp.getElementsByTagName('w:r'));
            for (const cr of rList) {
              const text = Array.from(cr.getElementsByTagName('w:t'))
                .map((t) => t.textContent || '')
                .join('');
              if (!text) continue;

              const rPr = cr.getElementsByTagName('w:rPr')[0];
              const isBold = rPr ? rPr.getElementsByTagName('w:b').length > 0 : false;
              const isItalic = rPr ? rPr.getElementsByTagName('w:i').length > 0 : false;
              const isUnderline = rPr ? rPr.getElementsByTagName('w:u').length > 0 : false;

              let colorHex = '111827';
              if (rPr) {
                const cEl = rPr.getElementsByTagName('w:color')[0];
                if (cEl) {
                  const val = cEl.getAttribute('w:val');
                  if (val) colorHex = val;
                }
              }

              cellRuns.push({
                text,
                isBold,
                isItalic,
                isUnderline,
                colorHex,
                fontFamily: 'Helvetica',
                fontSize: 10,
              });
            }
          }

          cellRow.push({
            runs: cellRuns,
            widthPt: cellWidthPt,
            shadingHex: cellShadingHex,
            alignment: 'left',
            hasBorderTop: true,
            hasBorderBottom: true,
            hasBorderLeft: true,
            hasBorderRight: true,
          });
        }

        if (cellRow.length > 0) {
          rows.push(cellRow);
          if (rowWidthPt > totalWidthPt) totalWidthPt = rowWidthPt;
        }
      }

      if (rows.length > 0) {
        elements.push({
          type: 'table',
          rows,
          totalWidthPt: totalWidthPt || pageWidthPt - marginsPt.left - marginsPt.right,
        });
      }
    }
  }

  // Cover Page Check (First element is title, total text short)
  const hasCoverPage =
    elements.length > 0 &&
    (elements[0].type === 'title' || (elements[0] as DocxParagraphData).headingLevel === 1) &&
    elements.slice(0, 3).some((el) => el.type === 'paragraph' && (el as DocxParagraphData).pageBreakBefore);

  return {
    pageWidthPt,
    pageHeightPt,
    orientation,
    marginsPt,
    elements,
    hasCoverPage,
  };
}

export function safeWinAnsi(str: string): string {
  if (!str) return '';
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Standard whitespace control characters
    if (code === 9 || code === 10 || code === 13) {
      result += ' ';
      continue;
    }
    // Standard ASCII
    if (code >= 0x20 && code <= 0x7e) {
      result += str[i];
      continue;
    }
    // Windows-1252 Latin-1 Supplement range (preserve common accented vowels & symbols)
    if (code >= 0xa0 && code <= 0xff) {
      if (code === 0xd7) {
        result += 'x';
        continue;
      }
      if (code === 0xf7) {
        result += '/';
        continue;
      }
      if (code === 0xb2) {
        result += '^2';
        continue;
      }
      if (code === 0xb3) {
        result += '^3';
        continue;
      }
      if (code === 0xb9) {
        result += '^1';
        continue;
      }
      if (code === 0xb0) {
        result += ' deg';
        continue;
      }
      if (code === 0xa9) {
        result += '(c)';
        continue;
      }
      if (code === 0xae) {
        result += '(R)';
        continue;
      }
      result += str[i];
      continue;
    }
    // Smart Quotes & Apostrophes
    if (code === 0x2018 || code === 0x2019 || code === 0x201a || code === 0x201b || code === 0x2032) {
      result += "'";
    } else if (code === 0x201c || code === 0x201d || code === 0x201e || code === 0x201f || code === 0x2033) {
      result += '"';
    }
    // Dashes & Hyphens & Minus
    else if (
      code === 0x2010 ||
      code === 0x2011 ||
      code === 0x2012 ||
      code === 0x2013 ||
      code === 0x2014 ||
      code === 0x2015 ||
      code === 0x2212
    ) {
      result += '-';
    }
    // Ellipsis
    else if (code === 0x2026) {
      result += '...';
    }
    // Bullets & List markers
    else if (
      code === 0x2022 ||
      code === 0x25cf ||
      code === 0x25cb ||
      code === 0x25aa ||
      code === 0x25b8 ||
      code === 0x25e6 ||
      code === 0x2023 ||
      code === 0x2043
    ) {
      result += '*';
    }
    // Arrows
    else if (code === 0x2192 || code === 0x21d2) {
      result += '->';
    } else if (code === 0x2190 || code === 0x21d0) {
      result += '<-';
    } else if (code === 0x2194 || code === 0x21d4) {
      result += '<->';
    }
    // Comparison & Math Symbols
    else if (code === 0x2264) {
      result += '<=';
    } else if (code === 0x2265) {
      result += '>=';
    } else if (code === 0x2260) {
      result += '!=';
    } else if (code === 0x2248) {
      result += '~';
    } else if (code === 0x221e) {
      result += 'inf';
    } else if (code === 0x2211) {
      result += 'sum';
    } else if (code === 0x221a) {
      result += 'sqrt';
    } else if (code === 0x2208) {
      result += ' in ';
    } else if (code === 0x2209) {
      result += ' not in ';
    } else if (code === 0x2200) {
      result += 'forall ';
    } else if (code === 0x2203) {
      result += 'exists ';
    }
    // Greek letters
    else if (code === 0x03b1) {
      result += 'alpha';
    } else if (code === 0x03b2) {
      result += 'beta';
    } else if (code === 0x03b3) {
      result += 'gamma';
    } else if (code === 0x03b4) {
      result += 'delta';
    } else if (code === 0x03c0) {
      result += 'pi';
    } else if (code === 0x03c3) {
      result += 'sigma';
    } else if (code === 0x03bc) {
      result += 'mu';
    } else if (code === 0x03bb) {
      result += 'lambda';
    } else if (code === 0x03a9) {
      result += 'Omega';
    }
    // Superscripts
    else if (code >= 0x2070 && code <= 0x2079) {
      result += `^${code - 0x2070}`;
    }
    // Subscripts
    else if (code >= 0x2080 && code <= 0x2089) {
      result += `_${code - 0x2080}`;
    }
    // Currency
    else if (code === 0x20b9) {
      result += 'Rs.';
    } else if (code === 0x20ac) {
      result += 'EUR';
    } else if (code === 0x00a3) {
      result += 'GBP';
    } else if (code === 0x00a5) {
      result += 'JPY';
    }
    // Trademark & Copyright
    else if (code === 0x2122) {
      result += '(TM)';
    }
    // Checkmarks & Boxes
    else if (code === 0x2713 || code === 0x2714) {
      result += '[x]';
    } else if (code === 0x2717 || code === 0x2718) {
      result += '[ ]';
    }
    // Non-breaking & zero-width spaces
    else if (code === 0x00a0 || code === 0x200b || code === 0x202f || code === 0xfeff) {
      result += ' ';
    }
    // Other Unicode glyphs
    else {
      result += ' ';
    }
  }
  return result;
}

/**
 * Ensures text can be cleanly encoded by the given font without throwing WinAnsi encoding errors
 */
export function safeEncodeText(font: any, text: string): string {
  if (!text) return '';
  if (!font || typeof font.encodeText !== 'function') return text;
  try {
    font.encodeText(text);
    return text;
  } catch {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      try {
        font.encodeText(ch);
        result += ch;
      } catch {
        result += ' ';
      }
    }
    return result;
  }
}

/**
 * Robust wrapper around page.drawText preventing any NaN coordinates or unencodable glyph crashes
 */
export function safeDrawText(
  page: any,
  text: string,
  options: { x: number; y: number; size: number; font: any; color?: any }
): void {
  if (!page || !text) return;
  if (!Number.isFinite(options.x) || !Number.isFinite(options.y) || !Number.isFinite(options.size)) {
    return;
  }
  const clean = safeEncodeText(options.font, text);
  if (!clean) return;
  try {
    page.drawText(clean, options);
  } catch {
    try {
      const stripped = clean
        .split('')
        .filter((c) => {
          try {
            options.font.encodeText(c);
            return true;
          } catch {
            return false;
          }
        })
        .join('');
      if (stripped) {
        page.drawText(stripped, options);
      }
    } catch (err) {
      console.warn('safeDrawText suppressed unrenderable glyph stream:', err);
    }
  }
}

/**
 * Robust wrapper around page.drawRectangle preventing NaN/Infinity crashes
 */
export function safeDrawRectangle(
  page: any,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: any;
    borderColor?: any;
    borderWidth?: number;
  }
): void {
  if (!page) return;
  if (
    !Number.isFinite(options.x) ||
    !Number.isFinite(options.y) ||
    !Number.isFinite(options.width) ||
    !Number.isFinite(options.height) ||
    options.width <= 0 ||
    options.height <= 0
  ) {
    return;
  }
  try {
    page.drawRectangle(options);
  } catch (err) {
    console.warn('safeDrawRectangle suppressed error:', err);
  }
}

/**
 * Robust wrapper around page.drawLine preventing NaN/Infinity crashes
 */
export function safeDrawLine(
  page: any,
  options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness?: number; color?: any }
): void {
  if (!page) return;
  if (
    !Number.isFinite(options.start.x) ||
    !Number.isFinite(options.start.y) ||
    !Number.isFinite(options.end.x) ||
    !Number.isFinite(options.end.y)
  ) {
    return;
  }
  try {
    page.drawLine(options);
  } catch (err) {
    console.warn('safeDrawLine suppressed error:', err);
  }
}

interface LayoutWordToken {
  text: string;
  font: any;
  fontSize: number;
  color: { r: number; g: number; b: number };
  isUnderline: boolean;
  width: number;
  spaceWidth: number;
}

interface LayoutLine {
  words: LayoutWordToken[];
  lineWidth: number;
  lineHeight: number;
}

/**
 * Converts parsed DOCX Model into high-fidelity PDF with exact page breaks, code blocks, tables & headings
 */
export async function convertDocxModelToPdf(
  docModel: DocxDocumentModel,
  includePageNumbers: boolean = true,
  documentTitle?: string
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // Standard Fonts
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontHelveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontHelveticaBoldOblique = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontTimesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  const selectFont = (family: string, isBold: boolean, isItalic: boolean) => {
    if (family === 'Consolas' || family.includes('Courier')) {
      return isBold ? fontCourierBold : fontCourier;
    }
    if (family.includes('Times')) {
      return isBold ? fontTimesBold : isItalic ? fontTimesItalic : fontTimes;
    }
    if (isBold && isItalic) return fontHelveticaBoldOblique;
    if (isBold) return fontHelveticaBold;
    if (isItalic) return fontHelveticaOblique;
    return fontHelvetica;
  };

  const { pageWidthPt, pageHeightPt, marginsPt } = docModel;
  const printableWidthPt = pageWidthPt - marginsPt.left - marginsPt.right;

  // Track pages & cursor with clean pagination thresholds
  let currentPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  let cursorY = pageHeightPt - marginsPt.top - 6;
  const bottomLimit = Math.max(34, marginsPt.bottom + 2);

  const triggerNewPage = () => {
    currentPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    cursorY = pageHeightPt - marginsPt.top - 6;
  };

  for (let idx = 0; idx < docModel.elements.length; idx++) {
    const el = docModel.elements[idx];

    // ============================================
    // 1. EXPLICIT PAGE BREAK CHECK
    // ============================================
    if (el.type !== 'table' && (el as DocxParagraphData).pageBreakBefore) {
      triggerNewPage();
    }

    // ============================================
    // 2. KEEP WITH NEXT HEADING CHECK
    // ============================================
    if (el.type !== 'table' && (el as DocxParagraphData).keepWithNext) {
      const headingEstHeight = 28;
      const nextParagraphEstHeight = 24;
      if (cursorY - (headingEstHeight + nextParagraphEstHeight) < bottomLimit) {
        triggerNewPage();
      }
    }

    // ============================================
    // 3. TABLE ELEMENT
    // ============================================
    if (el.type === 'table') {
      const tableData = el as DocxTableData;
      const totalTblWidth = Math.min(tableData.totalWidthPt || printableWidthPt, printableWidthPt);

      for (let rIdx = 0; rIdx < tableData.rows.length; rIdx++) {
        const row = tableData.rows[rIdx];
        if (!row || row.length === 0) continue;
        const rowHeight = 20;

        if (cursorY - rowHeight < bottomLimit || !Number.isFinite(cursorY)) {
          triggerNewPage();
        }

        let cellX = marginsPt.left;
        const sumRowWidth = row.reduce((acc, c) => acc + (Number.isFinite(c.widthPt) && c.widthPt > 0 ? c.widthPt : 80), 0);
        const totalRowWidthPt = sumRowWidth > 0 ? sumRowWidth : totalTblWidth || printableWidthPt;

        for (const cell of row) {
          // Proportionate cell width bounded strictly within printable margins
          const colRatio = totalRowWidthPt > 0 ? (cell.widthPt || 80) / totalRowWidthPt : 1 / row.length;
          const rawCellWidth = colRatio * totalTblWidth;
          const remainingWidth = Math.max(0, printableWidthPt - (cellX - marginsPt.left));
          const cellWidth = Math.max(15, Math.min(rawCellWidth, remainingWidth));

          // Draw Cell Background Shading if present
          if (cell.shadingHex) {
            const { r, g, b } = parseColorHex(cell.shadingHex);
            safeDrawRectangle(currentPage, {
              x: cellX,
              y: cursorY - rowHeight + 4,
              width: cellWidth,
              height: rowHeight,
              color: rgb(r, g, b),
            });
          }

          // Draw Borders
          const borderColor = rgb(0.82, 0.84, 0.86);
          safeDrawRectangle(currentPage, {
            x: cellX,
            y: cursorY - rowHeight + 4,
            width: cellWidth,
            height: rowHeight,
            borderColor,
            borderWidth: 0.5,
          });

          // Draw Cell Text
          const rawCellText = (cell.runs || []).map((r) => r.text || '').join(' ');
          const text = safeWinAnsi(rawCellText).slice(0, 80);
          const isBold = (cell.runs || []).some((r) => r.isBold) || rIdx === 0;
          const font = isBold ? fontHelveticaBold : fontHelvetica;
          const { r, g, b } = parseColorHex(cell.runs?.[0]?.colorHex);

          // Text alignment
          let textW = 0;
          try {
            textW = font.widthOfTextAtSize(text, 9);
          } catch {
            textW = text.length * 5;
          }

          let textX = cellX + 5;
          if (cell.alignment === 'right') {
            textX = Math.max(cellX + 5, cellX + cellWidth - textW - 5);
          } else if (cell.alignment === 'center') {
            textX = Math.max(cellX + 5, cellX + (cellWidth - textW) / 2);
          }

          if (text) {
            safeDrawText(currentPage, text, {
              x: textX,
              y: cursorY - 11,
              size: 9,
              font,
              color: rgb(r, g, b),
            });
          }

          cellX += cellWidth;
        }

        cursorY -= rowHeight;
      }

      cursorY -= 6; // spacing after table
      continue;
    }

    // ============================================
    // 4. PARAGRAPH / HEADING / CODE ELEMENT
    // ============================================
    const para = el as DocxParagraphData;
    const isCode = para.isCodeBlock;
    const indentLeft = para.indentLeftPt || 0;
    const effectivePrintableWidth = Math.max(100, printableWidthPt - indentLeft);

    cursorY -= Math.min(para.spacingBeforePt || 0, 10);

    // Check if new page needed before starting paragraph
    if (cursorY - 18 < bottomLimit) {
      triggerNewPage();
    }

    // Monospaced Code Blocks (Preserve exact lines, indents & wrap long lines)
    if (isCode) {
      const codeFont = selectFont('Consolas', false, false);
      const codeSize = 9;
      const codeLineHeight = 12.5;
      const maxCodeWidth = effectivePrintableWidth - 16;

      const rawCode = para.runs.map((r) => r.text).join('');
      const rawLines = rawCode.split('\n');

      // Wrap long code lines so they NEVER overflow the page boundaries
      const wrappedLines: string[] = [];
      for (const rawL of rawLines) {
        const cleanL = safeWinAnsi(rawL);
        if (!cleanL) {
          wrappedLines.push('');
          continue;
        }
        let lWidth = 0;
        try {
          lWidth = codeFont.widthOfTextAtSize(cleanL, codeSize);
        } catch {
          lWidth = cleanL.length * 5.4;
        }

        if (lWidth <= maxCodeWidth) {
          wrappedLines.push(cleanL);
        } else {
          // Wrap with continuation indent
          const matchIndent = cleanL.match(/^(\s*)/);
          const indent = matchIndent ? matchIndent[1] : '';
          const contIndent = indent + '    ';
          const parts = cleanL.split(/(?<=[ ,;(){}\[\]])|(?=[ ,;(){}\[\]])/);
          let current = '';

          for (const part of parts) {
            const test = current ? current + part : part;
            let testW = 0;
            try {
              testW = codeFont.widthOfTextAtSize(test, codeSize);
            } catch {
              testW = test.length * 5.4;
            }

            if (testW <= maxCodeWidth) {
              current = test;
            } else {
              if (current) wrappedLines.push(current);
              current = contIndent + part.trimStart();
            }
          }
          if (current) wrappedLines.push(current);
        }
      }

      // Render code lines inside shaded container with left accent line
      for (const lineStr of wrappedLines) {
        if (cursorY - codeLineHeight < bottomLimit || !Number.isFinite(cursorY)) {
          triggerNewPage();
        }

        // Background fill
        safeDrawRectangle(currentPage, {
          x: marginsPt.left + indentLeft,
          y: cursorY - 3,
          width: effectivePrintableWidth,
          height: codeLineHeight,
          color: rgb(0.965, 0.975, 0.985),
        });

        // Accent left line
        safeDrawLine(currentPage, {
          start: { x: marginsPt.left + indentLeft, y: cursorY - 3 },
          end: { x: marginsPt.left + indentLeft, y: cursorY + codeLineHeight - 3 },
          thickness: 2,
          color: rgb(0.2, 0.5, 0.9),
        });

        if (lineStr.trim()) {
          safeDrawText(currentPage, lineStr, {
            x: marginsPt.left + indentLeft + 8,
            y: cursorY,
            size: codeSize,
            font: codeFont,
            color: rgb(0.08, 0.12, 0.18),
          });
        }

        cursorY -= codeLineHeight;
      }

      cursorY -= 4;
      continue;
    }

    // Standard Paragraph / Heading Layout-Aware Wrapping
    const tokens: LayoutWordToken[] = [];

    for (const run of para.runs) {
      const font = selectFont(run.fontFamily, run.isBold, run.isItalic);
      const { r, g, b } = parseColorHex(run.colorHex);
      const fontSize = Number.isFinite(run.fontSize) && run.fontSize > 0 ? run.fontSize : 11;

      let spaceW = 3.5;
      try {
        spaceW = font.widthOfTextAtSize(' ', fontSize);
      } catch {
        spaceW = fontSize * 0.28;
      }

      const cleanText = safeWinAnsi(run.text);
      const words = cleanText.split(/\s+/).filter(Boolean);

      for (const w of words) {
        let wWidth = 0;
        try {
          wWidth = font.widthOfTextAtSize(w, fontSize);
        } catch {
          wWidth = w.length * fontSize * 0.55;
        }

        tokens.push({
          text: w,
          font,
          fontSize,
          color: { r, g, b },
          isUnderline: run.isUnderline,
          width: Number.isFinite(wWidth) ? wWidth : 10,
          spaceWidth: Number.isFinite(spaceW) ? spaceW : 3.5,
        });
      }
    }

    if (tokens.length === 0) {
      cursorY -= 8;
      continue;
    }

    // Assemble tokens into layout lines
    const lines: LayoutLine[] = [];
    let currentWords: LayoutWordToken[] = [];
    let currentLineWidth = 0;
    let currentMaxLineHeight = 14;

    for (const tok of tokens) {
      const neededWidth = currentWords.length > 0 ? tok.spaceWidth + tok.width : tok.width;

      if (currentLineWidth + neededWidth <= effectivePrintableWidth || currentWords.length === 0) {
        currentWords.push(tok);
        currentLineWidth += neededWidth;
        currentMaxLineHeight = Math.max(currentMaxLineHeight, tok.fontSize * 1.35);
      } else {
        lines.push({
          words: currentWords,
          lineWidth: currentLineWidth,
          lineHeight: Number.isFinite(currentMaxLineHeight) && currentMaxLineHeight > 0 ? currentMaxLineHeight : 14,
        });
        currentWords = [tok];
        currentLineWidth = tok.width;
        currentMaxLineHeight = tok.fontSize * 1.35;
      }
    }

    if (currentWords.length > 0) {
      lines.push({
        words: currentWords,
        lineWidth: currentLineWidth,
        lineHeight: Number.isFinite(currentMaxLineHeight) && currentMaxLineHeight > 0 ? currentMaxLineHeight : 14,
      });
    }

    // Render lines onto page
    for (const line of lines) {
      const lineHeight = Number.isFinite(line.lineHeight) && line.lineHeight > 0 ? line.lineHeight : 14;
      if (cursorY - lineHeight < bottomLimit || !Number.isFinite(cursorY)) {
        triggerNewPage();
      }

      // Calculate horizontal start position based on paragraph alignment
      let startX = marginsPt.left + indentLeft;
      if (para.alignment === 'center') {
        startX = marginsPt.left + indentLeft + Math.max(0, (effectivePrintableWidth - line.lineWidth) / 2);
      } else if (para.alignment === 'right') {
        startX = marginsPt.left + indentLeft + Math.max(0, effectivePrintableWidth - line.lineWidth);
      }

      let wordX = startX;
      for (let i = 0; i < line.words.length; i++) {
        const tok = line.words[i];
        safeDrawText(currentPage, tok.text, {
          x: wordX,
          y: cursorY,
          size: tok.fontSize,
          font: tok.font,
          color: rgb(tok.color.r, tok.color.g, tok.color.b),
        });

        // Draw Underline if enabled
        if (tok.isUnderline) {
          safeDrawLine(currentPage, {
            start: { x: wordX, y: cursorY - 1.5 },
            end: { x: wordX + tok.width, y: cursorY - 1.5 },
            thickness: 0.75,
            color: rgb(tok.color.r, tok.color.g, tok.color.b),
          });
        }

        wordX += tok.width + tok.spaceWidth;
      }

      cursorY -= lineHeight;
    }

    cursorY -= Math.min(para.spacingAfterPt || 4, 16);
  }

  // Draw Headers & Footers across all pages
  const totalPages = pdfDoc.getPageCount();
  const cleanTitle = safeWinAnsi(documentTitle || 'Document').slice(0, 80);

  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);

    // Header on pages > 1
    if (i > 0 && cleanTitle) {
      safeDrawText(page, cleanTitle, {
        x: marginsPt.left,
        y: pageHeightPt - marginsPt.top / 2 - 2,
        size: 8.5,
        font: fontHelvetica,
        color: rgb(0.45, 0.5, 0.55),
      });
      safeDrawLine(page, {
        start: { x: marginsPt.left, y: pageHeightPt - marginsPt.top / 2 - 6 },
        end: { x: pageWidthPt - marginsPt.right, y: pageHeightPt - marginsPt.top / 2 - 6 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.92),
      });
    }

    // Footer with Page Numbers
    if (includePageNumbers) {
      const footerText = `Page ${i + 1} of ${totalPages}`;
      let textWidth = 60;
      try {
        textWidth = fontHelvetica.widthOfTextAtSize(footerText, 9);
      } catch {}
      safeDrawText(page, footerText, {
        x: (pageWidthPt - textWidth) / 2,
        y: marginsPt.bottom / 2,
        size: 9,
        font: fontHelvetica,
        color: rgb(0.45, 0.5, 0.55),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return createPdfBlob(pdfBytes);
}
