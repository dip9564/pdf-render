import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { lazy, Suspense } from 'react';
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

function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spinner size="lg" />
    </div>
  );
}

export default function App() {
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
          <Route path="/rotate-pdf" element={<Navigate to="/organize-pdf" replace />} />
          <Route path="/compress-pdf" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
