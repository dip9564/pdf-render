import { Link } from 'react-router-dom';
import {
  FileImage,
  Merge,
  Scissors,
  LayoutGrid,
  ImageDown,
  Droplets,
  Type,
  FileText,
  Paintbrush,
  ArrowRight,
  Shield,
  Zap,
  Lock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const tools = [
  {
    path: '/image-to-pdf',
    label: 'Image to PDF',
    description: 'Convert images to PDF with custom layouts, page sizes, and image editing.',
    icon: FileImage,
    color: 'bg-blue-500/10 text-blue-500',
    borderColor: 'hover:border-blue-500/30',
  },
  {
    path: '/image-editor',
    label: 'Image Editor',
    description: 'Crop, rotate, flip, and apply filters to your images before conversion.',
    icon: Paintbrush,
    color: 'bg-purple-500/10 text-purple-500',
    borderColor: 'hover:border-purple-500/30',
  },
  {
    path: '/merge-pdf',
    label: 'Merge PDF',
    description: 'Combine multiple PDF files into one. Reorder and select specific pages.',
    icon: Merge,
    color: 'bg-green-500/10 text-green-500',
    borderColor: 'hover:border-green-500/30',
  },
  {
    path: '/split-pdf',
    label: 'Split PDF',
    description: 'Extract pages, split by ranges, or separate every page into individual PDFs.',
    icon: Scissors,
    color: 'bg-orange-500/10 text-orange-500',
    borderColor: 'hover:border-orange-500/30',
  },
  {
    path: '/organize-pdf',
    label: 'Page Organizer',
    description: 'Visually reorder, delete, rotate, and duplicate PDF pages.',
    icon: LayoutGrid,
    color: 'bg-cyan-500/10 text-cyan-500',
    borderColor: 'hover:border-cyan-500/30',
  },
  {
    path: '/pdf-to-images',
    label: 'PDF to Images',
    description: 'Convert PDF pages to PNG or JPG images at your chosen resolution.',
    icon: ImageDown,
    color: 'bg-teal-500/10 text-teal-500',
    borderColor: 'hover:border-teal-500/30',
  },
  {
    path: '/watermark',
    label: 'Add Watermark',
    description: 'Add text or image watermarks with custom position, opacity, and style.',
    icon: Droplets,
    color: 'bg-indigo-500/10 text-indigo-500',
    borderColor: 'hover:border-indigo-500/30',
  },
  {
    path: '/annotate',
    label: 'Annotate PDF',
    description: 'Add text, shapes, drawings, highlights, and signatures to your PDFs.',
    icon: Type,
    color: 'bg-pink-500/10 text-pink-500',
    borderColor: 'hover:border-pink-500/30',
  },
  {
    path: '/metadata',
    label: 'Edit Metadata',
    description: 'Edit document title, author, subject, and keywords.',
    icon: FileText,
    color: 'bg-slate-500/10 text-slate-500',
    borderColor: 'hover:border-slate-500/30',
  },
];

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-12">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
          <Zap className="h-3.5 w-3.5" />
          100% Free & Client-Side
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
          All-in-One{' '}
          <span className="text-primary">PDF</span>{' '}
          Editor
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Create, edit, merge, split, compress, and convert PDFs directly in your browser.
          No uploads, no servers — your files never leave your device.
        </p>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Lock className="h-4 w-4 text-green-500" />
            <span>Private & Secure</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-blue-500" />
            <span>No File Uploads</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-500" />
            <span>Instant Processing</span>
          </div>
        </div>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tools.map((tool) => (
          <Link key={tool.path} to={tool.path}>
            <Card className={`h-full transition-all duration-200 hover:shadow-md ${tool.borderColor} group`}>
              <CardContent className="p-5">
                <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${tool.color} mb-3`}>
                  <tool.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold mb-1 flex items-center gap-1">
                  {tool.label}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                </h3>
                <p className="text-sm text-muted-foreground">{tool.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* How It Works */}
      <div className="mt-20 text-center">
        <h2 className="text-2xl font-bold mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold mb-3">
              1
            </div>
            <h3 className="font-semibold mb-1">Choose a Tool</h3>
            <p className="text-sm text-muted-foreground">Select from 11+ PDF tools above</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold mb-3">
              2
            </div>
            <h3 className="font-semibold mb-1">Upload & Edit</h3>
            <p className="text-sm text-muted-foreground">Drag & drop your files and customize</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold mb-3">
              3
            </div>
            <h3 className="font-semibold mb-1">Download</h3>
            <p className="text-sm text-muted-foreground">Get your processed files instantly</p>
          </div>
        </div>
      </div>
    </div>
  );
}
