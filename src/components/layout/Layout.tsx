import { Link, useLocation } from 'react-router-dom';
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
  Menu,
  X,
  FileUp,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { path: '/image-to-pdf', label: 'Image to PDF', icon: FileImage, color: 'text-blue-500' },
  { path: '/image-editor', label: 'Image Editor', icon: Paintbrush, color: 'text-purple-500' },
  { path: '/merge-pdf', label: 'Merge PDF', icon: Merge, color: 'text-green-500' },
  { path: '/split-pdf', label: 'Split PDF', icon: Scissors, color: 'text-orange-500' },
  { path: '/organize-pdf', label: 'Page Organizer', icon: LayoutGrid, color: 'text-cyan-500' },
  { path: '/pdf-to-images', label: 'PDF to Images', icon: ImageDown, color: 'text-teal-500' },
  { path: '/watermark', label: 'Watermark', icon: Droplets, color: 'text-indigo-500' },
  { path: '/annotate', label: 'Annotate PDF', icon: Type, color: 'text-pink-500' },
  { path: '/metadata', label: 'Metadata', icon: FileText, color: 'text-slate-500' },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        <Link to="/" className="flex items-center gap-2 mr-6">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
            <FileUp className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg hidden sm:inline-block">PDF Render</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1 flex-1 overflow-x-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                location.pathname === item.path
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Mobile Menu Button */}
        <div className="lg:hidden ml-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t bg-background">
          <nav className="container mx-auto px-4 py-3 grid grid-cols-2 gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  location.pathname === item.path
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <item.icon className={cn('h-4 w-4', item.color)} />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t py-6 mt-auto">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} PDF Render. All processing happens in your browser.
        </p>
        <p className="text-xs text-muted-foreground">
          Your files never leave your device. 100% client-side processing.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
