import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  History,
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
    <div className="container mx-auto px-3.5 sm:px-6 pt-7 sm:pt-10 pb-16 max-w-7xl overflow-x-hidden">
      {/* Elegant Architectural Hero Section */}
      <section className="text-center max-w-3xl mx-auto mb-6 sm:mb-7">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-card/90 dark:bg-card/85 border border-border shadow-sm text-xs font-medium text-foreground/90 mb-3.5 sm:mb-4 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-teal shrink-0" />
          <span>100% Free &amp; Client-Side</span>
        </div>

        <h1 className="text-[30px] sm:text-[40px] lg:text-[44px] font-bold tracking-[-0.025em] text-foreground leading-[1.12] mb-3">
          Everything <span className="text-primary">PDF</span>, All in One Place
        </h1>

        <p className="text-[15px] sm:text-base text-muted-foreground max-w-2xl mx-auto mb-4 sm:mb-5 leading-[1.6]">
          Create, convert, organize and edit your PDF documents with powerful tools in one place.
        </p>

        {/* Theme-aware Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/85 dark:bg-card/80 px-3 py-1 shadow-sm backdrop-blur-xs">
            <Lock className="h-3.5 w-3.5 text-teal shrink-0" />
            <span className="font-medium text-foreground/85">Private &amp; Secure</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/85 dark:bg-card/80 px-3 py-1 shadow-sm backdrop-blur-xs">
            <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-medium text-foreground/85">No File Uploads</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/85 dark:bg-card/80 px-3 py-1 shadow-sm backdrop-blur-xs">
            <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-medium text-foreground/85">Instant Processing</span>
          </div>
        </div>
      </section>

      {/* Prominent Search & Category Filters */}
      <section aria-label="Search and filter PDF tools" className="mb-8 space-y-4">
        {/* Search Bar */}
        <div className="max-w-2xl mx-auto w-full">
          <div className="group relative flex items-center w-full rounded-2xl border border-border/95 dark:border-[#343B54] bg-card shadow-[0_2px_10px_rgba(15,23,42,0.05),0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_18px_rgba(4,5,12,0.45)] transition-[border-color,box-shadow] duration-200 hover:border-primary/45 dark:hover:border-indigo-400/50 focus-within:border-primary dark:focus-within:border-indigo-400 focus-within:ring-[3px] focus-within:ring-primary/20 dark:focus-within:ring-indigo-400/25 focus-within:shadow-[0_8px_24px_-6px_rgba(79,70,229,0.22)]">
            <Search
              className="absolute left-4 h-[18px] w-[18px] text-muted-foreground group-focus-within:text-primary dark:group-focus-within:text-indigo-400 transition-colors pointer-events-none shrink-0"
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
              className="w-full h-[52px] sm:h-[54px] bg-transparent pl-11 pr-20 text-[15px] sm:text-base text-foreground placeholder:text-muted-foreground/85 focus:outline-none rounded-2xl"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="absolute right-3 flex items-center gap-1.5">
              {searchQuery ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => searchInputRef.current?.focus()}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-secondary dark:bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground select-none"
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
              const CategoryIcon = category.icon;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs sm:text-[13px] font-medium border transition-[border-color,box-shadow,color,background-color] duration-150 touch-manipulation min-h-[38px] inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-surface-secondary dark:hover:bg-secondary hover:border-indigo-400/45'
                  )}
                >
                  <CategoryIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>{category.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Recently Used Section */}
      {showRecentSection && (
        <section aria-label="Recently used tools" className="mb-11 sm:mb-12">
          <div className="flex items-center justify-between gap-2 mb-3.5">
            <h2 className="text-xs sm:text-[13px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Recently Used</span>
            </h2>
            <button
              type="button"
              onClick={handleClearRecent}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-lg hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {recentTools.map((tool) => (
              <Link
                key={`recent-${tool.id}`}
                to={tool.path}
                onClick={() => handleToolOpen(tool.id)}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-manipulation"
              >
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-hover active:scale-[0.99] min-w-0',
                    tool.borderColor
                  )}
                >
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      tool.color
                    )}
                  >
                    <tool.icon className="h-4 w-4 shrink-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate leading-snug">
                      {tool.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate leading-snug mt-0.5">
                      {getPrimaryCategoryLabel(tool)}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-55 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 transition-[transform,opacity,color] duration-150 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Main Tool Directory Header & Count */}
      <section aria-label="PDF tools directory">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
              {isSearching
                ? activeCategory !== 'all'
                  ? `Search Results in ${activeCategoryLabel}`
                  : 'Search Results'
                : activeCategoryLabel}
            </h2>
            <span
              className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shrink-0"
              aria-live="polite"
            >
              {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1.5 py-0.5"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Tools Grid or Empty State */}
        {filteredTools.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {filteredTools.map((tool) => (
              <Link
                key={tool.id}
                to={tool.path}
                onClick={() => handleToolOpen(tool.id)}
                className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-manipulation"
              >
                <Card
                  className={cn(
                    'h-full sm:min-h-[196px] flex flex-col rounded-2xl border-border bg-card shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-[3px] hover:shadow-card-hover active:scale-[0.99]',
                    tool.borderColor
                  )}
                >
                  <CardContent className="p-5 flex flex-col h-full min-w-0">
                    <div
                      className={cn(
                        'inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0 mb-4',
                        tool.color
                      )}
                    >
                      <tool.icon className="h-5 w-5 shrink-0" />
                    </div>
                    <h3 className="font-semibold text-[15px] sm:text-base tracking-[-0.01em] text-foreground mb-2 flex items-center justify-between gap-2 min-w-0">
                      <span className="leading-snug truncate">{tool.label}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 transition-[transform,opacity,color] duration-150" />
                    </h3>
                    <p className="text-[13px] sm:text-[13.5px] text-muted-foreground dark:text-[#AEB3C6] leading-[1.62] flex-1">
                      {tool.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card/85 px-6 py-12 text-center max-w-xl mx-auto shadow-card">
            <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SearchX className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">
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
      <section className="mt-16 sm:mt-20 text-center">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-2">
          How It Works
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
          Every operation executes locally in your browser — fast, private, and reliable.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-4xl mx-auto">
          <div className="rounded-2xl border border-border bg-card/90 backdrop-blur-xs p-6 shadow-card flex flex-col items-center">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center text-sm font-bold mb-3">
              1
            </div>
            <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1">
              Choose a Tool
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Select from our suite of free client-side PDF utilities above
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card/90 backdrop-blur-xs p-6 shadow-card flex flex-col items-center">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/15 flex items-center justify-center text-sm font-bold mb-3">
              2
            </div>
            <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1">
              Upload &amp; Edit
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Drop your files securely and customize settings directly in browser
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card/90 backdrop-blur-xs p-6 shadow-card flex flex-col items-center">
            <div className="w-10 h-10 rounded-xl bg-teal/10 text-teal border border-teal/20 flex items-center justify-center text-sm font-bold mb-3">
              3
            </div>
            <h3 className="font-semibold text-sm sm:text-base text-foreground mb-1">
              Download
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Export your finished PDF or converted document immediately
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
