import createQpdfModule from '@neslinesli93/qpdf-wasm';
import qpdfWasmAssetUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

/**
 * Full Emscripten FS & Module surface exposed by `@neslinesli93/qpdf-wasm` at runtime
 * (extends the package's minimal bundled `.d.ts` definitions cleanly).
 */
interface QpdfEmscriptenFS {
  unlink: (path: string) => void;
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string, opts?: { encoding?: 'binary' | 'utf8' }) => Uint8Array | string;
}

interface ExtendedQpdfInstance {
  callMain: (args: string[]) => number;
  FS: QpdfEmscriptenFS;
}

interface ExtendedQpdfModuleOptions {
  locateFile: (path?: string) => string;
  noInitialRun?: boolean;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

export interface QpdfJsonImageEntry {
  object: string;
  name: string;
  width: number;
  height: number;
  bitspercomponent: number;
  colorspace: unknown;
  filter: unknown;
  decodeparms?: unknown;
  filterable?: boolean;
}

export interface QpdfJsonPageEntry {
  pageposfrom1: number;
  object: string;
  contents: string[];
  images: QpdfJsonImageEntry[];
  outlines: unknown[];
  label: string | null;
}

export interface QpdfJsonEncryptInfo {
  encrypted: boolean;
  userpasswordmatched?: boolean;
  ownerpasswordmatched?: boolean;
  recovereduserpassword?: string | null;
  parameters?: {
    method?: string;
    bits?: number;
    V?: number;
    R?: number;
    P?: number;
  };
}

export interface QpdfJsonObjectEntry {
  value?: Record<string, unknown>;
  stream?: {
    dict: Record<string, unknown>;
    data?: string;
    datafile?: string;
  };
}

export interface QpdfJsonDocument {
  version: number;
  pages: QpdfJsonPageEntry[];
  pagelabels: unknown[];
  acroform: {
    hasacroform: boolean;
    fields: unknown[];
    needappearances: boolean;
  };
  attachments: Record<string, unknown>;
  encrypt: QpdfJsonEncryptInfo;
  outlines: unknown[];
  qpdf: [
    {
      jsonversion: number;
      pdfversion: string;
      pushedinheritedpageresources?: boolean;
      calledgetallpages?: boolean;
      maxobjectid: number;
    },
    Record<string, QpdfJsonObjectEntry>,
  ];
}

export interface QpdfInspectResult {
  json: QpdfJsonDocument;
  /** Extracted raw/encoded stream bytes keyed by object id string e.g. "4 0 R" -> bytes */
  streams: Map<string, Uint8Array>;
  exitCode: number;
}

export interface QpdfJsonPatchObject {
  value?: unknown;
  stream?: {
    dict: Record<string, unknown>;
    datafile?: string;
  };
}

export interface QpdfJsonPatchDocument {
  qpdf: [
    { jsonversion: 2 },
    Record<string, QpdfJsonPatchObject>,
  ];
}

let customWasmUrl: string | null = null;

export function setCustomQpdfWasmUrl(url: string | null): void {
  customWasmUrl = url;
}

function resolveQpdfWasmUrl(): string {
  if (customWasmUrl) return customWasmUrl;
  const globalOverride = (globalThis as Record<string, unknown>).__QPDF_WASM_PATH__;
  if (typeof globalOverride === 'string' && globalOverride.length > 0) {
    return globalOverride;
  }
  return qpdfWasmAssetUrl;
}

async function createIsolatedQpdf(
  captureLogs = false
): Promise<{ qpdf: ExtendedQpdfInstance; logs: string[]; errs: string[] }> {
  const logs: string[] = [];
  const errs: string[] = [];
  const wasmUrl = resolveQpdfWasmUrl();

  const rawModule = createQpdfModule as unknown as
    | ((opts: ExtendedQpdfModuleOptions) => Promise<ExtendedQpdfInstance>)
    | { default?: (opts: ExtendedQpdfModuleOptions) => Promise<ExtendedQpdfInstance> };
  const factory = typeof rawModule === 'function' ? rawModule : rawModule?.default;
  if (typeof factory !== 'function') {
    throw new Error('QPDF WASM module did not export a callable factory.');
  }

  const qpdf = await factory({
    noInitialRun: true,
    locateFile: (filePath = '') => {
      if (!filePath || filePath.endsWith('.wasm')) return wasmUrl;
      return filePath;
    },
    print: captureLogs ? (line: string) => logs.push(line) : () => {},
    printErr: captureLogs ? (line: string) => errs.push(line) : () => {},
  });

  return { qpdf, logs, errs };
}

function safeCallMain(qpdf: ExtendedQpdfInstance, args: string[]): number {
  const copy = [...args];
  let rc = 0;
  try {
    rc = qpdf.callMain(copy);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      rc = (err as { status: number }).status;
    } else {
      throw err;
    }
  } finally {
    // Emscripten NODE_ENV sets process.exitCode on exit; reset so Node callers don't fail on benign QPDF exit codes 2/3.
    const proc = (globalThis as { process?: { exitCode?: number } }).process;
    if (proc && typeof proc === 'object' && 'exitCode' in proc) {
      proc.exitCode = undefined;
    }
  }
  return rc;
}

function safeUnlink(qpdf: ExtendedQpdfInstance, filePath: string): void {
  try {
    qpdf.FS.unlink(filePath);
  } catch {
    // ignore cleanup failures
  }
}

function objectKeyToId(key: string): string | null {
  if (!key.startsWith('obj:')) return null;
  const rest = key.slice(4); // e.g. "4 0 R"
  const spaceIdx = rest.indexOf(' ');
  return spaceIdx > 0 ? rest.slice(0, spaceIdx) : null;
}

/**
 * Inspect PDF structure using QPDF JSON v2. Optionally extracts decoded content/form streams
 * and encoded/raw image/mask streams from Emscripten FS without leaking memory.
 */
export async function inspectPdfWithQpdf(
  pdfBytes: Uint8Array,
  options: {
    password?: string;
    extractObjectStreams?: (objRef: string, entry: QpdfJsonObjectEntry) => boolean;
    decodeLevel?: 'none' | 'generalized';
  } = {}
): Promise<QpdfInspectResult> {
  const { qpdf } = await createIsolatedQpdf(false);
  const inputPath = '/in.pdf';
  const jsonPath = '/doc.json';
  const streamPrefix = '/st';
  const streams = new Map<string, Uint8Array>();

  qpdf.FS.writeFile(inputPath, pdfBytes);

  const wantStreams = Boolean(options.extractObjectStreams);
  const args: string[] = [];
  if (options.password !== undefined) {
    args.push(`--password=${options.password}`);
  }
  args.push('--json');
  if (wantStreams) {
    // Decode level controls whether QPDF decodes compressed streams into /st-<id> files.
    // Using decodeLevel='none' keeps native /DCTDecode /FlateDecode bytes intact while still letting us inspect content/image streams!
    args.push(`--decode-level=${options.decodeLevel ?? 'none'}`);
    args.push('--json-stream-data=file');
    args.push(`--json-stream-prefix=${streamPrefix}`);
  }
  args.push(inputPath, jsonPath);

  const rc = safeCallMain(qpdf, args);
  if (rc === 2) {
    safeUnlink(qpdf, inputPath);
    throw new Error('QPDF_INSPECT_FAILED_OR_NEEDS_PASSWORD');
  }

  const rawJson = qpdf.FS.readFile(jsonPath, { encoding: 'utf8' }) as string;
  const parsed = JSON.parse(rawJson) as QpdfJsonDocument;

  if (wantStreams && options.extractObjectStreams) {
    const objs = parsed.qpdf[1];
    for (const [key, entry] of Object.entries(objs)) {
      if (!entry?.stream || !key.startsWith('obj:')) continue;
      const objRef = key.slice(4); // "4 0 R"
      if (!options.extractObjectStreams(objRef, entry)) continue;
      const idPart = objectKeyToId(key);
      if (!idPart) continue;
      const stFile = `${streamPrefix}-${idPart}`;
      try {
        const fileData = qpdf.FS.readFile(stFile) as Uint8Array;
        // Copy out before Emscripten instance is GC'd
        streams.set(objRef, new Uint8Array(fileData));
      } catch {
        // stream file might not exist for empty stream
      }
    }
  }

  return { json: parsed, streams, exitCode: rc };
}

/**
 * Extract specific streams from PDF at a given decodeLevel ('none' for raw encoded JPEG/CCITT,
 * 'generalized' for decompressed Flate/content streams!).
 */
export async function extractSpecificStreamsWithQpdf(
  pdfBytes: Uint8Array,
  targetObjectRefs: Set<string>,
  decodeLevel: 'none' | 'generalized',
  password?: string
): Promise<Map<string, Uint8Array>> {
  if (targetObjectRefs.size === 0) return new Map();
  const res = await inspectPdfWithQpdf(pdfBytes, {
    password,
    decodeLevel,
    extractObjectStreams: (ref) => targetObjectRefs.has(ref),
  });
  return res.streams;
}

/**
 * Decrypt a password-protected or owner-restricted PDF using QPDF WASM.
 */
export async function decryptPdfWithQpdf(
  pdfBytes: Uint8Array,
  password?: string
): Promise<Uint8Array> {
  const { qpdf } = await createIsolatedQpdf(false);
  qpdf.FS.writeFile('/in.pdf', pdfBytes);
  const args: string[] = [];
  if (password !== undefined) {
    args.push(`--password=${password}`);
  }
  args.push('--decrypt', '/in.pdf', '/out.pdf');

  const rc = safeCallMain(qpdf, args);
  if (rc === 2) {
    throw new Error('QPDF_DECRYPT_FAILED');
  }
  return new Uint8Array(qpdf.FS.readFile('/out.pdf') as Uint8Array);
}

/**
 * Encrypt PDF with 256-bit AES using QPDF WASM.
 */
export async function encryptPdfAes256WithQpdf(
  pdfBytes: Uint8Array,
  userPassword: string,
  ownerPassword?: string
): Promise<Uint8Array> {
  const { qpdf } = await createIsolatedQpdf(false);
  qpdf.FS.writeFile('/in.pdf', pdfBytes);
  const owner = ownerPassword && ownerPassword.length > 0 ? ownerPassword : userPassword;
  const rc = safeCallMain(qpdf, [
    '--encrypt',
    `--user-password=${userPassword}`,
    `--owner-password=${owner}`,
    '--bits=256',
    '--',
    '/in.pdf',
    '/out.pdf',
  ]);
  if (rc === 2) {
    throw new Error('QPDF_ENCRYPT_FAILED');
  }
  return new Uint8Array(qpdf.FS.readFile('/out.pdf') as Uint8Array);
}

/**
 * Externalize large inline images (BI..ID..EI inside page content streams) into XObjects
 * and repair broken xref structures cleanly before image analysis/optimization.
 */
export async function normalizeAndExternalizeWithQpdf(
  pdfBytes: Uint8Array,
  options: { password?: string; minInlineBytes?: number } = {}
): Promise<Uint8Array> {
  const { qpdf } = await createIsolatedQpdf(false);
  qpdf.FS.writeFile('/in.pdf', pdfBytes);
  const args: string[] = [];
  if (options.password !== undefined) {
    args.push(`--password=${options.password}`);
  }
  args.push(
    '--externalize-inline-images',
    `--ii-min-bytes=${options.minInlineBytes ?? 256}`,
    '/in.pdf',
    '/out.pdf'
  );
  const rc = safeCallMain(qpdf, args);
  if (rc === 2) {
    throw new Error('QPDF_NORMALIZE_FAILED');
  }
  return new Uint8Array(qpdf.FS.readFile('/out.pdf') as Uint8Array);
}

export interface QpdfOptimizePatchOptions {
  patch?: QpdfJsonPatchDocument | null;
  mountedFiles?: Map<string, Uint8Array>;
  removeUnusedResources?: boolean;
  recompressStreams?: boolean;
  compressionLevel?: number;
  generateObjectStreams?: boolean;
  linearize?: boolean;
  coalesceContents?: boolean;
  removeMetadata?: boolean;
  password?: string;
}

/**
 * Apply image XObject / deduplication patches + QPDF structural optimization pass:
 * - Unreferenced resource removal
 * - High-efficiency Flate level-9 recompression
 * - Compressed Object Streams (/ObjStm) & XRef stream generation
 * - Metadata, bookmarks, links, forms, annotations, attachments preserved by default!
 */
export async function patchAndOptimizeWithQpdf(
  pdfBytes: Uint8Array,
  options: QpdfOptimizePatchOptions
): Promise<Uint8Array> {
  const { qpdf } = await createIsolatedQpdf(false);
  qpdf.FS.writeFile('/in.pdf', pdfBytes);

  if (options.mountedFiles) {
    for (const [filePath, data] of options.mountedFiles.entries()) {
      qpdf.FS.writeFile(filePath, data);
    }
  }

  const args: string[] = [];
  if (options.password !== undefined) {
    args.push(`--password=${options.password}`);
  }

  if (options.patch && Object.keys(options.patch.qpdf[1]).length > 0) {
    qpdf.FS.writeFile('/patch.json', JSON.stringify(options.patch));
    args.push('--update-from-json=/patch.json');
  }

  if (options.removeUnusedResources !== false) {
    args.push('--remove-unreferenced-resources=yes');
  }
  if (options.recompressStreams !== false) {
    args.push('--compress-streams=y');
    args.push('--recompress-flate');
    args.push(`--compression-level=${options.compressionLevel ?? 9}`);
  }
  if (options.coalesceContents) {
    args.push('--coalesce-contents');
  }
  if (options.generateObjectStreams !== false) {
    args.push('--object-streams=generate');
  }
  if (options.linearize) {
    args.push('--linearize');
  }
  if (options.removeMetadata) {
    args.push('--remove-metadata');
    args.push('--remove-info');
  }

  args.push('/in.pdf', '/out.pdf');

  const rc = safeCallMain(qpdf, args);
  if (rc === 2) {
    throw new Error('QPDF_OPTIMIZE_FAILED');
  }
  return new Uint8Array(qpdf.FS.readFile('/out.pdf') as Uint8Array);
}

/**
 * Run QPDF structural integrity check (`--check`). Returns true if valid (exit 0 or 3 warnings).
 */
export async function checkPdfIntegrityWithQpdf(
  pdfBytes: Uint8Array,
  password?: string
): Promise<{ valid: boolean; exitCode: number }> {
  const { qpdf } = await createIsolatedQpdf(false);
  qpdf.FS.writeFile('/check.pdf', pdfBytes);
  const args: string[] = [];
  if (password !== undefined) {
    args.push(`--password=${password}`);
  }
  args.push('--check', '/check.pdf');
  const rc = safeCallMain(qpdf, args);
  return { valid: rc === 0 || rc === 3, exitCode: rc };
}
