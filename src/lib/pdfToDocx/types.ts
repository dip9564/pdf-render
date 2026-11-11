export type ConversionMode = 'editable' | 'visual';

export interface TextSpan {
  text: string;
  fontSize: number; // in points
  fontFamily: string;
  isBold: boolean;
  isItalic: boolean;
  isMonospace: boolean;
  isUnderline?: boolean;
  isSuperScript?: boolean;
  isSubScript?: boolean;
  color?: string; // hex color e.g. "1F2937"
  confidence?: number; // 0-100 OCR confidence score
  lowConfidence?: boolean; // flagged for user review without modifying recognized characters
}

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  transform: number[];
  resolvedFontName?: string;
  cssFontFamily?: string;
  isBoldFlag?: boolean;
  isItalicFlag?: boolean;
  isMonospaceFlag?: boolean;
  isUnderlineFlag?: boolean;
  isSuperScriptFlag?: boolean;
  isSubScriptFlag?: boolean;
  confidence?: number;
  lowConfidence?: boolean;
  ocrParagraphId?: number;
}

export interface StructuredLine {
  y: number;
  minX: number;
  maxX: number;
  height: number;
  spans: TextSpan[];
  rawText: string;
  items: PositionedItem[];
  ocrParagraphBreakBefore?: boolean;
}

export interface StructuredParagraph {
  type: 'paragraph' | 'heading' | 'title' | 'code' | 'list-item';
  headingLevel?: 1 | 2 | 3;
  spans: TextSpan[];
  alignment: 'left' | 'center' | 'right' | 'justified';
  spacingBefore?: number; // in twips
  spacingAfter?: number;  // in twips
  indentLeft?: number;    // in twips
  indentHanging?: number; // in twips
  isCodeBlock?: boolean;
  listType?: 'bullet' | 'numbered' | 'step';
  listLevel?: number;
  listInstance?: number;
  keepNext?: boolean;
  yTopPt?: number;
  yBottomPt?: number;
}

export interface StructuredTableCell {
  text: string;
  spans: TextSpan[];
  widthTwips: number;
  isHeader: boolean;
  alignment: 'left' | 'center' | 'right';
  colSpan?: number;
  backgroundColor?: string;
}

export interface StructuredTable {
  type: 'table';
  rows: StructuredTableCell[][];
  totalWidthTwips: number;
  columnCount: number;
  columnWidthsTwips: number[];
  hasHeaderRow?: boolean;
  yTopPt?: number;
  yBottomPt?: number;
}

export interface StructuredImage {
  type: 'image';
  data: Uint8Array;
  widthPt: number;
  heightPt: number;
  xPt: number;
  yPt: number;
  alignment: 'left' | 'center' | 'right';
  isDiagram?: boolean;
  yTopPt?: number;
  yBottomPt?: number;
}

export interface StructuredCodeBlock {
  type: 'code-block';
  lines: { text: string; indentSpaces: number; spans: TextSpan[] }[];
  rawCode: string;
  yTopPt?: number;
  yBottomPt?: number;
}

export interface StructuredTwoColumnBlock {
  type: 'two-column';
  leftBlocks: StructuredBlock[];
  rightBlocks: StructuredBlock[];
  leftWidthTwips: number;
  rightWidthTwips: number;
  gutterTwips: number;
  yTopPt?: number;
  yBottomPt?: number;
}

export interface StructuredCalloutBlock {
  type: 'callout';
  blocks: StructuredBlock[];
  backgroundColor?: string;
  borderColor?: string;
  accentColor?: string;
  paddingTwips?: number;
  yTopPt?: number;
  yBottomPt?: number;
}

export type StructuredBlock =
  | StructuredParagraph
  | StructuredTable
  | StructuredImage
  | StructuredCodeBlock
  | StructuredTwoColumnBlock
  | StructuredCalloutBlock;

export interface ExtractedPageData {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  marginsPt: { top: number; bottom: number; left: number; right: number };
  blocks: StructuredBlock[];
  isScanned: boolean;
  rawText: string;
  wordCount: number;
  hasTables: boolean;
  hasImages: boolean;
  hasCode: boolean;
  isCoverPage: boolean;
  headerText?: string;
  footerText?: string;
  hasPageNumbers?: boolean;
  ocrReviewCount?: number;
}

export interface ConversionOptions {
  mode: ConversionMode;
  preservePageBreaks: boolean;
  smartHeadingDetection: boolean;
  detectTables: boolean;
  detectCodeBlocks: boolean;
  extractImages: boolean;
  enableOcr: boolean;
  ocrLanguage: string;
  defaultFontFamily: string; // e.g. "Arial" or "Calibri"
}

export interface ConversionProgress {
  stage: 'analyzing' | 'ocr' | 'images' | 'building' | 'complete';
  currentPage: number;
  totalPages: number;
  message: string;
  percent: number;
}
