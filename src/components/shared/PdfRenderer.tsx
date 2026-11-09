import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export function usePdfRenderer() {
  const renderPage = useCallback(
    async (
      pdfData: ArrayBuffer | Uint8Array,
      pageNum: number,
      scale: number = 1.5
    ): Promise<string> => {
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      pdf.destroy();
      return dataUrl;
    },
    []
  );

  const renderAllPages = useCallback(
    async (
      pdfData: ArrayBuffer | Uint8Array,
      scale: number = 1.0
    ): Promise<string[]> => {
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const pages: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;
        pages.push(canvas.toDataURL('image/png'));
      }

      pdf.destroy();
      return pages;
    },
    []
  );

  const getPageCount = useCallback(
    async (pdfData: ArrayBuffer | Uint8Array): Promise<number> => {
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const count = pdf.numPages;
      pdf.destroy();
      return count;
    },
    []
  );

  return { renderPage, renderAllPages, getPageCount };
}

interface PdfThumbnailProps {
  pdfData: ArrayBuffer | Uint8Array;
  pageNumber: number;
  scale?: number;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
}

export function PdfThumbnail({
  pdfData,
  pageNumber,
  scale = 0.5,
  className,
  onClick,
  selected,
}: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const renderingRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || renderingRef.current) return;
    renderingRef.current = true;
    setLoading(true);

    const render = async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;
        pdf.destroy();
      } catch (err) {
        console.error('Failed to render PDF thumbnail:', err);
      } finally {
        setLoading(false);
        renderingRef.current = false;
      }
    };

    render();
  }, [pdfData, pageNumber, scale]);

  return (
    <div
      className={`relative cursor-pointer rounded-md overflow-hidden page-shadow transition-all ${
        selected ? 'ring-2 ring-primary ring-offset-2' : 'hover:ring-2 hover:ring-primary/50'
      } ${className || ''}`}
      onClick={onClick}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      <canvas ref={canvasRef} className="w-full h-auto" />
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs text-center py-0.5">
        Page {pageNumber}
      </div>
    </div>
  );
}
