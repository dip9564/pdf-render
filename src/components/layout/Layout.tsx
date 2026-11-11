import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Toaster } from 'sonner';
import {
  ArrowRightLeft,
  ChevronDown,
  GraduationCap,
  Home,
  LayoutGrid,
  Menu,
  Merge,
  Moon,
  Scissors,
  Sun,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { WaveBackground } from '@/components/layout/WaveBackground';
import { BrandLogo } from '@/components/shared/BrandLogo';
import {
  PDF_TOOLS,
  PDF_TOOL_CATEGORIES,
  recordRecentToolFromRoute,
} from '@/lib/toolsRegistry';

const PRIMARY_LINKS = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/front-page', label: 'Front Page', icon: GraduationCap },
  { path: '/merge-pdf', label: 'Merge PDF', icon: Merge },
  { path: '/split-pdf', label: 'Split PDF', icon: Scissors },
  { path: '/convert', label: 'Convert', icon: ArrowRightLeft },
] as const;

const DRAWER_SECTIONS = PDF_TOOL_CATEGORIES.filter((c) => c.id !== 'all').map((category) => ({
  ...category,
  tools: PDF_TOOLS.filter((tool) => tool.categories[0] === category.id),
}));

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('pdf_render_theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  });

  const location = useLocation();
  const navigate = useNavigate();

  // Keep theme synced across tabs/windows if storage changes externally
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'pdf_render_theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Close menus whenever route changes and record tool usage
  useEffect(() => {
    setMobileMenuOpen(false);
    setToolsDropdownOpen(false);
    recordRecentToolFromRoute(location.pathname, location.search);
  }, [location.pathname, location.search]);

  // Sync theme with <html>, color-scheme, root background & localStorage
  useEffect(() => {
    try {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
        root.style.backgroundColor = '#0B0D18';
      } else {
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
        root.style.backgroundColor = '#F5F1EA';
      }
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', theme === 'dark' ? '#10121F' : '#4F46E5');
      }
      localStorage.setItem('pdf_render_theme', theme);
    } catch (e) {
      console.error(e);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const isItemActive = (path: string) => {
    if (path === '/convert') {
      return (
        location.pathname === '/convert' ||
        location.pathname === '/word-to-pdf' ||
        location.pathname === '/pdf-to-word' ||
        location.pathname === '/pdf-to-excel'
      );
    }
    return location.pathname === path;
  };

  const isToolsRoute = location.pathname !== '/';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-header/90 backdrop-blur-md supports-[backdrop-filter]:bg-header/80">
      <div className="container mx-auto max-w-7xl flex h-14 sm:h-[60px] items-center justify-between gap-4 px-3.5 sm:px-6">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-5 lg:gap-7 min-w-0">
          <Link
            to="/"
            className="inline-flex items-center shrink-0 rounded-lg py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-header"
          >
            <BrandLogo variant="full" size="md" />
          </Link>

          {/* Desktop Navigation — Flat architectural links, NOT rounded pills */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-1 lg:gap-1.5"
          >
            <Link
              to="/"
              className={cn(
                'relative h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-[13px] font-medium leading-none transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isItemActive('/')
                  ? 'text-primary font-semibold bg-primary/[0.09]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
              )}
            >
              <Home className="h-3.5 w-3.5 shrink-0" />
              <span>Home</span>
            </Link>

            {/* Grouped All-Tools Dropdown */}
            <DropdownMenu.Root open={toolsDropdownOpen} onOpenChange={setToolsDropdownOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Browse all PDF tools"
                  className={cn(
                    'h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-[13px] font-medium leading-none transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isToolsRoute || toolsDropdownOpen
                      ? 'text-primary font-semibold bg-primary/[0.09]'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                  <span>Tools</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-150 opacity-70',
                      toolsDropdownOpen && 'rotate-180'
                    )}
                  />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={8}
                  className="z-50 w-[580px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                  <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-border/80">
                    <span className="text-xs font-semibold text-foreground tracking-tight">
                      All PDF Tools ({PDF_TOOLS.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setToolsDropdownOpen(false);
                        navigate('/');
                      }}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      View directory
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 max-h-[65vh] overflow-y-auto pr-0.5">
                    {PDF_TOOLS.map((tool) => {
                      const active = isItemActive(tool.path);
                      return (
                        <DropdownMenu.Item
                          key={tool.id}
                          onSelect={() => navigate(tool.path)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs outline-none cursor-pointer transition-colors',
                            active
                              ? 'bg-primary/[0.09] text-primary font-semibold'
                              : 'hover:bg-accent focus:bg-accent text-foreground'
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                              tool.color
                            )}
                          >
                            <tool.icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium leading-tight">
                              {tool.label}
                            </div>
                          </div>
                        </DropdownMenu.Item>
                      );
                    })}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            {/* Core quick workflow links (cleanly visible on lg+ screens with zero overflow) */}
            <div className="hidden lg:flex items-center gap-1.5">
              {PRIMARY_LINKS.slice(1).map((item) => {
                const active = isItemActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-[13px] font-medium leading-none transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'text-primary font-semibold bg-primary/[0.09]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/80'
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Right: Theme Switcher & Mobile Menu */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2.5 sm:px-3 gap-1.5 rounded-lg border-border/90 bg-surface-secondary dark:bg-secondary/75 hover:bg-accent hover:border-primary/35 text-foreground transition-colors touch-manipulation"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="hidden sm:inline text-xs font-medium">Light</span>
              </>
            ) : (
              <>
                <Moon className="h-4 w-4 text-primary shrink-0" />
                <span className="hidden sm:inline text-xs font-medium">Dark</span>
              </>
            )}
          </Button>

          {/* Mobile Hamburger Menu Button */}
          <div className="md:hidden flex items-center">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-lg border-border/80 bg-surface-secondary dark:bg-secondary/70 hover:bg-accent touch-manipulation"
              aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-header shadow-xl max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <nav
            aria-label="Mobile navigation"
            className="container mx-auto px-4 py-3.5 space-y-4"
          >
            <Link
              to="/"
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px]',
                isItemActive('/')
                  ? 'bg-primary/[0.09] text-primary font-semibold'
                  : 'text-foreground hover:bg-accent'
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Home className="h-4 w-4" />
              </div>
              <span>Home Directory</span>
            </Link>

            {DRAWER_SECTIONS.map((section) => (
              <div key={section.id} className="space-y-1.5">
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {section.tools.map((tool) => {
                    const active = isItemActive(tool.path);
                    return (
                      <Link
                        key={tool.id}
                        to={tool.path}
                        className={cn(
                          'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium transition-colors min-h-[42px]',
                          active
                            ? 'bg-primary/[0.09] text-primary font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                            tool.color
                          )}
                        >
                          <tool.icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="truncate">{tool.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/80 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <BrandLogo variant="icon" size="xs" alt="PDF Render icon" />
                <span>100% Client-Side &amp; Private</span>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-secondary dark:bg-secondary border border-border text-foreground/80">
                v1.3.1
              </span>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-border/80 bg-header/80 backdrop-blur-sm py-6 mt-auto">
      <div className="container mx-auto max-w-7xl px-4 sm:px-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
          <BrandLogo variant="icon" size="xs" alt="PDF Render icon" />
          <span>
            © {new Date().getFullYear()}{' '}
            <strong className="font-semibold text-foreground">PDF Render</strong>
          </span>
          <span className="hidden sm:inline text-muted-foreground/40">•</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-secondary dark:bg-secondary border border-border text-foreground/85">
            v1.3.1
          </span>
          <span className="hidden sm:inline text-muted-foreground/40">•</span>
          <span>100% Client-Side &amp; Private</span>
        </div>
        <p className="text-xs">
          Developed by <span className="font-semibold text-foreground">Dip Mondal</span>
        </p>
      </div>
    </footer>
  );
}

export function ThemeToaster() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme={theme}
      toastOptions={{
        className: 'font-sans',
      }}
    />
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <div className="relative flex-1 flex flex-col w-full max-w-full overflow-x-hidden">
        <WaveBackground variant={isHomePage ? 'hero' : 'subtle'} />
        <main className="relative z-10 flex-1 w-full max-w-full">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
