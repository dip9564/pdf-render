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
  Moon,
  Sun,
} from 'lucide-react';
import { useState, useEffect } from 'react';
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
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('pdf_render_theme');
      return saved === 'light' ? 'light' : 'dark'; // default is dark!
    } catch {
      return 'dark';
    }
  });

  const location = useLocation();

  // Close mobile drawer whenever route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Sync theme with <html> class and localStorage
  useEffect(() => {
    try {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('pdf_render_theme', theme);
    } catch (e) {
      console.error(e);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-3 sm:px-4">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground shadow-sm">
            <FileUp className="h-4 w-4" />
          </div>
          <span className="font-bold text-base sm:text-lg">PDF Render</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden xl:flex items-center gap-1 overflow-x-auto ml-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                location.pathname === item.path
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right side controls: Theme toggle & Mobile menu */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Theme Toggle Button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground touch-manipulation"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Dark / Light Mode"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </Button>

          {/* Mobile Menu Button */}
          <div className="xl:hidden flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 touch-manipulation"
              aria-label="Toggle Navigation Menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Horizontal Quick-Scroll Tabs (visible on mobile / tablet) */}
      <div className="xl:hidden border-t bg-muted/30 px-2 py-1.5 overflow-x-auto scrollbar-none flex items-center gap-1.5 text-xs">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-full whitespace-nowrap text-xs font-medium shrink-0 transition-all touch-manipulation',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-background border text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className="h-3 w-3" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Mobile Drawer (When hamburger is opened) */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-t bg-background shadow-lg">
          <nav className="container mx-auto px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors touch-manipulation min-h-[44px]',
                  location.pathname === item.path
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted'
                )}
              >
                <div className={cn('p-1.5 rounded-md bg-muted/60', item.color)}>
                  <item.icon className="h-4 w-4" />
                </div>
                <span>{item.label}</span>
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
    <footer className="border-t py-6 mt-auto bg-muted/20">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
          <span>© {new Date().getFullYear()} <strong className="font-semibold text-foreground">PDF Render</strong></span>
          <span className="hidden sm:inline text-muted-foreground/40">•</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted border text-foreground/80">
            v1.2.0
          </span>
          <span className="hidden sm:inline text-muted-foreground/40">•</span>
          <span>100% Client-Side & Private</span>
        </div>
        <p className="text-xs">
          Developed by <span className="font-semibold text-foreground">Dip Mondal</span>
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
      <Footer />
    </div>
  );
}
