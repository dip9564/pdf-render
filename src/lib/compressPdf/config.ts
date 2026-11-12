export type CompressionMode = 'low' | 'recommended' | 'extreme';

export interface CompressionValidationThresholds {
  /** Minimum structural similarity (SSIM, 0..1) expected on rendered comparison pages */
  minSsim: number;
  /** Minimum PSNR (dB) expected before flagging noticeable structural distortion */
  minPsnrDb: number;
  /** Maximum number of sample pages rendered for visual verification */
  maxRenderSamplePages: number;
  /** Render width target in CSS pixels used for fast visual comparison */
  compareRenderMaxWidthPx: number;
}

export interface CompressionModePreset {
  mode: CompressionMode;
  label: string;
  shortLabel: string;
  badgeText: string;
  description: string;
  detailPoints: readonly string[];
  qualityWarning?: string;
  targetDpi: number;
  /** Bilevel monochrome CCITT target DPI (kept readable for crisp B&W text) */
  monochromeTargetDpi: number;
  /** Only downsample when effective DPI exceeds targetDpi * minDownsampleDpiRatio */
  minDownsampleDpiRatio: number;
  jpegQuality: number; // 0..100
  /** Recompress existing JPEG streams when smaller without downsampling */
  recompressExistingJpeg: boolean;
  /** Skip recompressing existing JPEG when bpp is already at or below this threshold */
  alreadyOptimizedJpegMaxBpp: number;
  /** Minimum relative savings (0..1) required to replace an existing JPEG without downsampling */
  minLossyReplacementSavingsRatio: number;
  convertSuitableScansToGrayscale: boolean;
  useCcittGroup4ForBilevel: boolean;
  useLosslessDiagramCompression: boolean;
  /** Allow converting large flat/diagram bitmaps to high-contrast JPEG if lossless stays bloated (Extreme only) */
  allowLossyForHeavyDiagrams: boolean;
  deduplicateImages: boolean;
  deduplicateStreams: boolean;
  removeUnusedObjects: boolean;
  recompressStreams: boolean;
  generateObjectStreams: boolean;
  externalizeInlineImages: boolean;
  linearize: boolean;
  validation: CompressionValidationThresholds;
}

export interface CompressionPreservationSettings {
  removeMetadata: boolean;
  preserveTextQuality: boolean;
  preserveVectorQuality: boolean;
  preserveLinks: boolean;
  preserveBookmarks: boolean;
  preserveAnnotations: boolean;
  preserveForms: boolean;
  preservePageDimensions: boolean;
  preservePageRotation: boolean;
  preserveAttachments: boolean;
}

export interface CompressionSettings
  extends CompressionModePreset,
    CompressionPreservationSettings {
  /** Treat savings smaller than this byte AND ratio threshold as non-meaningful */
  meaningfulReductionMinBytes: number;
  meaningfulReductionMinPercent: number;
  /** Re-encrypt password-protected PDFs using AES-256 when user unlocked them */
  preservePasswordProtectionOnEncryptedPdf: boolean;
}

export const DEFAULT_COMPRESSION_MODE: CompressionMode = 'recommended';

export const DEFAULT_PRESERVATION_SETTINGS: CompressionPreservationSettings = {
  removeMetadata: false,
  preserveTextQuality: true,
  preserveVectorQuality: true,
  preserveLinks: true,
  preserveBookmarks: true,
  preserveAnnotations: true,
  preserveForms: true,
  preservePageDimensions: true,
  preservePageRotation: true,
  preserveAttachments: true,
};

export const COMPRESSION_PRESETS: Record<CompressionMode, CompressionModePreset> = {
  low: {
    mode: 'low',
    label: 'Low Compression',
    shortLabel: 'Low',
    badgeText: 'High Fidelity',
    description: 'Best for documents requiring high visual quality.',
    detailPoints: [
      '200 DPI target resolution',
      '90% JPEG quality (88–92% range)',
      'Preserves already-optimized images',
      'Lossless diagrams & full structural optimization',
    ],
    targetDpi: 200,
    monochromeTargetDpi: 200,
    minDownsampleDpiRatio: 1.1,
    jpegQuality: 90,
    recompressExistingJpeg: true,
    alreadyOptimizedJpegMaxBpp: 1.85,
    minLossyReplacementSavingsRatio: 0.12,
    convertSuitableScansToGrayscale: false,
    useCcittGroup4ForBilevel: false,
    useLosslessDiagramCompression: true,
    allowLossyForHeavyDiagrams: false,
    deduplicateImages: true,
    deduplicateStreams: true,
    removeUnusedObjects: true,
    recompressStreams: true,
    generateObjectStreams: true,
    externalizeInlineImages: true,
    linearize: false,
    validation: {
      minSsim: 0.94,
      minPsnrDb: 26,
      maxRenderSamplePages: 5,
      compareRenderMaxWidthPx: 360,
    },
  },
  recommended: {
    mode: 'recommended',
    label: 'Recommended Compression',
    shortLabel: 'Recommended',
    badgeText: 'Default • Balanced',
    description: 'Best balance between file size and visual quality.',
    detailPoints: [
      '150 DPI target resolution',
      '82% JPEG quality (80–85% range)',
      'Downsamples oversized images & deduplicates resources',
      'Preserves text, vectors & image transparency',
    ],
    targetDpi: 150,
    monochromeTargetDpi: 150,
    minDownsampleDpiRatio: 1.08,
    jpegQuality: 82,
    recompressExistingJpeg: true,
    alreadyOptimizedJpegMaxBpp: 1.05,
    minLossyReplacementSavingsRatio: 0.08,
    convertSuitableScansToGrayscale: false,
    useCcittGroup4ForBilevel: true,
    useLosslessDiagramCompression: true,
    allowLossyForHeavyDiagrams: false,
    deduplicateImages: true,
    deduplicateStreams: true,
    removeUnusedObjects: true,
    recompressStreams: true,
    generateObjectStreams: true,
    externalizeInlineImages: true,
    linearize: false,
    validation: {
      minSsim: 0.88,
      minPsnrDb: 21,
      maxRenderSamplePages: 5,
      compareRenderMaxWidthPx: 360,
    },
  },
  extreme: {
    mode: 'extreme',
    label: 'Extreme Compression',
    shortLabel: 'Extreme',
    badgeText: 'Smallest Size',
    description:
      'Best when the smallest possible file size is the priority. Image quality may decrease noticeably.',
    detailPoints: [
      '108 DPI target resolution (96–120 DPI range)',
      '55% JPEG quality (45–65% range)',
      'Grayscale & CCITT Group 4 optimization for scans',
      'Maximum structural & unused-resource pruning',
    ],
    qualityWarning:
      'Extreme compression aggressively downsamples images and uses higher JPEG / monochrome compression. Photographic detail loss will be noticeable, while native text and vectors remain preserved.',
    targetDpi: 108,
    monochromeTargetDpi: 120,
    minDownsampleDpiRatio: 1.03,
    jpegQuality: 55,
    recompressExistingJpeg: true,
    alreadyOptimizedJpegMaxBpp: 0.55,
    minLossyReplacementSavingsRatio: 0.04,
    convertSuitableScansToGrayscale: true,
    useCcittGroup4ForBilevel: true,
    useLosslessDiagramCompression: true,
    allowLossyForHeavyDiagrams: true,
    deduplicateImages: true,
    deduplicateStreams: true,
    removeUnusedObjects: true,
    recompressStreams: true,
    generateObjectStreams: true,
    externalizeInlineImages: true,
    linearize: false,
    validation: {
      minSsim: 0.7,
      minPsnrDb: 13.5,
      maxRenderSamplePages: 5,
      compareRenderMaxWidthPx: 360,
    },
  },
};

export const DEFAULT_COMPRESSION_SETTINGS: CompressionSettings = {
  ...COMPRESSION_PRESETS[DEFAULT_COMPRESSION_MODE],
  ...DEFAULT_PRESERVATION_SETTINGS,
  meaningfulReductionMinBytes: 512,
  meaningfulReductionMinPercent: 1.0,
  preservePasswordProtectionOnEncryptedPdf: true,
};

export function createCompressionSettings(
  mode: CompressionMode = DEFAULT_COMPRESSION_MODE,
  overrides: Partial<CompressionSettings> = {}
): CompressionSettings {
  const preset = COMPRESSION_PRESETS[mode] ?? COMPRESSION_PRESETS[DEFAULT_COMPRESSION_MODE];
  return {
    ...preset,
    ...DEFAULT_PRESERVATION_SETTINGS,
    meaningfulReductionMinBytes: 512,
    meaningfulReductionMinPercent: 1.0,
    preservePasswordProtectionOnEncryptedPdf: true,
    ...overrides,
    mode: preset.mode,
    validation: {
      ...preset.validation,
      ...(overrides.validation ?? {}),
    },
  };
}
