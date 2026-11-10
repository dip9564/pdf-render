import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { lazy, Suspense, useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';

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

function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spinner size="lg" />
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
          <Route path="/rotate-pdf" element={<Navigate to="/organize-pdf" replace />} />
          <Route path="/compress-pdf" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
