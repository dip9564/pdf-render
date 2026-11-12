import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist', '@neslinesli93/qpdf-wasm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-lib': ['pdf-lib'],
          'pdfjs': ['pdfjs-dist'],
          'fabric': ['fabric'],
          'tesseract': ['tesseract.js'],
          'docx': ['docx'],
          'xlsx': ['xlsx'],
          'mammoth': ['mammoth'],
        },
      },
    },
  },
});
