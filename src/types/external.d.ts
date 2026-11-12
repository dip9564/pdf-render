declare module '@neslinesli93/qpdf-wasm' {
  export interface EmscriptenFS {
    mkdir: (path: string) => void;
    rmdir: (path: string) => void;
    unlink: (path: string) => void;
    readdir: (path: string) => string[];
    stat: (path: string) => { mode: number; size: number };
    isDir: (mode: number) => boolean;
    writeFile: (path: string, data: Uint8Array | string) => void;
    readFile: (path: string, opts?: { encoding?: 'binary' | 'utf8' }) => Uint8Array | string;
  }

  export interface QpdfModuleOptions {
    locateFile?: (path: string, prefix?: string) => string;
    noInitialRun?: boolean;
    preRun?: Array<(module: QpdfInstance) => void>;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }

  export interface QpdfInstance {
    callMain: (args: string[]) => number;
    FS: EmscriptenFS;
    WORKERFS: unknown;
  }

  type QpdfModuleFactory = (options?: QpdfModuleOptions) => Promise<QpdfInstance>;
  const createQpdfModule: QpdfModuleFactory;
  export default createQpdfModule;
}

declare module '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}

declare module 'pako' {
  export interface DeflateOptions {
    level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    windowBits?: number;
    memLevel?: number;
    strategy?: number;
    raw?: boolean;
  }

  export function deflate(data: Uint8Array | string, options?: DeflateOptions): Uint8Array;
  export function inflate(data: Uint8Array): Uint8Array;
  const pakoDefault: {
    deflate: typeof deflate;
    inflate: typeof inflate;
  };
  export default pakoDefault;
}

declare module 'pdfjs-dist/build/pdf.worker.js' {
  export const WorkerMessageHandler: unknown;
  export const WorkerTask: unknown;
}

declare module 'pdfjs-dist/build/pdf.worker.min.js' {
  export const WorkerMessageHandler: unknown;
  export const WorkerTask: unknown;
}
