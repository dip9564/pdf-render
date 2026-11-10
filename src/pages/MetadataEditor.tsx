import { useState, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import { toast } from 'sonner';
import {
  FileText,
  Download,
  Loader2,
  RefreshCw,
  Save,
  Calendar,
  User,
  Tag,
  BookOpen,
  Info,
} from 'lucide-react';
import { formatFileSize, readFileAsArrayBuffer, downloadBlob, createPdfBlob } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileUploader } from '@/components/shared/FileUploader';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';

interface MetadataState {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string;
  modificationDate: string;
}

export default function MetadataEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const [metadata, setMetadata] = useState<MetadataState>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: '',
    producer: '',
    creationDate: '',
    modificationDate: '',
  });

  const { getPageCount } = usePdfRenderer();

  const handleFileSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const selectedFile = files[0];
      setFile(selectedFile);
      setLoading(true);

      try {
        const buffer = await readFileAsArrayBuffer(selectedFile);
        setPdfData(buffer);
        const count = await getPageCount(new Uint8Array(buffer.slice(0)));
        setPageCount(count);

        const pdfDoc = await PDFDocument.load(buffer);

        const title = pdfDoc.getTitle() || '';
        const author = pdfDoc.getAuthor() || '';
        const subject = pdfDoc.getSubject() || '';
        const keywords = pdfDoc.getKeywords() || '';
        const creator = pdfDoc.getCreator() || 'Unknown';
        const producer = pdfDoc.getProducer() || 'Unknown';
        const creationDate = pdfDoc.getCreationDate()?.toLocaleString() || 'Unknown';
        const modificationDate = pdfDoc.getModificationDate()?.toLocaleString() || 'Unknown';

        setMetadata({
          title,
          author,
          subject,
          keywords,
          creator,
          producer,
          creationDate,
          modificationDate,
        });

        toast.success(`Metadata loaded for "${selectedFile.name}"`);
      } catch (err) {
        console.error('Failed to load PDF metadata', err);
        toast.error('Failed to parse PDF metadata');
        setFile(null);
        setPdfData(null);
      } finally {
        setLoading(false);
      }
    },
    [getPageCount]
  );

  const handleSaveMetadata = async () => {
    if (!pdfData || !file) return;

    setSaving(true);
    try {
      const pdfDoc = await PDFDocument.load(pdfData);

      pdfDoc.setTitle(metadata.title);
      pdfDoc.setAuthor(metadata.author);
      pdfDoc.setSubject(metadata.subject);

      const kwArray = metadata.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      pdfDoc.setKeywords(kwArray);
      pdfDoc.setModificationDate(new Date());

      const pdfBytes = await pdfDoc.save();
      const blob = createPdfBlob(pdfBytes);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}-updated-meta.pdf`);
      toast.success('PDF with updated metadata downloaded successfully!');
    } catch (err) {
      console.error('Failed to save metadata', err);
      toast.error('Failed to update metadata');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfData(null);
    setMetadata({
      title: '',
      author: '',
      subject: '',
      keywords: '',
      creator: '',
      producer: '',
      creationDate: '',
      modificationDate: '',
    });
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <FileText className="h-8 w-8 text-slate-600" />
          PDF Metadata Editor
        </h1>
        <p className="text-muted-foreground mt-1">
          View and edit document properties such as Title, Author, Subject, Keywords, and inspect creation info.
        </p>
      </div>

      {!file ? (
        <Card className="border-dashed">
          <CardContent className="p-8">
            <FileUploader
              accept=".pdf,application/pdf"
              multiple={false}
              onFilesSelected={handleFileSelected}
              label="Select or drop a PDF file to edit metadata"
              description="Inspect and update document properties"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* File summary */}
          <Card>
            <CardContent className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-500/10 text-slate-700 flex items-center justify-center font-bold shrink-0">
                  PDF
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm sm:text-base truncate">
                    {file.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <Badge variant="secondary" className="text-xs">
                      {pageCount} {pageCount === 1 ? 'Page' : 'Pages'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleReset} disabled={loading || saving} className="w-full sm:w-auto text-xs">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Choose Another File
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Form */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Editable Fields (2 cols) */}
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Document Properties
                  </CardTitle>
                  <CardDescription>
                    Update the core searchable and indexable attributes of your PDF file.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="meta-title" className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Title
                    </Label>
                    <Input
                      id="meta-title"
                      placeholder="e.g. Annual Financial Report 2026"
                      value={metadata.title}
                      onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="meta-author" className="flex items-center gap-1.5">
                      <User className="h-4 w-4 text-muted-foreground" />
                      Author
                    </Label>
                    <Input
                      id="meta-author"
                      placeholder="e.g. Jane Doe or Organization Name"
                      value={metadata.author}
                      onChange={(e) => setMetadata({ ...metadata, author: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="meta-subject" className="flex items-center gap-1.5">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      Subject
                    </Label>
                    <Input
                      id="meta-subject"
                      placeholder="e.g. Q4 Business Performance Analysis"
                      value={metadata.subject}
                      onChange={(e) => setMetadata({ ...metadata, subject: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="meta-keywords" className="flex items-center gap-1.5">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      Keywords (comma separated)
                    </Label>
                    <Textarea
                      id="meta-keywords"
                      placeholder="e.g. finance, quarterly report, summary, 2026"
                      value={metadata.keywords}
                      onChange={(e) => setMetadata({ ...metadata, keywords: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={handleSaveMetadata}
                      disabled={saving}
                      className="w-full sm:w-auto"
                      size="lg"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Save & Download PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Read-only Information (1 col) */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    File Diagnostics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">Application Creator</span>
                    <span className="font-medium text-foreground break-all">
                      {metadata.creator || 'Not specified'}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block">PDF Producer</span>
                    <span className="font-medium text-foreground break-all">
                      {metadata.producer || 'Not specified'}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block">Creation Date</span>
                    <span className="font-medium text-foreground">
                      {metadata.creationDate || 'Unknown'}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block">Last Modified</span>
                    <span className="font-medium text-foreground">
                      {metadata.modificationDate || 'Unknown'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
