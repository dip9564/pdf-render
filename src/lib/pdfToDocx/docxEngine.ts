import {
  Document as DocxDocument,
  Paragraph as DocxParagraph,
  TextRun as DocxTextRun,
  HeadingLevel,
  Packer,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  TableLayoutType,
  LevelFormat,
  WidthType,
  ShadingType,
  BorderStyle,
  AlignmentType,
  PageOrientation,
  ImageRun,
  Footer,
  Header,
  XmlComponent,
  XmlAttributeComponent,
} from 'docx';
import {
  ExtractedPageData,
  ConversionOptions,
  StructuredParagraph,
  StructuredTable,
  StructuredImage,
  StructuredCodeBlock,
  StructuredTwoColumnBlock,
  StructuredCalloutBlock,
  StructuredBlock,
  TextSpan,
} from './types';
import { rasterizePageToPng } from './imageExtractor';

const NUMBERED_LIST_REF = 'objectives-decimal-list';
const STEP_LIST_REF = 'procedure-step-list';

/**
 * Maps alignment string to docx AlignmentType
 */
function mapAlignment(align: 'left' | 'center' | 'right' | 'justified'): any {
  switch (align) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justified':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

/**
 * Builds DocxTextRun(s) from a TextSpan, safely handling Unicode glyphs like ₹ (U+20B9)
 * that may be missing from standard Arial/Times New Roman/Calibri/Courier fonts on macOS and Linux.
 */
function sanitizeXmlString(str: string): string {
  // Remove only invalid XML 1.0 control characters while preserving all valid Unicode code points
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

class FieldCharAttributes extends XmlAttributeComponent<{
  readonly fldCharType: 'begin' | 'separate' | 'end';
  readonly dirty?: 'true';
}> {
  protected readonly xmlKeys = {
    fldCharType: 'w:fldCharType',
    dirty: 'w:dirty',
  };
}

class FieldCharXml extends XmlComponent {
  constructor(fldCharType: 'begin' | 'separate' | 'end', dirty?: boolean) {
    super('w:fldChar');
    this.root.push(
      new FieldCharAttributes(dirty ? { fldCharType, dirty: 'true' } : { fldCharType })
    );
  }
}

class InstrSpaceAttributes extends XmlAttributeComponent<{ readonly space: 'preserve' }> {
  protected readonly xmlKeys = { space: 'xml:space' };
}

class InstrTextXml extends XmlComponent {
  constructor(instr: string) {
    super('w:instrText');
    this.root.push(new InstrSpaceAttributes({ space: 'preserve' }));
    this.root.push(instr);
  }
}

interface FontSafeRunOptions {
  text: string;
  size: number;
  fontFamily: string;
  bold?: boolean;
  italics?: boolean;
  underline?: Record<string, never>;
  superScript?: boolean;
  subScript?: boolean;
  highlight?: 'yellow';
  color?: string;
  breakOnFirstRun?: number;
}

/**
 * Emits DocxTextRun(s) safely switching glyphs absent from standard Arial/Calibri/Times/Consolas
 * on macOS/Windows (₹ U+20B9 and unsplit Unicode subscript/superscript digits) to Georgia
 * (natively present on both macOS and Windows with full coverage), preventing .notdef □ squares.
 */
function createFontSafeRuns(opts: FontSafeRunOptions): DocxTextRun[] {
  const cleanText = sanitizeXmlString(opts.text || '');
  if (!cleanText) return [];
  const baseFamily = opts.fontFamily || 'Arial';
  const georgiaFallbackSplitRe = /([₹₀-₉⁰⁴-⁹⁺⁻⁼⁽⁾])/;

  if (georgiaFallbackSplitRe.test(cleanText) && baseFamily !== 'Georgia') {
    const parts = cleanText.split(georgiaFallbackSplitRe).filter(Boolean);
    const singleFallbackCharRe = /^[₹₀-₉⁰⁴-⁹⁺⁻⁼⁽⁾]$/;
    return parts.map(
      (part, idx) =>
        new DocxTextRun({
          text: part,
          size: opts.size,
          font: singleFallbackCharRe.test(part) ? 'Georgia' : baseFamily,
          bold: opts.bold,
          italics: opts.italics,
          underline: opts.underline,
          superScript: opts.superScript,
          subScript: opts.subScript,
          highlight: opts.highlight,
          color: opts.color,
          break: idx === 0 ? opts.breakOnFirstRun : undefined,
        })
    );
  }

  return [
    new DocxTextRun({
      text: cleanText,
      size: opts.size,
      font: baseFamily,
      bold: opts.bold,
      italics: opts.italics,
      underline: opts.underline,
      superScript: opts.superScript,
      subScript: opts.subScript,
      highlight: opts.highlight,
      color: opts.color,
      break: opts.breakOnFirstRun,
    }),
  ];
}

function buildDynamicFieldRuns(
  instruction: 'PAGE' | 'NUMPAGES',
  cachedValue: string,
  style: { size: number; color: string; fontFamily: string }
): DocxTextRun[] {
  return [
    new DocxTextRun({
      children: [new FieldCharXml('begin', true)],
      size: style.size,
      color: style.color,
      font: style.fontFamily,
    }),
    new DocxTextRun({
      children: [new InstrTextXml(` ${instruction} `)],
      size: style.size,
      color: style.color,
      font: style.fontFamily,
    }),
    new DocxTextRun({
      children: [new FieldCharXml('separate')],
      size: style.size,
      color: style.color,
      font: style.fontFamily,
    }),
    new DocxTextRun({
      text: cachedValue,
      size: style.size,
      color: style.color,
      font: style.fontFamily,
    }),
    new DocxTextRun({
      children: [new FieldCharXml('end')],
      size: style.size,
      color: style.color,
      font: style.fontFamily,
    }),
  ];
}

function createRunsFromSpan(s: TextSpan, forceBold?: boolean): DocxTextRun[] {
  const rawText = s?.text || '';
  if (!rawText) return [];
  return createFontSafeRuns({
    text: rawText,
    size: Math.round((s?.fontSize || 11) * 2),
    fontFamily: s?.fontFamily || 'Arial',
    // IMPORTANT: Pass undefined when false so OOXML never emits <w:b w:val="false"/> / <w:i w:val="false"/>,
    // which macOS Cocoa / Apple viewers misinterpret as bold/italic.
    bold: Boolean(forceBold || s?.isBold) ? true : undefined,
    italics: s?.isItalic ? true : undefined,
    underline: s?.isUnderline ? {} : undefined,
    superScript: s?.isSuperScript ? true : undefined,
    subScript: !s?.isSuperScript && s?.isSubScript ? true : undefined,
    highlight: s?.lowConfidence ? 'yellow' : undefined,
    color: s?.color || '111827',
  });
}

/**
 * Optional paragraph styling overrides used by native Word callout panels
 */
interface ParagraphStyleOverrides {
  border?: any;
  shading?: any;
  indent?: { left?: number; right?: number; hanging?: number; firstLine?: number };
  spacingBefore?: number;
  spacingAfter?: number;
  keepNext?: boolean;
}

/**
 * Builds a docx Paragraph from a StructuredParagraph with exact semantic Word styles
 */
function buildDocxParagraph(
  p: StructuredParagraph,
  overrides?: ParagraphStyleOverrides
): DocxParagraph {
  const fallbackText = (p as any)?.text || (p as any)?.rawText || '';
  const spans: TextSpan[] =
    Array.isArray(p?.spans) && p.spans.length > 0
      ? p.spans
      : [
          {
            text: fallbackText,
            fontSize: p?.type === 'heading' ? 14 : 11,
            fontFamily: 'Arial',
            isBold: p?.type === 'heading' || false,
            isItalic: false,
            isMonospace: false,
            isUnderline: false,
            isSuperScript: false,
            isSubScript: false,
            color: '111827',
          },
        ];

  const runs: DocxTextRun[] = spans.flatMap((s) => createRunsFromSpan(s));

  let heading: any = undefined;
  if (p?.type === 'title') {
    heading = HeadingLevel.TITLE;
  } else if (p?.type === 'heading') {
    if (p.headingLevel === 1) heading = HeadingLevel.HEADING_1;
    else if (p.headingLevel === 2) heading = HeadingLevel.HEADING_2;
    else heading = HeadingLevel.HEADING_2;
  }

  const keepNextVal =
    overrides?.keepNext !== undefined
      ? overrides.keepNext
      : Boolean(p?.keepNext || p?.type === 'heading' || p?.type === 'title');

  const paragraphConfig: any = {
    children: runs.length > 0 ? runs : [new DocxTextRun({ text: '' })],
    alignment: mapAlignment(p?.alignment || 'left'),
    heading,
    keepNext: keepNextVal ? true : undefined,
    spacing: {
      before:
        overrides?.spacingBefore ??
        p?.spacingBefore ??
        (p?.type === 'title'
          ? 20
          : p?.type === 'heading'
          ? p.headingLevel === 1
            ? 110
            : 75
          : p?.type === 'list-item'
          ? 16
          : 20),
      after:
        overrides?.spacingAfter ??
        p?.spacingAfter ??
        (p?.type === 'title'
          ? 80
          : p?.type === 'heading'
          ? 36
          : p?.type === 'list-item'
          ? 24
          : 44),
      line: 250, // Compact 1.04x pitch to prevent page overflow across sections
    },
  };

  if (overrides?.border) paragraphConfig.border = overrides.border;
  if (overrides?.shading) paragraphConfig.shading = overrides.shading;
  if (overrides?.indent) paragraphConfig.indent = overrides.indent;

  // Real Word list numbering (<w:numPr>) for bullets, decimal numbered lists, and Step procedures
  if (p?.type === 'list-item') {
    if (p.listType === 'step') {
      paragraphConfig.numbering = {
        reference: STEP_LIST_REF,
        level: p.listLevel || 0,
        instance: p.listInstance || 1,
      };
    } else if (p.listType === 'numbered') {
      paragraphConfig.numbering = {
        reference: NUMBERED_LIST_REF,
        level: p.listLevel || 0,
        instance: p.listInstance || 1,
      };
    } else {
      paragraphConfig.bullet = { level: p.listLevel || 0 };
    }

    // Apply exact PDF-derived marker/content hanging indentation when available
    if (!overrides?.indent && p.indentLeft && p.indentLeft > 0) {
      paragraphConfig.indent = {
        left: p.indentLeft,
        hanging: p.indentHanging ?? (p.listType === 'step' ? 520 : 280),
      };
    }
  }

  return new DocxParagraph(paragraphConfig);
}

/**
 * Builds an actual editable Word Table with fixed column grid and clean borders
 */
function buildDocxTable(t: StructuredTable): DocxTable {
  const rows = Array.isArray(t?.rows) ? t.rows : [];
  const hasHeader = t?.hasHeaderRow !== false;
  const colWidths =
    Array.isArray(t?.columnWidthsTwips) && t.columnWidthsTwips.length > 0
      ? t.columnWidthsTwips
      : [t?.totalWidthTwips || 9000];
  const totalW = colWidths.reduce((a, b) => a + b, 0) || t?.totalWidthTwips || 9000;

  const tableRows: DocxTableRow[] = rows.map((r, rIdx) => {
    const isHeaderRow = hasHeader && rIdx === 0;
    const cells = Array.isArray(r) ? r : [];
    return new DocxTableRow({
      tableHeader: isHeaderRow ? true : undefined,
      cantSplit: true,
      children: cells.map((c, cIdx) => {
        const cellWidth = colWidths[cIdx] || c?.widthTwips || Math.floor(totalW / Math.max(1, cells.length));
        const spans =
          Array.isArray(c?.spans) && c.spans.length > 0
            ? c.spans
            : [
                {
                  text: c?.text || '',
                  fontSize: c?.isHeader ? 10 : 9.5,
                  fontFamily: 'Arial',
                  isBold: c?.isHeader || false,
                  isItalic: false,
                  isMonospace: false,
                  color: '111827',
                },
              ];

        const runs = spans.flatMap((s) => createRunsFromSpan(s, c?.isHeader));

        const cellPara = new DocxParagraph({
          children: runs.length > 0 ? runs : [new DocxTextRun({ text: c?.text || '' })],
          alignment: mapAlignment(c?.alignment || 'left'),
          spacing: { before: 16, after: 16, line: 230 },
        });

        return new DocxTableCell({
          children: [cellPara],
          width: {
            size: cellWidth,
            type: WidthType.DXA,
          },
          shading: c?.backgroundColor
            ? { fill: c.backgroundColor, type: ShadingType.CLEAR }
            : c?.isHeader
            ? { fill: 'F1F5F9', type: ShadingType.CLEAR }
            : undefined,
          margins: {
            top: 55,
            bottom: 55,
            left: 95,
            right: 95,
          },
        });
      }),
    });
  });

  return new DocxTable({
    rows: tableRows,
    columnWidths: colWidths,
    layout: TableLayoutType.FIXED,
    width: {
      size: totalW,
      type: WidthType.DXA,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '94A3B8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    },
  });
}

/**
 * Builds ONE unified padded code-block container using Consolas monospace font,
 * exact leading whitespace preservation (without double indenting), explicit newlines (<w:br/>),
 * background shading (#F8FAFC), left accent bar (#3B82F6), and cell padding.
 */
function buildDocxCodeBlock(
  code: StructuredCodeBlock,
  containerWidthTwips: number = 9600
): (DocxTable | DocxParagraph)[] {
  const lines =
    Array.isArray(code?.lines) && code.lines.length > 0
      ? code.lines
      : typeof code?.rawCode === 'string'
      ? code.rawCode.split('\n').map((l) => ({ text: l, indentSpaces: 0, spans: [] }))
      : [{ text: '', indentSpaces: 0, spans: [] }];

  const codeRuns: DocxTextRun[] = [];
  lines.forEach((l, idx) => {
    const lineText = typeof l === 'string' ? l : l?.text ?? '';
    if (!lineText) {
      codeRuns.push(
        new DocxTextRun({
          text: '',
          font: 'Consolas',
          size: 19, // 9.5pt
          color: '0F172A',
          break: idx > 0 ? 1 : undefined,
        })
      );
      return;
    }
    codeRuns.push(
      ...createFontSafeRuns({
        text: lineText,
        fontFamily: 'Consolas',
        size: 19,
        color: '0F172A',
        breakOnFirstRun: idx > 0 ? 1 : undefined,
      })
    );
  });

  const codePara = new DocxParagraph({
    spacing: { before: 10, after: 10, line: 260 },
    children: codeRuns.length > 0 ? codeRuns : [new DocxTextRun({ text: '', font: 'Consolas', size: 19 })],
  });

  const codeContainer = new DocxTable({
    columnWidths: [containerWidthTwips],
    layout: TableLayoutType.FIXED,
    width: {
      size: containerWidthTwips,
      type: WidthType.DXA,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      left: { style: BorderStyle.SINGLE, size: 18, color: '3B82F6' },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new DocxTableRow({
        cantSplit: true,
        children: [
          new DocxTableCell({
            width: {
              size: containerWidthTwips,
              type: WidthType.DXA,
            },
            shading: {
              fill: 'F8FAFC',
              type: ShadingType.CLEAR,
            },
            margins: {
              top: 110,
              bottom: 110,
              left: 180,
              right: 160,
            },
            children: [codePara],
          }),
        ],
      }),
    ],
  });

  // Compact breathing paragraph after code container
  const afterSpacer = new DocxParagraph({
    spacing: { before: 0, after: 40, line: 120 },
    children: [new DocxTextRun({ text: '', size: 4 })],
  });

  return [codeContainer, afterSpacer];
}

/**
 * Builds a borderless Fixed-Grid Two-Column layout block keeping Column A and Column B
 * strictly parallel, balanced inside printable margins, with zero truncation or spilling.
 */
function buildDocxTwoColumnBlock(b: StructuredTwoColumnBlock): DocxTable {
  const leftBlocks = Array.isArray(b?.leftBlocks) ? b.leftBlocks : [];
  const rightBlocks = Array.isArray(b?.rightBlocks) ? b.rightBlocks : [];

  const gutter = b?.gutterTwips || 480;
  const halfGutter = Math.round(gutter / 2);
  const leftInnerW = b?.leftWidthTwips || 4500;
  const rightInnerW = b?.rightWidthTwips || 4500;

  // Cell widths MUST sum strictly to totalWidth under TableLayoutType.FIXED
  const leftCellW = leftInnerW + halfGutter;
  const rightCellW = rightInnerW + halfGutter;
  const totalWidth = leftCellW + rightCellW;

  const leftElements: any[] = [];
  for (const block of leftBlocks) {
    if (!block) continue;
    const el = buildBlockElement(block, leftInnerW);
    if (Array.isArray(el)) {
      leftElements.push(...el);
    } else if (el) {
      leftElements.push(el);
    }
  }

  const rightElements: any[] = [];
  for (const block of rightBlocks) {
    if (!block) continue;
    const el = buildBlockElement(block, rightInnerW);
    if (Array.isArray(el)) {
      rightElements.push(...el);
    } else if (el) {
      rightElements.push(el);
    }
  }

  return new DocxTable({
    columnWidths: [leftCellW, rightCellW],
    layout: TableLayoutType.FIXED,
    width: {
      size: totalWidth,
      type: WidthType.DXA,
    },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new DocxTableRow({
        children: [
          new DocxTableCell({
            width: {
              size: leftCellW,
              type: WidthType.DXA,
            },
            margins: {
              top: 20,
              bottom: 20,
              left: 0,
              right: halfGutter,
            },
            children: leftElements.length > 0 ? leftElements : [new DocxParagraph({ text: '' })],
          }),
          new DocxTableCell({
            width: {
              size: rightCellW,
              type: WidthType.DXA,
            },
            margins: {
              top: 20,
              bottom: 20,
              left: halfGutter,
              right: 0,
            },
            children: rightElements.length > 0 ? rightElements : [new DocxParagraph({ text: '' })],
          }),
        ],
      }),
    ],
  });
}

/**
 * Builds a docx Image paragraph from a StructuredImage
 */
function buildDocxImage(img: StructuredImage): DocxParagraph {
  return new DocxParagraph({
    alignment: mapAlignment(img.alignment),
    children: [
      new ImageRun({
        data: img.data,
        type: 'png',
        transformation: {
          width: Math.min(img.widthPt, 500),
          height: Math.min(img.heightPt, 650),
        },
      }),
    ],
    spacing: { before: 80, after: 80 },
  });
}

/**
 * Builds a styled editable Word callout container preserving background fill,
 * border color, left accent stripe, inner padding, and full editable text/lists inside.
 * Emits native bordered & shaded Word paragraphs (without wrapping normal callouts
 * inside an unrelated 1-cell table), falling back to a container table only when
 * nested non-paragraph blocks (tables/code/two-column) exist inside.
 */
function buildDocxCalloutBlock(
  callout: StructuredCalloutBlock,
  containerWidthTwips: number = 9600
): (DocxTable | DocxParagraph)[] {
  const bgFill = callout?.backgroundColor || 'EFF6FF';
  const borderCol = callout?.borderColor || 'BFDBFE';
  const accentCol = callout?.accentColor || callout?.borderColor || '3B82F6';
  const calloutBlocks = Array.isArray(callout?.blocks) ? callout.blocks : [];

  const allSimpleParagraphs = calloutBlocks.every(
    (b) => b && (b.type === 'paragraph' || b.type === 'heading' || b.type === 'list-item')
  );

  if (allSimpleParagraphs) {
    const calloutBorder = {
      top: { style: BorderStyle.SINGLE, size: 6, color: borderCol, space: 8 },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: borderCol, space: 8 },
      right: { style: BorderStyle.SINGLE, size: 6, color: borderCol, space: 10 },
      left: { style: BorderStyle.SINGLE, size: 24, color: accentCol, space: 12 },
      between: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    };
    const calloutShading = { fill: bgFill, type: ShadingType.CLEAR };

    if (calloutBlocks.length === 0) {
      return [
        new DocxParagraph({
          border: calloutBorder,
          shading: calloutShading,
          indent: { left: 160, right: 140 },
          spacing: { before: 70, after: 80, line: 250 },
          children: [new DocxTextRun({ text: '' })],
        }),
      ];
    }

    const simpleBlocks = calloutBlocks as StructuredParagraph[];
    return simpleBlocks.map((innerP, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === simpleBlocks.length - 1;
      const baseIndent =
        innerP.type === 'list-item' && innerP.indentLeft && innerP.indentLeft > 0
          ? {
              left: Math.max(220, innerP.indentLeft + 120),
              right: 140,
              hanging: innerP.indentHanging ?? 260,
            }
          : { left: 160, right: 140 };

      return buildDocxParagraph(innerP, {
        border: calloutBorder,
        shading: calloutShading,
        indent: baseIndent,
        spacingBefore: isFirst ? Math.max(70, innerP.spacingBefore || 0) : 16,
        spacingAfter: isLast ? Math.max(80, innerP.spacingAfter || 0) : 24,
        keepNext: !isLast && simpleBlocks.length <= 6 ? true : innerP.type === 'heading',
      });
    });
  }

  const pad = Math.max(100, callout?.paddingTwips || 150);
  const innerWidthTwips = Math.max(2400, containerWidthTwips - (pad * 2 + 80));
  const innerElements: any[] = [];

  for (const innerBlock of calloutBlocks) {
    if (!innerBlock) continue;
    const el = buildBlockElement(innerBlock, innerWidthTwips);
    if (Array.isArray(el)) {
      innerElements.push(...el);
    } else if (el) {
      innerElements.push(el);
    }
  }

  const calloutContainer = new DocxTable({
    columnWidths: [containerWidthTwips],
    layout: TableLayoutType.FIXED,
    width: {
      size: containerWidthTwips,
      type: WidthType.DXA,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: borderCol },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: borderCol },
      right: { style: BorderStyle.SINGLE, size: 6, color: borderCol },
      left: { style: BorderStyle.SINGLE, size: 24, color: accentCol },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new DocxTableRow({
        cantSplit: true,
        children: [
          new DocxTableCell({
            width: {
              size: containerWidthTwips,
              type: WidthType.DXA,
            },
            shading: {
              fill: bgFill,
              type: ShadingType.CLEAR,
            },
            margins: {
              top: pad,
              bottom: pad,
              left: pad + 50,
              right: pad,
            },
            children:
              innerElements.length > 0 ? innerElements : [new DocxParagraph({ text: '' })],
          }),
        ],
      }),
    ],
  });

  const afterSpacer = new DocxParagraph({
    spacing: { before: 0, after: 40, line: 120 },
    children: [new DocxTextRun({ text: '', size: 4 })],
  });

  return [calloutContainer, afterSpacer];
}

/**
 * Dispatches any StructuredBlock to its corresponding docx component(s)
 */
function buildBlockElement(block: StructuredBlock, containerWidthTwips: number = 9600): any {
  if (block.type === 'table') {
    return buildDocxTable(block as StructuredTable);
  } else if (block.type === 'code-block') {
    return buildDocxCodeBlock(block as StructuredCodeBlock, containerWidthTwips);
  } else if (block.type === 'callout') {
    return buildDocxCalloutBlock(block as StructuredCalloutBlock, containerWidthTwips);
  } else if (block.type === 'two-column') {
    return buildDocxTwoColumnBlock(block as StructuredTwoColumnBlock);
  } else if (block.type === 'image') {
    return buildDocxImage(block as StructuredImage);
  } else {
    return buildDocxParagraph(block as StructuredParagraph);
  }
}

/**
 * Helper to construct a clean dynamic footer section from extracted PDF footer info
 * with true ECMA-376 PAGE and NUMPAGES complex fields (marked dirty + cached values).
 */
function buildDynamicFooter(
  footerPrefix: string | undefined,
  includePageNumbers: boolean,
  currentPageNum: number = 1,
  totalPageCount: number = 1
): Footer | undefined {
  // Defensively strip any residual literal Page X of Y from footerPrefix to prevent duplicate page numbers
  const cleanPrefix = footerPrefix
    ? sanitizeXmlString(footerPrefix)
        .replace(
          /\s*\|\s*(?:Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+|\d{1,3}\s*\/\s*\d{1,3})\s*(?=\||$)/gi,
          ''
        )
        .replace(/\b(?:Page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+)\b/gi, '')
        .replace(/^[\|\-–—\s]+|[\|\-–—\s]+$/g, '')
        .trim()
    : undefined;

  if (!cleanPrefix && !includePageNumbers) return undefined;

  const footerStyle = {
    size: 17,
    color: '64748B',
    fontFamily: 'Arial',
  };

  const children: DocxTextRun[] = [];
  if (cleanPrefix) {
    children.push(
      ...createFontSafeRuns({
        text: includePageNumbers ? `${cleanPrefix} | Page ` : cleanPrefix,
        ...footerStyle,
      })
    );
  } else if (includePageNumbers) {
    children.push(
      new DocxTextRun({
        text: 'Page ',
        size: footerStyle.size,
        color: footerStyle.color,
        font: footerStyle.fontFamily,
      })
    );
  }

  if (includePageNumbers) {
    children.push(
      ...buildDynamicFieldRuns('PAGE', String(Math.max(1, currentPageNum)), footerStyle),
      new DocxTextRun({
        text: ' of ',
        size: footerStyle.size,
        color: footerStyle.color,
        font: footerStyle.fontFamily,
      }),
      ...buildDynamicFieldRuns('NUMPAGES', String(Math.max(1, totalPageCount)), footerStyle)
    );
  }

  return new Footer({
    children: [
      new DocxParagraph({
        alignment: AlignmentType.RIGHT,
        children,
      }),
    ],
  });
}

/**
 * Builds the complete editable Word document for Mode A (High-Fidelity Editable)
 */
export async function buildHighFidelityDocx(
  pages: ExtractedPageData[],
  options: ConversionOptions
): Promise<Blob> {
  const sharedFooterPrefix = pages.map((p) => p.footerText).find(Boolean);
  const documentHasPageNumbers = pages.some((p) => p.hasPageNumbers) || pages.length > 1;
  const sharedHeaderPrefix = pages.map((p) => p.headerText).find(Boolean);

  const numberingConfig = {
    config: [
      {
        reference: NUMBERED_LIST_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 540, hanging: 280 },
              },
            },
          },
          {
            level: 1,
            format: LevelFormat.LOWER_LETTER,
            text: '%2)',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 960, hanging: 280 },
              },
            },
          },
        ],
      },
      {
        reference: STEP_LIST_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: 'Step %1:',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 780, hanging: 520 },
              },
            },
          },
        ],
      },
    ],
  };

  if (!options.preservePageBreaks && pages.length > 0) {
    const first = pages[0];
    const printableTwips = Math.round(
      (first.widthPt - first.marginsPt.left - first.marginsPt.right) * 20
    );
    const allChildren: any[] = [];
    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      for (let bIdx = 0; bIdx < page.blocks.length; bIdx++) {
        const block = page.blocks[bIdx];
        const nextBlock =
          bIdx + 1 < page.blocks.length
            ? page.blocks[bIdx + 1]
            : pages[pIdx + 1]?.blocks?.[0];
        const el = buildBlockElement(block, printableTwips);
        if (Array.isArray(el)) {
          if (
            (block.type === 'code-block' ||
              (block.type === 'callout' && el[0] instanceof DocxTable)) &&
            (!nextBlock ||
              (nextBlock.type !== 'table' &&
                nextBlock.type !== 'code-block' &&
                nextBlock.type !== 'callout' &&
                nextBlock.type !== 'two-column'))
          ) {
            allChildren.push(el[0]);
          } else if (block.type === 'callout' && !(el[0] instanceof DocxTable)) {
            allChildren.push(...el);
            if (nextBlock?.type === 'callout') {
              allChildren.push(
                new DocxParagraph({
                  spacing: { before: 0, after: 40, line: 120 },
                  children: [new DocxTextRun({ text: '', size: 4 })],
                })
              );
            }
          } else {
            allChildren.push(...el);
          }
        } else if (el) {
          allChildren.push(el);
        }
      }
    }
    if (allChildren.length === 0) allChildren.push(new DocxParagraph({ text: '' }));

    const footerObj = buildDynamicFooter(
      sharedFooterPrefix,
      documentHasPageNumbers,
      1,
      Math.max(1, pages.length)
    );
    const headerObj = sharedHeaderPrefix
      ? new Header({
          children: [
            new DocxParagraph({
              alignment: AlignmentType.LEFT,
              children: createFontSafeRuns({
                text: sharedHeaderPrefix,
                size: 17,
                color: '94A3B8',
                fontFamily: 'Arial',
              }),
            }),
          ],
        })
      : undefined;

    const doc = new DocxDocument({
      numbering: numberingConfig,
      features: { updateFields: true },
      sections: [
        {
          properties: {
            page: {
              size: {
                width: Math.round(first.widthPt * 20),
                height: Math.round(first.heightPt * 20),
                orientation:
                  first.orientation === 'landscape'
                    ? PageOrientation.LANDSCAPE
                    : PageOrientation.PORTRAIT,
              },
              margin: {
                top: Math.round(first.marginsPt.top * 20),
                bottom: Math.round(first.marginsPt.bottom * 20),
                left: Math.round(first.marginsPt.left * 20),
                right: Math.round(first.marginsPt.right * 20),
                header: 420,
                footer: 420,
              },
            },
          },
          headers: headerObj ? { default: headerObj } : undefined,
          footers: footerObj ? { default: footerObj } : undefined,
          children: allChildren,
        },
      ],
    });
    return await Packer.toBlob(doc);
  }

  const sections: any[] = [];

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const children: any[] = [];
    const printableTwips = Math.round(
      (page.widthPt - page.marginsPt.left - page.marginsPt.right) * 20
    );

    // Process blocks on this page
    for (let bIdx = 0; bIdx < page.blocks.length; bIdx++) {
      const block = page.blocks[bIdx];
      const nextBlock = page.blocks[bIdx + 1];
      const el = buildBlockElement(block, printableTwips);
      if (Array.isArray(el)) {
        // Insert tiny separating paragraph ONLY when another table/container block follows immediately
        if (
          (block.type === 'code-block' ||
            (block.type === 'callout' && el[0] instanceof DocxTable)) &&
          (!nextBlock ||
            (nextBlock.type !== 'table' &&
              nextBlock.type !== 'code-block' &&
              nextBlock.type !== 'callout' &&
              nextBlock.type !== 'two-column'))
        ) {
          children.push(el[0]);
        } else if (block.type === 'callout' && !(el[0] instanceof DocxTable)) {
          children.push(...el);
          if (nextBlock?.type === 'callout') {
            children.push(
              new DocxParagraph({
                spacing: { before: 0, after: 40, line: 120 },
                children: [new DocxTextRun({ text: '', size: 4 })],
              })
            );
          }
        } else {
          children.push(...el);
        }
      } else if (el) {
        children.push(el);
      }
    }

    // Fallback if empty page
    if (children.length === 0) {
      children.push(new DocxParagraph({ text: '' }));
    }

    const widthTwips = Math.round(page.widthPt * 20);
    const heightTwips = Math.round(page.heightPt * 20);

    const footerObj = buildDynamicFooter(
      page.footerText || sharedFooterPrefix,
      page.hasPageNumbers || documentHasPageNumbers,
      pIdx + 1,
      Math.max(1, pages.length)
    );
    const footers = footerObj ? { default: footerObj } : undefined;

    const effectiveHeader = page.headerText || sharedHeaderPrefix;
    const headers = effectiveHeader
      ? {
          default: new Header({
            children: [
              new DocxParagraph({
                alignment: AlignmentType.LEFT,
                children: createFontSafeRuns({
                  text: effectiveHeader,
                  size: 17,
                  color: '94A3B8',
                  fontFamily: 'Arial',
                }),
              }),
            ],
          }),
        }
      : undefined;

    sections.push({
      properties: {
        page: {
          size: {
            width: widthTwips,
            height: heightTwips,
            orientation:
              page.orientation === 'landscape'
                ? PageOrientation.LANDSCAPE
                : PageOrientation.PORTRAIT,
          },
          margin: {
            top: Math.round(page.marginsPt.top * 20),
            bottom: Math.round(page.marginsPt.bottom * 20),
            left: Math.round(page.marginsPt.left * 20),
            right: Math.round(page.marginsPt.right * 20),
            header: 420,
            footer: 420,
          },
        },
      },
      headers,
      footers,
      children,
    });
  }

  const doc = new DocxDocument({
    numbering: numberingConfig,
    features: { updateFields: true },
    sections,
  });
  return await Packer.toBlob(doc);
}

/**
 * Builds Visual Layout Preservation Word document (Mode B)
 */
export async function buildVisualLayoutDocx(
  pdfDoc: any,
  pages: ExtractedPageData[]
): Promise<Blob> {
  const sections: any[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const pdfPage = await pdfDoc.getPage(i);
    const pageData = pages[i - 1] || {
      widthPt: 595.28,
      heightPt: 841.89,
      orientation: 'portrait',
    };

    const pngBytes = await rasterizePageToPng(pdfPage, 2.0);

    const widthTwips = Math.round(pageData.widthPt * 20);
    const heightTwips = Math.round(pageData.heightPt * 20);

    sections.push({
      properties: {
        page: {
          size: {
            width: widthTwips,
            height: heightTwips,
            orientation:
              pageData.orientation === 'landscape'
                ? PageOrientation.LANDSCAPE
                : PageOrientation.PORTRAIT,
          },
          margin: {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          },
        },
      },
      children: [
        new DocxParagraph({
          children: [
            new ImageRun({
              data: pngBytes,
              type: 'png',
              transformation: {
                width: Math.round(pageData.widthPt),
                height: Math.round(pageData.heightPt),
              },
            }),
          ],
        }),
      ],
    });
  }

  const doc = new DocxDocument({ sections });
  return await Packer.toBlob(doc);
}