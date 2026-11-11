import brandLogoIcon from '@/assets/brand/pdf-render-icon-128.png';
import { cn } from '@/lib/utils';

export type BrandLogoVariant = 'full' | 'icon';
export type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  alt?: string;
  className?: string;
  wordmarkClassName?: string;
}

const ICON_SIZE_CLASSES: Record<BrandLogoSize, { className: string; px: number }> = {
  xs: { className: 'h-5 w-5', px: 20 },
  sm: { className: 'h-7 w-7', px: 28 },
  md: { className: 'h-8 w-8 sm:h-9 sm:w-9', px: 36 },
  lg: { className: 'h-12 w-12', px: 48 },
};

const WORDMARK_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  xs: 'text-xs',
  sm: 'text-[15px]',
  md: 'text-[15px] sm:text-base',
  lg: 'text-lg sm:text-xl',
};

export function BrandLogo({
  variant = 'full',
  size = 'md',
  alt = 'PDF Render logo',
  className,
  wordmarkClassName,
}: BrandLogoProps) {
  const iconSpec = ICON_SIZE_CLASSES[size];

  const iconElement = (
    <img
      src={brandLogoIcon}
      alt={alt}
      width={iconSpec.px}
      height={iconSpec.px}
      decoding="async"
      draggable={false}
      className={cn(
        'aspect-square shrink-0 object-contain select-none drop-shadow-[0_1px_3px_rgba(15,23,42,0.12)] dark:drop-shadow-[0_2px_8px_rgba(99,102,241,0.28)]',
        iconSpec.className
      )}
    />
  );

  if (variant === 'icon') {
    return (
      <span className={cn('inline-flex items-center justify-center shrink-0', className)}>
        {iconElement}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2.5 shrink-0', className)}>
      {iconElement}
      <span
        className={cn(
          'font-sans font-bold tracking-[-0.015em] text-foreground whitespace-nowrap leading-none',
          WORDMARK_SIZE_CLASSES[size],
          wordmarkClassName
        )}
      >
        PDF Render
      </span>
    </span>
  );
}
