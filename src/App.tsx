import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { lazy, Suspense, useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { BrandLogo } from '@/components/shared/BrandLogo';

const HomePage = lazy(() => import('@/pages/HomePage'));
const ImageToPdf = lazy(() => import('@/pages/ImageToPdf'));
const ImageEditor = lazy(() => import('@/pages/ImageEditor'));
const MergePdf = lazy(() => import('@/pages/MergePdf'));
const SplitPdf = lazy(() => import('@/pages/SplitPdf'));
const OrganizePdf = lazy(() => import('@/pages/OrganizePdf'));
const PdfToImages = lazy(() => import('@/pages/PdfToImages'));
const Watermark = lazy(() => import('@/pages/Watermark'));
const AnnotatePdf = lazy(() => import('@/pages/AnnotatePdf'));
const MetadataEditor = lazy(() => import('@/pages/MetadataEditor'));
const PageNumbers = lazy(() => import('@/pages/PageNumbers'));
const ProtectPdf = lazy(() => import('@/pages/ProtectPdf'));
const ExtractText = lazy(() => import('@/pages/ExtractText'));
const DocumentConverter = lazy(() => import('@/pages/DocumentConverter'));
const FrontPageGenerator = lazy(() => import('@/pages/FrontPageGenerator'));
const CompressPdf = lazy(() => import('@/pages/CompressPdf'));

function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4"
    >
      <BrandLogo variant="icon" size="lg" />
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Spinner size="sm" className="text-primary" />
        <span>Loading PDF Render...</span>
      </div>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    // When a fresh app session starts (e.g. reopening browser or PWA), guarantee it opens to Home page
    const sessionKey = 'pdf_render_session_active';
    try {
      if (!sessionStorage.getItem(sessionKey)) {
        sessionStorage.setItem(sessionKey, '1');
        if (window.location.pathname !== '/') {
          navigate('/', { replace: true });
        }
      }
    } catch {
      // ignore storage access issues
    }
  }, [navigate]);

  return (
    <Layout>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/image-to-pdf" element={<ImageToPdf />} />
          <Route path="/image-editor" element={<ImageEditor />} />
          <Route path="/merge-pdf" element={<MergePdf />} />
          <Route path="/split-pdf" element={<SplitPdf />} />
          <Route path="/organize-pdf" element={<OrganizePdf />} />
          <Route path="/pdf-to-images" element={<PdfToImages />} />
          <Route path="/watermark" element={<Watermark />} />
          <Route path="/annotate" element={<AnnotatePdf />} />
          <Route path="/metadata" element={<MetadataEditor />} />
          <Route path="/page-numbers" element={<PageNumbers />} />
          <Route path="/protect-pdf" element={<ProtectPdf />} />
          <Route path="/extract-text" element={<ExtractText />} />
          <Route path="/convert" element={<DocumentConverter />} />
          <Route path="/front-page" element={<FrontPageGenerator />} />
          <Route path="/word-to-pdf" element={<DocumentConverter initialTab="word-to-pdf" />} />
          <Route path="/pdf-to-word" element={<DocumentConverter initialTab="pdf-to-word" />} />
          <Route path="/pdf-to-excel" element={<DocumentConverter initialTab="pdf-to-excel" />} />
          <Route path="/rotate-pdf" element={<Navigate to="/organize-pdf" replace />} />
          <Route path="/compress-pdf" element={<CompressPdf />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
