import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

export type WorkflowSourceTool = 'front-page';
export type WorkflowTargetTool = 'page-numbers';

export interface TransferredPdfDocument {
  id: string;
  source: WorkflowSourceTool;
  target: WorkflowTargetTool;
  /** Real in-memory File preserving exact binary PDF bytes, name, and MIME type */
  file: File;
  fileName: string;
  mimeType: string;
  pageCount: number;
  originalPageCount: number;
  createdAt: number;
}

export interface SetTransferredPdfInput {
  source: WorkflowSourceTool;
  target: WorkflowTargetTool;
  file: File;
  pageCount: number;
  originalPageCount: number;
}

interface PdfWorkflowTransferContextValue {
  transferredPdf: TransferredPdfDocument | null;
  setTransferredPdf: (input: SetTransferredPdfInput) => TransferredPdfDocument;
  clearTransferredPdf: (matchingId?: string) => void;
}

const PdfWorkflowTransferContext = createContext<PdfWorkflowTransferContextValue | null>(null);

export function PdfWorkflowTransferProvider({ children }: { children: React.ReactNode }) {
  const [transferredPdf, setTransferredPdfState] = useState<TransferredPdfDocument | null>(null);
  const location = useLocation();
  const sequenceRef = useRef<number>(0);

  const setTransferredPdf = useCallback((input: SetTransferredPdfInput): TransferredPdfDocument => {
    sequenceRef.current += 1;
    const entry: TransferredPdfDocument = {
      id: `wf-pdf-${Date.now()}-${sequenceRef.current}`,
      source: input.source,
      target: input.target,
      file: input.file,
      fileName: input.file.name,
      mimeType: input.file.type || 'application/pdf',
      pageCount: input.pageCount,
      originalPageCount: input.originalPageCount,
      createdAt: Date.now(),
    };
    setTransferredPdfState(entry);
    return entry;
  }, []);

  const clearTransferredPdf = useCallback((matchingId?: string) => {
    setTransferredPdfState((prev) => {
      if (!prev) return null;
      if (matchingId && prev.id !== matchingId) return prev;
      return null;
    });
  }, []);

  // Automatically release transferred bytes once the user navigates outside the workflow routes
  useEffect(() => {
    if (!transferredPdf) return;
    const isWorkflowRoute =
      location.pathname === '/front-page' || location.pathname === '/page-numbers';
    if (!isWorkflowRoute) {
      setTransferredPdfState(null);
    }
  }, [location.pathname, transferredPdf]);

  return (
    <PdfWorkflowTransferContext.Provider
      value={{
        transferredPdf,
        setTransferredPdf,
        clearTransferredPdf,
      }}
    >
      {children}
    </PdfWorkflowTransferContext.Provider>
  );
}

export function usePdfWorkflowTransfer(): PdfWorkflowTransferContextValue {
  const ctx = useContext(PdfWorkflowTransferContext);
  if (!ctx) {
    throw new Error('usePdfWorkflowTransfer must be used within a PdfWorkflowTransferProvider');
  }
  return ctx;
}
