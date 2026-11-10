declare module 'pdf-lib-encrypt' {
  export function configure(pdfLib: any): void;
  export function lock(
    plainBytes: Uint8Array | ArrayBuffer,
    password: string,
    opts?: { algo?: 'aes256' | 'rc4'; permissions?: number }
  ): Promise<Uint8Array>;
  export function unlockInPlace(doc: any, password: string): Promise<boolean>;
}
