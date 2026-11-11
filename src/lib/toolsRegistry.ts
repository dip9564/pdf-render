import {
  AlignLeft,
  Droplets,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  GraduationCap,
  Hash,
  ImageDown,
  LayoutGrid,
  LucideIcon,
  Merge,
  Paintbrush,
  Scissors,
  ShieldCheck,
  Type,
} from 'lucide-react';

export type ToolCategoryId =
  | 'all'
  | 'create-convert'
  | 'organize'
  | 'edit'
  | 'security'
  | 'intelligence';

export type AssignableToolCategoryId = Exclude<ToolCategoryId, 'all'>;

export interface ToolCategoryDefinition {
  id: ToolCategoryId;
  label: string;
}

export interface PdfToolDefinition {
  id: string;
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  borderColor: string;
  categories: AssignableToolCategoryId[];
  keywords: string[];
  priority: number;
}

export const PDF_TOOL_CATEGORIES: readonly ToolCategoryDefinition[] = [
  { id: 'all', label: 'All Tools' },
  { id: 'create-convert', label: 'Create & Convert' },
  { id: 'organize', label: 'Organize PDF' },
  { id: 'edit', label: 'Edit PDF' },
  { id: 'security', label: 'Security' },
  { id: 'intelligence', label: 'PDF Intelligence' },
] as const;

const CATEGORY_LABEL_MAP: Record<AssignableToolCategoryId, string> = {
  'create-convert': 'Create & Convert',
  organize: 'Organize PDF',
  edit: 'Edit PDF',
  security: 'Security',
  intelligence: 'PDF Intelligence',
};

/**
 * Centralized tool configuration ordered by homepage priority:
 * Primary tools (1-8), Conversion tools (9-11), Other tools (12-16).
 */
export const PDF_TOOLS: readonly PdfToolDefinition[] = [
  // Primary tools (1-8)
  {
    id: 'front-page',
    path: '/front-page',
    label: 'Front Page Generator',
    description:
      'Design A4 assignment cover pages with college logo, details preview, and PDF attachment.',
    icon: GraduationCap,
    color: 'bg-amber-500/10 text-amber-500',
    borderColor: 'hover:border-amber-500/30',
    categories: ['create-convert'],
    keywords: [
      'cover page',
      'front page',
      'title page',
      'assignment cover',
      'college cover',
      'kgec',
      'lab report',
      'academic',
      'prepend cover',
    ],
    priority: 1,
  },
  {
    id: 'image-to-pdf',
    path: '/image-to-pdf',
    label: 'Image to PDF',
    description: 'Convert images to PDF with custom layouts, page sizes, and image editing.',
    icon: FileImage,
    color: 'bg-blue-500/10 text-blue-500',
    borderColor: 'hover:border-blue-500/30',
    categories: ['create-convert'],
    keywords: [
      'jpg to pdf',
      'jpeg to pdf',
      'png to pdf',
      'photo to pdf',
      'picture to pdf',
      'convert image',
      'create pdf',
      'images',
    ],
    priority: 2,
  },
  {
    id: 'merge-pdf',
    path: '/merge-pdf',
    label: 'Merge PDF',
    description: 'Combine multiple PDF files into one. Reorder and select specific pages.',
    icon: Merge,
    color: 'bg-green-500/10 text-green-500',
    borderColor: 'hover:border-green-500/30',
    categories: ['organize'],
    keywords: [
      'combine',
      'join',
      'unite',
      'concat',
      'append',
      'bind',
      'merge pdfs',
      'multiple files',
    ],
    priority: 3,
  },
  {
    id: 'split-pdf',
    path: '/split-pdf',
    label: 'Split PDF',
    description: 'Extract pages, split by ranges, or separate every page into individual PDFs.',
    icon: Scissors,
    color: 'bg-orange-500/10 text-orange-500',
    borderColor: 'hover:border-orange-500/30',
    categories: ['organize'],
    keywords: [
      'divide',
      'separate',
      'cut',
      'slice',
      'page range',
      'extract pages',
      'break pdf',
      'burst',
    ],
    priority: 4,
  },
  {
    id: 'organize-pdf',
    path: '/organize-pdf',
    label: 'Page Organizer',
    description: 'Visually reorder, delete, rotate, and duplicate PDF pages.',
    icon: LayoutGrid,
    color: 'bg-cyan-500/10 text-cyan-500',
    borderColor: 'hover:border-cyan-500/30',
    categories: ['organize'],
    keywords: [
      'rotate',
      'reorder',
      'rearrange',
      'sort pages',
      'delete page',
      'remove page',
      'duplicate page',
      'turn',
      'orientation',
    ],
    priority: 5,
  },
  {
    id: 'annotate',
    path: '/annotate',
    label: 'Annotate PDF',
    description: 'Add text, shapes, drawings, highlights, and signatures to your PDFs.',
    icon: Type,
    color: 'bg-pink-500/10 text-pink-500',
    borderColor: 'hover:border-pink-500/30',
    categories: ['edit'],
    keywords: [
      'draw',
      'highlight',
      'markup',
      'mark up',
      'signature',
      'sign',
      'comment',
      'text box',
      'shapes',
      'pen',
      'freehand',
    ],
    priority: 6,
  },
  {
    id: 'page-numbers',
    path: '/page-numbers',
    label: 'Page Numbers',
    description: 'Insert customizable page numbers, headers, and footers with live preview.',
    icon: Hash,
    color: 'bg-emerald-500/10 text-emerald-500',
    borderColor: 'hover:border-emerald-500/30',
    categories: ['organize'],
    keywords: [
      'numbering',
      'pagination',
      'header',
      'footer',
      'page count',
      'bates numbering',
    ],
    priority: 7,
  },
  {
    id: 'watermark',
    path: '/watermark',
    label: 'Add Watermark',
    description: 'Add text or image watermarks with custom position, opacity, and style.',
    icon: Droplets,
    color: 'bg-indigo-500/10 text-indigo-500',
    borderColor: 'hover:border-indigo-500/30',
    categories: ['edit'],
    keywords: [
      'watermark',
      'stamp',
      'brand',
      'confidential',
      'draft',
      'overlay',
      'logo watermark',
    ],
    priority: 8,
  },

  // Conversion tools (9-11)
  {
    id: 'word-to-pdf',
    path: '/word-to-pdf',
    label: 'Word to PDF',
    description: 'Convert DOCX documents to formatted vector PDFs with custom styling.',
    icon: FileType,
    color: 'bg-blue-600/10 text-blue-600',
    borderColor: 'hover:border-blue-600/30',
    categories: ['create-convert'],
    keywords: [
      'docx to pdf',
      'doc to pdf',
      'convert word',
      'microsoft word',
      'word document',
      'office to pdf',
    ],
    priority: 9,
  },
  {
    id: 'pdf-to-word',
    path: '/pdf-to-word',
    label: 'PDF to Word',
    description: 'Convert PDF documents to editable Microsoft Word (.docx) files.',
    icon: FileText,
    color: 'bg-indigo-600/10 text-indigo-600',
    borderColor: 'hover:border-indigo-600/30',
    categories: ['create-convert'],
    keywords: [
      'pdf to docx',
      'pdf to doc',
      'convert word',
      'editable word',
      'microsoft word',
      'docx',
    ],
    priority: 10,
  },
  {
    id: 'pdf-to-excel',
    path: '/pdf-to-excel',
    label: 'PDF to Excel',
    description: 'Extract tables, spreadsheets, and data into Excel (.xlsx) & CSV.',
    icon: FileSpreadsheet,
    color: 'bg-emerald-600/10 text-emerald-600',
    borderColor: 'hover:border-emerald-600/30',
    categories: ['create-convert'],
    keywords: [
      'pdf to xlsx',
      'pdf to csv',
      'spreadsheet',
      'extract table',
      'tables',
      'convert excel',
      'worksheet',
    ],
    priority: 11,
  },

  // Other tools (12-16)
  {
    id: 'image-editor',
    path: '/image-editor',
    label: 'Image Editor',
    description: 'Crop, rotate, flip, and apply filters to your images before conversion.',
    icon: Paintbrush,
    color: 'bg-purple-500/10 text-purple-500',
    borderColor: 'hover:border-purple-500/30',
    categories: ['edit'],
    keywords: [
      'crop image',
      'rotate image',
      'flip image',
      'filters',
      'brightness',
      'contrast',
      'photo editor',
    ],
    priority: 12,
  },
  {
    id: 'protect-pdf',
    path: '/protect-pdf',
    label: 'Protect & Unlock',
    description:
      'Add military-grade AES-256 encryption or remove password protection from PDFs.',
    icon: ShieldCheck,
    color: 'bg-indigo-500/10 text-indigo-500',
    borderColor: 'hover:border-indigo-500/30',
    categories: ['security'],
    keywords: [
      'password',
      'encrypt',
      'decrypt',
      'lock pdf',
      'unlock pdf',
      'security',
      'aes-256',
      'remove password',
      'permissions',
    ],
    priority: 13,
  },
  {
    id: 'pdf-to-images',
    path: '/pdf-to-images',
    label: 'PDF to Images',
    description: 'Convert PDF pages to PNG or JPG images at your chosen resolution.',
    icon: ImageDown,
    color: 'bg-teal-500/10 text-teal-500',
    borderColor: 'hover:border-teal-500/30',
    categories: ['create-convert'],
    keywords: [
      'pdf to jpg',
      'pdf to png',
      'export images',
      'save as image',
      'render pages',
      'snapshots',
    ],
    priority: 14,
  },
  {
    id: 'extract-text',
    path: '/extract-text',
    label: 'Extract Text',
    description: 'Extract clean text and Markdown from PDF pages with real-time search.',
    icon: AlignLeft,
    color: 'bg-sky-500/10 text-sky-500',
    borderColor: 'hover:border-sky-500/30',
    categories: ['intelligence'],
    keywords: [
      'extract text',
      'copy text',
      'read pdf',
      'markdown',
      'plain text',
      'txt',
      'pdf intelligence',
      'ocr text',
    ],
    priority: 15,
  },
  {
    id: 'metadata',
    path: '/metadata',
    label: 'Edit Metadata',
    description: 'Edit document title, author, subject, and keywords.',
    icon: FileText,
    color: 'bg-slate-500/10 text-slate-500',
    borderColor: 'hover:border-slate-500/30',
    categories: ['edit'],
    keywords: [
      'metadata',
      'properties',
      'author',
      'document title',
      'subject',
      'tags',
      'info dictionary',
    ],
    priority: 16,
  },
] as const;

const TOOLS_BY_ID = new Map<string, PdfToolDefinition>(PDF_TOOLS.map((t) => [t.id, t]));
const TOOLS_BY_PATH = new Map<string, PdfToolDefinition>(PDF_TOOLS.map((t) => [t.path, t]));

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchableCorpus(tool: PdfToolDefinition) {
  const normLabel = normalizeSearchText(tool.label);
  const rawLabel = tool.label.toLowerCase();
  const normDesc = normalizeSearchText(tool.description);
  const rawDesc = tool.description.toLowerCase();
  const normKeywords = tool.keywords.map((kw) => normalizeSearchText(kw));
  const rawKeywords = tool.keywords.map((kw) => kw.toLowerCase());
  const normCategories = tool.categories.map((cat) =>
    normalizeSearchText(CATEGORY_LABEL_MAP[cat])
  );
  const normPath = normalizeSearchText(tool.path);

  const combinedNorm = [
    normLabel,
    normDesc,
    ...normKeywords,
    ...normCategories,
    normPath,
  ].join(' ');
  const combinedRaw = [rawLabel, rawDesc, ...rawKeywords, tool.path.toLowerCase()].join(' ');

  return {
    normLabel,
    rawLabel,
    normDesc,
    normKeywords,
    normCategories,
    combinedNorm,
    combinedRaw,
  };
}

const CORPUS_BY_ID = new Map(
  PDF_TOOLS.map((tool) => [tool.id, getSearchableCorpus(tool)] as const)
);

function scoreToolSearch(tool: PdfToolDefinition, rawQuery: string): number {
  const qRaw = rawQuery.trim().toLowerCase();
  const qNorm = normalizeSearchText(rawQuery);

  if (!qRaw && !qNorm) return 1;

  const corpus = CORPUS_BY_ID.get(tool.id);
  if (!corpus) return 0;

  // Match all normalized tokens OR fallback to raw whitespace tokens for hyphenated/dotted queries
  const normTokens = qNorm ? qNorm.split(' ').filter(Boolean) : [];
  const rawTokens = qRaw.split(/\s+/).filter(Boolean);

  const matchesNormTokens =
    normTokens.length > 0 && normTokens.every((tok) => corpus.combinedNorm.includes(tok));
  const matchesRawTokens =
    rawTokens.length > 0 && rawTokens.every((tok) => corpus.combinedRaw.includes(tok));

  if (!matchesNormTokens && !matchesRawTokens) {
    return 0;
  }

  let score = 10;

  if (qNorm) {
    if (corpus.normLabel === qNorm || corpus.rawLabel === qRaw) {
      score += 1000;
    } else if (corpus.normLabel.startsWith(qNorm)) {
      score += 500;
    } else if (corpus.normLabel.includes(qNorm)) {
      score += 320;
    }

    if (corpus.normKeywords.some((kw) => kw === qNorm)) {
      score += 280;
    } else if (corpus.normKeywords.some((kw) => kw.includes(qNorm))) {
      score += 180;
    }

    if (corpus.normDesc.includes(qNorm)) {
      score += 110;
    }

    if (corpus.normCategories.some((cat) => cat.includes(qNorm))) {
      score += 80;
    }

    for (const tok of normTokens) {
      if (corpus.normLabel.includes(tok)) score += 45;
      if (corpus.normKeywords.some((kw) => kw.includes(tok))) score += 25;
    }
  }

  return score;
}

/**
 * Filters and orders PDF tools using centralized registry definitions.
 * Always preserves priority order when no search query is entered.
 */
export function filterPdfTools(options: {
  category?: ToolCategoryId;
  query?: string;
}): PdfToolDefinition[] {
  const category = options.category ?? 'all';
  const query = options.query ?? '';

  const categoryMatches =
    category === 'all'
      ? [...PDF_TOOLS]
      : PDF_TOOLS.filter((tool) => tool.categories.includes(category));

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return categoryMatches;
  }

  const scored: { tool: PdfToolDefinition; score: number }[] = [];
  for (const tool of categoryMatches) {
    const score = scoreToolSearch(tool, trimmedQuery);
    if (score > 0) {
      scored.push({ tool, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tool.priority - b.tool.priority;
  });

  return scored.map((entry) => entry.tool);
}

export function getCategoryLabel(categoryId: ToolCategoryId): string {
  const found = PDF_TOOL_CATEGORIES.find((c) => c.id === categoryId);
  return found ? found.label : 'All Tools';
}

export function getPrimaryCategoryLabel(tool: PdfToolDefinition): string {
  const first = tool.categories[0];
  return first ? CATEGORY_LABEL_MAP[first] : 'Tool';
}

// ==========================================
// RECENTLY USED TOOLS PERSISTENCE (localStorage)
// ==========================================

export const RECENT_TOOLS_STORAGE_KEY = 'pdf_render_recent_tools';
export const MAX_RECENT_TOOLS = 4;
export const RECENT_TOOLS_UPDATED_EVENT = 'pdf-render:recent-tools-updated';

function readStoredRecentToolIds(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(RECENT_TOOLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const validIds: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      if (!TOOLS_BY_ID.has(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      validIds.push(item);
      if (validIds.length >= MAX_RECENT_TOOLS) break;
    }
    return validIds;
  } catch {
    return [];
  }
}

function writeStoredRecentToolIds(ids: string[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(RECENT_TOOLS_STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(RECENT_TOOLS_UPDATED_EVENT));
  } catch {
    // Gracefully ignore private-mode or quota errors
  }
}

export function getRecentTools(): PdfToolDefinition[] {
  const ids = readStoredRecentToolIds();
  return ids
    .map((id) => TOOLS_BY_ID.get(id))
    .filter((tool): tool is PdfToolDefinition => Boolean(tool));
}

export function recordRecentTool(toolId: string): PdfToolDefinition[] {
  if (!TOOLS_BY_ID.has(toolId)) {
    return getRecentTools();
  }
  const existing = readStoredRecentToolIds();
  const next = [toolId, ...existing.filter((id) => id !== toolId)].slice(0, MAX_RECENT_TOOLS);
  writeStoredRecentToolIds(next);
  return getRecentTools();
}

export function resolveToolByRoute(pathname: string, search = ''): PdfToolDefinition | null {
  const cleanPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const direct = TOOLS_BY_PATH.get(cleanPath);
  if (direct) return direct;

  if (cleanPath === '/convert') {
    const params = new URLSearchParams(search);
    const tab = params.get('tab');
    if (tab === 'pdf-to-word') return TOOLS_BY_ID.get('pdf-to-word') ?? null;
    if (tab === 'pdf-to-excel') return TOOLS_BY_ID.get('pdf-to-excel') ?? null;
    return TOOLS_BY_ID.get('word-to-pdf') ?? null;
  }

  return null;
}

export function recordRecentToolFromRoute(pathname: string, search = ''): void {
  const resolved = resolveToolByRoute(pathname, search);
  if (resolved) {
    recordRecentTool(resolved.id);
  }
}

export function clearRecentTools(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(RECENT_TOOLS_STORAGE_KEY);
    window.dispatchEvent(new Event(RECENT_TOOLS_UPDATED_EVENT));
  } catch {
    // ignore storage errors
  }
}
