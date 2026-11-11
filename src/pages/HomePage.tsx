import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Lock,
  Search,
  SearchX,
  Shield,
  X,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PDF_TOOLS,
  PDF_TOOL_CATEGORIES,
  PdfToolDefinition,
  RECENT_TOOLS_UPDATED_EVENT,
  ToolCategoryId,
  clearRecentTools,
  filterPdfTools,
  getCategoryLabel,
  getPrimaryCategoryLabel,
  getRecentTools,
  recordRecentTool,
} from '@/lib/toolsRegistry';

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ToolCategoryId>('all');
  const [recentTools, setRecentTools] = useState<PdfToolDefinition[]>(() => getRecentTools());
  const [isMac, setIsMac] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent));
    }
  }, []);

  // Sync recently used tools with localStorage updates (navigation, clear, or another tab)
  useEffect(() => {
    const syncRecent = () => setRecentTools(getRecentTools());
    syncRecent();

    window.addEventListener(RECENT_TOOLS_UPDATED_EVENT, syncRecent);
    window.addEventListener('storage', syncRecent);
    return () => {
      window.removeEventListener(RECENT_TOOLS_UPDATED_EVENT, syncRecent);
      window.removeEventListener('storage', syncRecent);
    };
  }, []);

  // Keyboard shortcut Ctrl/Cmd + K to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredTools = useMemo(
    () =>
      filterPdfTools({
        category: activeCategory,
        query: searchQuery,
      }),
    [activeCategory, searchQuery]
  );

  const isSearching = searchQuery.trim().length > 0;
  const isFiltered = isSearching || activeCategory !== 'all';
  const showRecentSection = recentTools.length > 0 && !isFiltered;

  const activeCategoryLabel = getCategoryLabel(activeCategory);

  const handleClearSearch = () => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setActiveCategory('all');
    searchInputRef.current?.focus();
  };

  const handleToolOpen = (toolId: string) => {
    const updated = recordRecentTool(toolId);
    setRecentTools(updated);
  };

  const handleClearRecent = () => {
    clearRecentTools();
    setRecentTools([]);
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 pt-6 sm:pt-8 pb-12 max-w-7xl overflow-x-hidden">
      {/* Compact Hero Section */}
      <section className="text-center max-w-3xl mx-auto mb-5 sm:mb-6">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-2.5">
          <Zap className="h-3 w-3 shrink-0" />
          <span>100% Free &amp; Client-Side</span>
        </div>

        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-2">
          Everything <span className="text-primary">PDF</span>, All in One Place
        </h1>

        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto mb-3.5 leading-relaxed">
          Create, convert, organize and edit your PDF documents with powerful tools in one place.
        </p>

        {/* Compact Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <span>Private &amp; Secure</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span>No File Uploads</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>Instant Processing</span>
          </div>
        </div>
      </section>

      {/* Prominent Search & Category Controls */}
      <section aria-label="Search and filter PDF tools" className="mb-6 sm:mb-7 space-y-3.5">
        {/* Search Bar */}
        <div className="max-w-2xl mx-auto w-full">
          <div className="relative flex items-center w-full rounded-xl border border-border/80 bg-card/90 shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
            <Search
              className="absolute left-3.5 h-4 w-4 text-muted-foreground pointer-events-none shrink-0"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              role="searchbox"
              aria-label="Search PDF tools"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault();
                  setSearchQuery('');
                }
              }}
              placeholder="Search PDF tools..."
              className="w-full h-11 sm:h-12 bg-transparent pl-10 pr-20 text-sm sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none rounded-xl"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="absolute right-2.5 flex items-center gap-1.5">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => searchInputRef.current?.focus()}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="hidden sm:inline-flex items-center gap-0.5 rounded-md border bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground select-none"
                >
                  <span>{isMac ? '⌘' : 'Ctrl'}</span>
                  <span>K</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Horizontally Scrollable Category Filter Pills */}
        <div className="w-full max-w-full overflow-x-auto scrollbar-none pb-0.5">
          <div
            role="tablist"
            aria-label="Tool categories"
            className="flex items-center gap-2 w-max min-w-full md:w-full md:flex-wrap md:justify-center px-0.5"
          >
            {PDF_TOOL_CATEGORIES.map((category) => {
              const isSelected = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-medium border transition-[border-color,box-shadow] touch-manipulation min-h-[36px] inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card/80 text-muted-foreground border-border hover:text-foreground hover:bg-muted/70 hover:border-primary/30'
                  )}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Recently Used Section (compact, shown only when history exists and default view is active) */}
      {showRecentSection && (
        <section aria-label="Recently used tools" className="mb-6 sm:mb-7">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <h2 className="text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Recently Used</span>
            </h2>
            <button
              type="button"
              onClick={handleClearRecent}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {recentTools.map((tool) => (
              <Link
                key={`recent-${tool.id}`}
                to={tool.path}
                onClick={() => handleToolOpen(tool.id)}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-manipulation"
              >
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border bg-card/85 px-2.5 py-2 sm:px-3 sm:py-2.5 transition-[transform,box-shadow,border-color] duration-200 hover:bg-card hover:shadow-sm active:scale-[0.99] min-w-0',
                    tool.borderColor
                  )}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg',
                      tool.color
                    )}
                  >
                    <tool.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] xl:text-sm font-semibold text-foreground truncate leading-snug">
                      {tool.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate leading-tight">
                      {getPrimaryCategoryLabel(tool)}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Main Tool Directory Header & Count */}
      <section aria-label="PDF tools directory">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold tracking-tight">
              {isSearching
                ? activeCategory !== 'all'
                  ? `Search Results in ${activeCategoryLabel}`
                  : 'Search Results'
                : activeCategoryLabel}
            </h2>
            <span
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground shrink-0"
              aria-live="polite"
            >
              {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Tools Grid or Empty State */}
        {filteredTools.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
            {filteredTools.map((tool) => (
              <Link
                key={tool.id}
                to={tool.path}
                onClick={() => handleToolOpen(tool.id)}
                className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-manipulation"
              >
                <Card
                  className={cn(
                    'h-full flex flex-col transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99] rounded-xl',
                    tool.borderColor
                  )}
                >
                  <CardContent className="p-4 sm:p-5 flex flex-col h-full min-w-0">
                    <div
                      className={cn(
                        'inline-flex items-center justify-center w-10 h-10 rounded-lg shrink-0 mb-3',
                        tool.color
                      )}
                    >
                      <tool.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold text-base mb-1.5 flex items-center justify-between gap-2 min-w-0">
                      <span className="leading-snug">{tool.label}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-65 group-hover:opacity-100 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed flex-1">
                      {tool.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-card/50 px-5 py-10 sm:py-12 text-center max-w-xl mx-auto">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <SearchX className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {isSearching
                ? `No tools found for "${searchQuery.trim()}"`
                : `No tools in ${activeCategoryLabel}`}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto mb-5 leading-relaxed">
              {activeCategory !== 'all'
                ? `No matching tools in the ${activeCategoryLabel} category. Try another keyword or switch back to All Tools.`
                : 'Try searching by tool name or action such as combine, cover page, rotate, extract text, or convert word.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {isSearching && (
                <Button type="button" variant="outline" size="sm" onClick={handleClearSearch}>
                  Clear search
                </Button>
              )}
              {activeCategory !== 'all' && (
                <Button type="button" size="sm" onClick={handleResetFilters}>
                  Show All Tools ({PDF_TOOLS.length})
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* How It Works */}
      <section className="mt-14 sm:mt-16 text-center">
        <h2 className="text-xl sm:text-2xl font-bold mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 max-w-3xl mx-auto">
          <div className="flex flex-col items-center">
            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-base font-bold mb-2.5">
              1
            </div>
            <h3 className="font-semibold text-sm sm:text-base mb-1">Choose a Tool</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Select from the free PDF tools above
            </p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-base font-bold mb-2.5">
              2
            </div>
            <h3 className="font-semibold text-sm sm:text-base mb-1">Upload &amp; Edit</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Drop your files and customize in browser
            </p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-base font-bold mb-2.5">
              3
            </div>
            <h3 className="font-semibold text-sm sm:text-base mb-1">Download</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Get your processed PDF instantly
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
