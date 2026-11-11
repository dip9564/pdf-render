import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  GraduationCap,
  Upload,
  Ban,
  Download,
  FilePlus2,
  FileText,
  Eye,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  BookmarkPlus,
  FolderOpen,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  Layers,
  Image as ImageIcon,
} from 'lucide-react';
import kgecLogoUrl from '@/assets/kgec-logo.jpg';
import { cn, formatFileSize, downloadBlob, createPdfBlob, readFileAsArrayBuffer } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { usePdfRenderer } from '@/components/shared/PdfRenderer';
import {
  DEFAULT_BORDER_MARGIN_PT,
  DEFAULT_COLLEGE_FONT_SIZE_PT,
  DEFAULT_COLLEGE_NAME,
  DEFAULT_LOGO_SIZE_PT,
  EMPTY_FRONT_PAGE_DETAILS,
  ExistingPdfInfo,
  FrontPageConfig,
  FrontPageDetails,
  FrontPageError,
  LogoImagePayload,
  LogoMode,
  LogoPosition,
  MAX_BORDER_MARGIN_PT,
  MAX_COLLEGE_FONT_SIZE_PT,
  MAX_LOGO_SIZE_PT,
  MIN_BORDER_MARGIN_PT,
  MIN_COLLEGE_FONT_SIZE_PT,
  MIN_LOGO_SIZE_PT,
  buildFrontPageFilename,
  buildMergedPdfFilename,
  generateFrontPagePdf,
  hasAnyVisibleFrontPageContent,
  loadLogoPayloadFromUrl,
  mergeFrontPageWithPdf,
  prepareLogoImageFromFile,
  validateAndInspectExistingPdf,
} from '@/lib/frontPage/frontPagePdfEngine';
import {
  FrontPageProfile,
  ProfileCollegeInfo,
  ProfileStorageError,
  ProfileStudentInfo,
  applyProfileToDetails,
  createProfileDraftFromFormState,
  deleteFrontPageProfile,
  listFrontPageProfiles,
  saveFrontPageProfile,
  updateFrontPageProfile,
} from '@/lib/frontPage/frontPageProfilesDb';
import {
  SaveProfileDialog,
  SavedProfilesDialog,
} from '@/components/frontPage/FrontPageProfilesModals';

const SAMPLE_DETAILS: FrontPageDetails = {
  collegeName: DEFAULT_COLLEGE_NAME,
  mainTitle: 'Object Oriented Programming Lab',
  assignmentTitle: 'Lab Assignment I',
  name: 'Dip Mondal',
  rollNo: '10200100001',
  registrationNo: '241020100001',
  department: 'Computer Science and Engineering',
  subject: 'Object Oriented Programming Lab',
  subjectCode: 'PCC-CS 593',
  semester: '5th',
  year: '2026 - 2027',
};

interface UploadedExistingPdf {
  file: File;
  buffer: ArrayBuffer;
  info: ExistingPdfInfo;
}

export default function FrontPageGenerator() {
  const { renderPage } = usePdfRenderer();

  // Logo & Frame Settings
  const [logoMode, setLogoMode] = useState<LogoMode>('kgec');
  const [logoPosition, setLogoPosition] = useState<LogoPosition>('left');
  const [logoSizePt, setLogoSizePt] = useState<number>(DEFAULT_LOGO_SIZE_PT);
  const [collegeFontSizePt, setCollegeFontSizePt] = useState<number>(DEFAULT_COLLEGE_FONT_SIZE_PT);
  const [borderMarginPt, setBorderMarginPt] = useState<number>(DEFAULT_BORDER_MARGIN_PT);

  const [kgecLogoPayload, setKgecLogoPayload] = useState<LogoImagePayload | null>(null);
  const [kgecLoadError, setKgecLoadError] = useState<string | null>(null);

  const [customLogoFile, setCustomLogoFile] = useState<File | null>(null);
  const [customLogoMeta, setCustomLogoMeta] = useState<{
    fileName: string;
    fileSize: number;
  } | null>(null);
  const [customLogoPreviewUrl, setCustomLogoPreviewUrl] = useState<string | null>(null);
  const [customLogoPayload, setCustomLogoPayload] = useState<LogoImagePayload | null>(null);
  const [customLogoError, setCustomLogoError] = useState<string | null>(null);
  const [loadingLogo, setLoadingLogo] = useState<boolean>(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState<boolean>(false);

  // Form Details
  const [details, setDetails] = useState<FrontPageDetails>(EMPTY_FRONT_PAGE_DETAILS);

  // Saved Profiles (IndexedDB)
  const [savedProfiles, setSavedProfiles] = useState<FrontPageProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState<boolean>(true);
  const [profilesStorageError, setProfilesStorageError] = useState<string | null>(null);
  const [saveProfileOpen, setSaveProfileOpen] = useState<boolean>(false);
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [saveModalError, setSaveModalError] = useState<string | null>(null);
  const [savedProfilesOpen, setSavedProfilesOpen] = useState<boolean>(false);

  // Preview State
  const [hasGeneratedPreview, setHasGeneratedPreview] = useState<boolean>(false);
  const [generatingPreview, setGeneratingPreview] = useState<boolean>(false);
  const [previewPdfBytes, setPreviewPdfBytes] = useState<Uint8Array | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDirty, setPreviewDirty] = useState<boolean>(false);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');

  // Output Option A: Standalone Download
  const [downloadingStandalone, setDownloadingStandalone] = useState<boolean>(false);

  // Output Option B: Add to Existing PDF
  const [showMergePanel, setShowMergePanel] = useState<boolean>(false);
  const [existingPdf, setExistingPdf] = useState<UploadedExistingPdf | null>(null);
  const [validatingExistingPdf, setValidatingExistingPdf] = useState<boolean>(false);
  const [existingPdfError, setExistingPdfError] = useState<{
    code?: string;
    message: string;
  } | null>(null);
  const [isDraggingExistingPdf, setIsDraggingExistingPdf] = useState<boolean>(false);
  const [mergingPdf, setMergingPdf] = useState<boolean>(false);

  const formCardRef = useRef<HTMLDivElement>(null);
  const previewCardRef = useRef<HTMLDivElement>(null);
  const customLogoInputRef = useRef<HTMLInputElement>(null);
  const existingPdfInputRef = useRef<HTMLInputElement>(null);
  const mergePanelRef = useRef<HTMLDivElement>(null);
  const previewRequestIdRef = useRef<number>(0);

  // Preload official local KGEC asset once on mount
  useEffect(() => {
    let cancelled = false;
    loadLogoPayloadFromUrl(kgecLogoUrl, 'jpg')
      .then((payload) => {
        if (!cancelled) {
          setKgecLogoPayload(payload);
          setKgecLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load default KGEC logo.';
          setKgecLoadError(msg);
          console.error('KGEC logo preload error:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke object URL on unmount / replacement
  useEffect(() => {
    return () => {
      if (customLogoPreviewUrl) {
        URL.revokeObjectURL(customLogoPreviewUrl);
      }
    };
  }, [customLogoPreviewUrl]);

  const refreshSavedProfiles = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoadingProfiles(true);
    }
    try {
      const loaded = await listFrontPageProfiles();
      setSavedProfiles(loaded);
      setProfilesStorageError(null);
    } catch (err) {
      const msg =
        err instanceof ProfileStorageError
          ? err.message
          : 'Failed to load saved profiles from local IndexedDB storage.';
      setProfilesStorageError(msg);
      console.error('Failed to list saved profiles:', err);
    } finally {
      if (!quiet) {
        setLoadingProfiles(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSavedProfiles(false);
  }, [refreshSavedProfiles]);

  const activeLogoPayload: LogoImagePayload | null =
    logoMode === 'kgec'
      ? kgecLogoPayload
      : logoMode === 'custom'
        ? customLogoPayload
        : null;

  const buildCurrentConfig = useCallback((): FrontPageConfig => {
    return {
      logoMode,
      logoPosition,
      logoSizePt,
      collegeFontSizePt,
      borderMarginPt,
      logo: activeLogoPayload,
      details,
    };
  }, [logoMode, logoPosition, logoSizePt, collegeFontSizePt, borderMarginPt, activeLogoPayload, details]);

  // Mark preview needing refresh when any field changes
  const markFormChanged = useCallback(() => {
    if (hasGeneratedPreview) {
      setPreviewDirty(true);
    }
  }, [hasGeneratedPreview]);

  const updateDetailField = <K extends keyof FrontPageDetails>(key: K, value: string) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
    markFormChanged();
  };

  const handleLogoModeChange = (mode: LogoMode) => {
    setLogoMode(mode);
    if (mode !== 'custom') {
      setCustomLogoError(null);
    }
    setPreviewError(null);
    markFormChanged();
  };

  const handleCustomLogoSelected = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setLoadingLogo(true);
      setCustomLogoError(null);
      setPreviewError(null);

      try {
        const prepared = await prepareLogoImageFromFile(file);
        const previewBlobUrl = URL.createObjectURL(
          new Blob([prepared.bytes as unknown as BlobPart], {
            type: prepared.format === 'png' ? 'image/png' : 'image/jpeg',
          })
        );

        setCustomLogoFile(file);
        setCustomLogoMeta({
          fileName: file.name,
          fileSize: file.size || prepared.bytes.byteLength,
        });
        setCustomLogoPayload(prepared);
        setCustomLogoPreviewUrl(previewBlobUrl);
        setLogoMode('custom');
        markFormChanged();
        toast.success(`Custom logo "${file.name}" loaded (${prepared.width} × ${prepared.height} px)`);
      } catch (err) {
        const message =
          err instanceof FrontPageError
            ? err.message
            : 'Invalid logo image. Please upload a valid PNG, JPG, JPEG, or SVG file.';
        setCustomLogoError(message);
        toast.error(message);
      } finally {
        setLoadingLogo(false);
      }
    },
    [markFormChanged]
  );

  const clearCustomLogo = () => {
    setCustomLogoFile(null);
    setCustomLogoMeta(null);
    setCustomLogoPayload(null);
    setCustomLogoError(null);
    setCustomLogoPreviewUrl(null);
    markFormChanged();
  };

  // Core preview builder (renders exact generated PDF bytes via pdfjsLib)
  const executeGeneratePreview = useCallback(
    async (scrollOnMobile: boolean): Promise<boolean> => {
      const requestId = ++previewRequestIdRef.current;
      const config = buildCurrentConfig();

      // Explicit check when KGEC logo is still finishing initial decode or failed
      if (config.logoMode === 'kgec' && !config.logo) {
        if (kgecLoadError) {
          setPreviewError(kgecLoadError);
          toast.error(kgecLoadError);
          return false;
        }
        try {
          const loaded = await loadLogoPayloadFromUrl(kgecLogoUrl, 'jpg');
          setKgecLogoPayload(loaded);
          config.logo = loaded;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unable to load KGEC logo.';
          setPreviewError(msg);
          toast.error(msg);
          return false;
        }
      }

      if (config.logoMode === 'custom' && !config.logo) {
        const msg =
          'No custom college logo uploaded. Please upload a PNG, JPG, JPEG, or SVG file, or switch to KGEC Logo / Without Logo.';
        setPreviewError(msg);
        setCustomLogoError(msg);
        toast.error(msg);
        return false;
      }

      setGeneratingPreview(true);
      setPreviewError(null);

      try {
        const pdfBytes = await generateFrontPagePdf(config);
        // Render page 1 of the generated PDF at high DPI (~2.2x) for razor-sharp 1:1 preview
        const renderedPngUrl = await renderPage(new Uint8Array(pdfBytes.slice(0)), 1, 2.2);

        if (requestId !== previewRequestIdRef.current) return false;

        setPreviewPdfBytes(pdfBytes);
        setPreviewImageUrl(renderedPngUrl);
        setHasGeneratedPreview(true);
        setPreviewDirty(false);

        if (scrollOnMobile && window.innerWidth < 1024) {
          setTimeout(() => {
            previewCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 80);
        }
        return true;
      } catch (err) {
        if (requestId !== previewRequestIdRef.current) return false;
        const message =
          err instanceof FrontPageError
            ? err.message
            : 'Failed to generate front page preview. Please check your inputs.';
        setPreviewError(message);
        toast.error(message);
        console.error('Front page preview generation failed:', err);
        return false;
      } finally {
        if (requestId === previewRequestIdRef.current) {
          setGeneratingPreview(false);
        }
      }
    },
    [buildCurrentConfig, kgecLoadError, renderPage]
  );

  // Snappy live refresh after initial preview has been generated
  useEffect(() => {
    if (!hasGeneratedPreview || !previewDirty) return;
    const timer = window.setTimeout(() => {
      if (!(logoMode === 'custom' && !customLogoPayload)) {
        void executeGeneratePreview(false);
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [hasGeneratedPreview, previewDirty, logoMode, customLogoPayload, executeGeneratePreview]);

  const handleResetHeaderDefaults = () => {
    setLogoMode('kgec');
    setLogoPosition('left');
    setLogoSizePt(DEFAULT_LOGO_SIZE_PT);
    setCollegeFontSizePt(DEFAULT_COLLEGE_FONT_SIZE_PT);
    setBorderMarginPt(DEFAULT_BORDER_MARGIN_PT);
    setCustomLogoError(null);
    setPreviewError(null);
    setDetails((prev) => ({ ...prev, collegeName: DEFAULT_COLLEGE_NAME }));
    markFormChanged();
    toast.success('College header settings reset to default');
  };

  const handleGenerateClick = async () => {
    const ok = await executeGeneratePreview(true);
    if (ok) {
      toast.success('A4 front page preview generated!');
    }
  };

  // Option A: Download Standalone Front Page PDF
  const handleDownloadFrontPage = async () => {
    const config = buildCurrentConfig();

    if (config.logoMode === 'custom' && !config.logo) {
      const msg =
        'No custom college logo uploaded. Please upload a PNG, JPG, JPEG, or SVG file, or select KGEC Logo / Without Logo.';
      setCustomLogoError(msg);
      setPreviewError(msg);
      toast.error(msg);
      return;
    }

    setDownloadingStandalone(true);
    try {
      if (config.logoMode === 'kgec' && !config.logo) {
        const loaded = await loadLogoPayloadFromUrl(kgecLogoUrl, 'jpg');
        setKgecLogoPayload(loaded);
        config.logo = loaded;
      }

      const freshBytes = await generateFrontPagePdf(config);
      setPreviewPdfBytes(freshBytes);
      setPreviewDirty(false);

      const fileName = buildFrontPageFilename(config.details);
      downloadBlob(createPdfBlob(freshBytes), fileName);
      toast.success(`Downloaded standalone front page (${fileName})`);
    } catch (err) {
      const message =
        err instanceof FrontPageError
          ? err.message
          : 'Failed to export standalone front page PDF.';
      setPreviewError(message);
      toast.error(message);
      console.error('Standalone download failed:', err);
    } finally {
      setDownloadingStandalone(false);
    }
  };

  // Existing PDF Selection & Strict Validation for Option B
  const handleExistingPdfSelected = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setValidatingExistingPdf(true);
    setExistingPdfError(null);
    setExistingPdf(null);

    try {
      const lower = file.name.toLowerCase();
      const mime = (file.type || '').toLowerCase();
      if (!lower.endsWith('.pdf') && mime !== 'application/pdf') {
        throw new FrontPageError(
          'INVALID_PDF',
          `"${file.name}" is not a PDF file. Please select a valid .pdf document.`
        );
      }

      const buffer = await readFileAsArrayBuffer(file);
      const info = await validateAndInspectExistingPdf(buffer, file.name);

      setExistingPdf({ file, buffer, info });
      toast.success(
        `Validated "${file.name}" (${info.pageCount} page${info.pageCount !== 1 ? 's' : ''})`
      );
    } catch (err) {
      if (err instanceof FrontPageError) {
        setExistingPdfError({ code: err.code, message: err.message });
        toast.error(err.message);
      } else {
        const msg = `Unable to read "${file.name}". Please ensure it is a valid PDF file.`;
        setExistingPdfError({ code: 'CORRUPTED_PDF', message: msg });
        toast.error(msg);
      }
    } finally {
      setValidatingExistingPdf(false);
    }
  }, []);

  // Option B: Merge Generated Front Page (as Page 1) with Existing PDF & Download
  const handleMergeAndDownload = async () => {
    if (!existingPdf) {
      const msg = 'Please upload an existing PDF document first.';
      setExistingPdfError({ code: 'INVALID_PDF', message: msg });
      toast.warning(msg);
      return;
    }

    const config = buildCurrentConfig();
    if (config.logoMode === 'custom' && !config.logo) {
      const msg =
        'No custom college logo uploaded. Please upload a valid logo or switch to KGEC Logo / Without Logo.';
      setCustomLogoError(msg);
      setPreviewError(msg);
      toast.error(msg);
      return;
    }

    setMergingPdf(true);
    try {
      if (config.logoMode === 'kgec' && !config.logo) {
        const loaded = await loadLogoPayloadFromUrl(kgecLogoUrl, 'jpg');
        setKgecLogoPayload(loaded);
        config.logo = loaded;
      }

      const freshFrontBytes = await generateFrontPagePdf(config);
      const mergeResult = await mergeFrontPageWithPdf(
        freshFrontBytes,
        existingPdf.buffer,
        existingPdf.file.name
      );

      const outputName = buildMergedPdfFilename(existingPdf.file.name);
      downloadBlob(createPdfBlob(mergeResult.pdfBytes), outputName);

      toast.success(
        `Downloaded "${outputName}" (${mergeResult.totalPages} pages: Front Page + ${mergeResult.originalPageCount} original pages preserved)`
      );
    } catch (err) {
      if (err instanceof FrontPageError) {
        if (
          err.code === 'INVALID_PDF' ||
          err.code === 'ENCRYPTED_PDF' ||
          err.code === 'CORRUPTED_PDF' ||
          err.code === 'PDF_MERGE_FAILED'
        ) {
          setExistingPdfError({ code: err.code, message: err.message });
        } else {
          setPreviewError(err.message);
        }
        toast.error(err.message);
      } else {
        const msg = 'Unexpected failure while merging the front page with your PDF.';
        setExistingPdfError({ code: 'PDF_MERGE_FAILED', message: msg });
        toast.error(msg);
      }
      console.error('Merge front page failed:', err);
    } finally {
      setMergingPdf(false);
    }
  };

  const handleLoadSample = () => {
    setDetails({ ...SAMPLE_DETAILS });
    markFormChanged();
    toast.success('Sample cover page details filled');
  };

  const handleClearDetails = () => {
    setDetails({
      collegeName: details.collegeName,
      mainTitle: '',
      assignmentTitle: '',
      name: '',
      rollNo: '',
      registrationNo: '',
      department: '',
      subject: '',
      subjectCode: '',
      semester: '',
      year: '',
    });
    markFormChanged();
    toast.info('Assignment and student fields cleared');
  };

  const openSaveProfileModal = () => {
    setSaveModalError(null);
    setSaveProfileOpen(true);
    void refreshSavedProfiles(true);
  };

  const openSavedProfilesModal = () => {
    setSavedProfilesOpen(true);
    void refreshSavedProfiles(savedProfiles.length > 0);
  };

  const handleSaveProfile = async (
    profileName: string,
    options: { overwriteExisting: boolean }
  ) => {
    setSavingProfile(true);
    setSaveModalError(null);
    try {
      const draft = createProfileDraftFromFormState({
        profileName,
        details,
        logoMode,
        logoPosition,
        logoSizePt,
        collegeFontSizePt,
        borderMarginPt,
        customLogoPayload,
        customLogoFileName: customLogoFile?.name || customLogoMeta?.fileName || null,
        customLogoFileSize: customLogoFile?.size ?? customLogoMeta?.fileSize ?? null,
      });

      const { profile, overwritten } = await saveFrontPageProfile(draft, {
        overwriteExisting: options.overwriteExisting,
      });

      await refreshSavedProfiles(true);
      setSaveProfileOpen(false);
      toast.success(
        overwritten
          ? `Updated saved profile "${profile.name}"`
          : `Saved profile "${profile.name}"`
      );
    } catch (err) {
      const msg =
        err instanceof ProfileStorageError
          ? err.message
          : 'Failed to save profile to local IndexedDB storage.';
      setSaveModalError(msg);
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLoadProfile = (profile: FrontPageProfile) => {
    const { collegeInfo } = profile;

    setLogoMode(collegeInfo.logoMode);
    setLogoPosition(collegeInfo.logoPosition);
    setLogoSizePt(collegeInfo.logoSizePt);
    setCollegeFontSizePt(collegeInfo.collegeFontSizePt);
    setBorderMarginPt(collegeInfo.borderMarginPt);

    if (collegeInfo.customLogo && collegeInfo.customLogo.bytes.byteLength > 0) {
      const restoredBytes = collegeInfo.customLogo.bytes.slice(0);
      const restoredPayload: LogoImagePayload = {
        bytes: restoredBytes,
        format: collegeInfo.customLogo.format,
        width: collegeInfo.customLogo.width,
        height: collegeInfo.customLogo.height,
      };
      const blobUrl = URL.createObjectURL(
        new Blob([restoredBytes as unknown as BlobPart], {
          type: collegeInfo.customLogo.format === 'png' ? 'image/png' : 'image/jpeg',
        })
      );
      setCustomLogoFile(null);
      setCustomLogoMeta({
        fileName: collegeInfo.customLogo.fileName,
        fileSize: collegeInfo.customLogo.fileSize,
      });
      setCustomLogoPayload(restoredPayload);
      setCustomLogoPreviewUrl(blobUrl);
    } else {
      setCustomLogoFile(null);
      setCustomLogoMeta(null);
      setCustomLogoPayload(null);
      setCustomLogoPreviewUrl(null);
    }

    // Populate college and student fields while keeping Main Title & Assignment Title untouched
    setDetails((prev) => applyProfileToDetails(prev, profile));
    setSavedProfilesOpen(false);

    if (
      collegeInfo.logoMode === 'custom' &&
      (!collegeInfo.customLogo || collegeInfo.customLogo.bytes.byteLength === 0)
    ) {
      const missingMsg =
        'Profile loaded, but no custom logo image was saved with it. Please upload a logo or select KGEC Logo / Without Logo.';
      setCustomLogoError(missingMsg);
      setPreviewError(missingMsg);
      setPreviewDirty(false);
      toast.warning(`Loaded "${profile.name}" (custom logo image missing)`);
      return;
    }

    setCustomLogoError(null);
    setPreviewError(null);
    setHasGeneratedPreview(true);
    setPreviewDirty(true);
    toast.success(`Loaded profile "${profile.name}"`);
  };

  const handleUpdateSavedProfile = async (
    id: string,
    patch: {
      name: string;
      collegeInfo: ProfileCollegeInfo;
      studentInfo: ProfileStudentInfo;
    }
  ) => {
    try {
      const updated = await updateFrontPageProfile(id, patch);
      await refreshSavedProfiles(true);
      toast.success(`Updated profile "${updated.name}"`);
    } catch (err) {
      const msg =
        err instanceof ProfileStorageError ? err.message : 'Failed to update saved profile.';
      toast.error(msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  };

  const handleDeleteSavedProfile = async (profile: FrontPageProfile) => {
    try {
      await deleteFrontPageProfile(profile.id);
      await refreshSavedProfiles(true);
      toast.success(`Deleted profile "${profile.name}"`);
    } catch (err) {
      const msg =
        err instanceof ProfileStorageError ? err.message : 'Failed to delete saved profile.';
      setProfilesStorageError(msg);
      toast.error(msg);
    }
  };

  const handleZoomIn = () => {
    setZoomMode((prev) => {
      const current = prev === 'fit' ? 1.0 : prev;
      return Math.min(2.0, Number((current + 0.2).toFixed(2)));
    });
  };

  const handleZoomOut = () => {
    setZoomMode((prev) => {
      const current = prev === 'fit' ? 1.0 : prev;
      return Math.max(0.5, Number((current - 0.2).toFixed(2)));
    });
  };

  const scrollToForm = () => {
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openMergePanel = () => {
    setShowMergePanel(true);
    setTimeout(() => {
      mergePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const currentConfig = buildCurrentConfig();
  const hasVisibleContent = hasAnyVisibleFrontPageContent(currentConfig);
  const areTitlesEmpty = !details.mainTitle.trim() && !details.assignmentTitle.trim();
  const isHeaderDefault =
    logoMode === 'kgec' &&
    logoPosition === 'left' &&
    logoSizePt === DEFAULT_LOGO_SIZE_PT &&
    collegeFontSizePt === DEFAULT_COLLEGE_FONT_SIZE_PT &&
    borderMarginPt === DEFAULT_BORDER_MARGIN_PT &&
    details.collegeName === DEFAULT_COLLEGE_NAME;
  const populatedStudentFieldCount = [
    details.name,
    details.rollNo,
    details.registrationNo,
    details.department,
    details.subject,
    details.subjectCode,
    details.semester,
    details.year,
  ].filter((v) => v.trim().length > 0).length;

  return (
    <div className="container mx-auto px-2.5 sm:px-4 py-5 sm:py-8 max-w-7xl overflow-x-hidden">
      {/* Page Header */}
      <div className="mb-5 sm:mb-8">
        <div className="flex flex-wrap items-start sm:items-center gap-2.5 sm:gap-3 mb-2">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl max-[399px]:text-lg sm:text-3xl font-bold tracking-tight">
                Front Page Generator
              </h1>
              <Badge variant="secondary" className="text-[11px] shrink-0">
                A4 Portrait
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-relaxed">
              Design an academic assignment cover page, inspect the 1:1 A4 preview, download standalone or insert it as Page 1 of any PDF.
            </p>
          </div>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
        {/* LEFT COLUMN: Configuration & Form */}
        <div ref={formCardRef} className="lg:col-span-6 space-y-5 min-w-0">
          {/* Card 1: College Logo & Page Frame */}
          <Card className="overflow-hidden">
            <CardHeader className="p-4 max-[399px]:p-3.5 sm:p-6 pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                    <span className="leading-snug">1. College Logo &amp; Header</span>
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Choose the default KGEC crest, upload your own college logo, or generate without a logo.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetHeaderDefaults}
                  disabled={isHeaderDefault}
                  className="h-auto min-h-7 py-1 text-xs px-2.5 gap-1 shrink-0 whitespace-normal"
                  title="Reset logo, college name, font size, position, and border margin to defaults"
                >
                  <RotateCcw className="h-3 w-3 shrink-0" />
                  <span>Reset to Default</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 max-[399px]:p-3.5 sm:p-6 pt-0 space-y-4">
              {/* 3 Logo Mode Options */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {/* KGEC Logo Default */}
                <button
                  type="button"
                  onClick={() => handleLogoModeChange('kgec')}
                  className={cn(
                    'flex md:flex-col items-center md:justify-center gap-3 md:gap-2 p-3 rounded-xl border text-left md:text-center transition-all touch-manipulation w-full min-w-0',
                    logoMode === 'kgec'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/50'
                  )}
                >
                  <div className="h-10 w-10 rounded-lg bg-white border p-1 flex items-center justify-center shrink-0 overflow-hidden">
                    <img
                      src={kgecLogoUrl}
                      alt="KGEC Official Crest"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-xs font-semibold flex flex-wrap items-center md:justify-center gap-1.5">
                      <span>KGEC Logo</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-medium">
                        Default
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Offline official crest
                    </p>
                  </div>
                </button>

                {/* Upload Custom Logo */}
                <button
                  type="button"
                  onClick={() => handleLogoModeChange('custom')}
                  className={cn(
                    'flex md:flex-col items-center md:justify-center gap-3 md:gap-2 p-3 rounded-xl border text-left md:text-center transition-all touch-manipulation w-full min-w-0',
                    logoMode === 'custom'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/50'
                  )}
                >
                  <div className="h-10 w-10 rounded-lg bg-muted border flex items-center justify-center shrink-0 overflow-hidden">
                    {customLogoPreviewUrl ? (
                      <img
                        src={customLogoPreviewUrl}
                        alt="Custom Logo Preview"
                        className="h-full w-full object-contain bg-white"
                      />
                    ) : (
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-xs font-semibold">Custom Logo</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      PNG, JPG, JPEG, SVG
                    </p>
                  </div>
                </button>

                {/* Without Logo */}
                <button
                  type="button"
                  onClick={() => handleLogoModeChange('none')}
                  className={cn(
                    'flex md:flex-col items-center md:justify-center gap-3 md:gap-2 p-3 rounded-xl border text-left md:text-center transition-all touch-manipulation w-full min-w-0',
                    logoMode === 'none'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/50'
                  )}
                >
                  <div className="h-10 w-10 rounded-lg bg-muted border flex items-center justify-center shrink-0">
                    <Ban className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-xs font-semibold">Without Logo</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Text-only header
                    </p>
                  </div>
                </button>
              </div>

              {/* Custom Logo Uploader Panel */}
              {logoMode === 'custom' && (
                <div className="space-y-2.5 p-2.5 sm:p-3 rounded-xl border bg-muted/20 min-w-0">
                  <input
                    ref={customLogoInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      handleCustomLogoSelected(e.target.files?.[0]);
                      if (customLogoInputRef.current) customLogoInputRef.current.value = '';
                    }}
                  />

                  {customLogoPayload && customLogoPreviewUrl ? (
                    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 p-2.5 rounded-lg border bg-card min-w-0">
                      <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-md border bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src={customLogoPreviewUrl}
                          alt="Uploaded custom logo"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <p className="text-xs font-semibold break-words [overflow-wrap:anywhere] leading-snug">
                          {customLogoFile?.name || customLogoMeta?.fileName || 'Custom Logo'}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {customLogoPayload.width} × {customLogoPayload.height} px •{' '}
                          {(customLogoFile?.size ?? customLogoMeta?.fileSize)
                            ? `${formatFileSize(customLogoFile?.size ?? customLogoMeta!.fileSize)} • `
                            : ''}
                          Aspect ratio locked
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-auto">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => customLogoInputRef.current?.click()}
                          disabled={loadingLogo}
                        >
                          Replace
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={clearCustomLogo}
                          title="Remove uploaded logo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingLogo(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingLogo(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingLogo(false);
                        handleCustomLogoSelected(e.dataTransfer.files?.[0]);
                      }}
                      onClick={() => customLogoInputRef.current?.click()}
                      className={cn(
                        'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-all',
                        isDraggingLogo
                          ? 'border-primary bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40'
                      )}
                    >
                      {loadingLogo ? (
                        <>
                          <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                          <p className="text-xs font-medium">Validating &amp; preparing logo...</p>
                        </>
                      ) : (
                        <>
                          <Upload className="h-6 w-6 text-muted-foreground mb-1.5" />
                          <p className="text-xs font-semibold">
                            Drop your college logo here, or click to browse
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Supports PNG, JPG, JPEG, SVG (Max 10 MB) · Aspect ratio preserved
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {customLogoError && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{customLogoError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Editable College Name */}
              <div className="space-y-1.5 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="fp-college-name" className="text-xs font-semibold">
                    College / Institution Name
                  </Label>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {details.collegeName !== DEFAULT_COLLEGE_NAME && (
                      <button
                        type="button"
                        onClick={() => updateDetailField('collegeName', DEFAULT_COLLEGE_NAME)}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                      >
                        <RotateCcw className="h-3 w-3 shrink-0" />
                        Reset KGEC
                      </button>
                    )}
                    {details.collegeName.length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateDetailField('collegeName', '')}
                        className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3 shrink-0" />
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <Input
                  id="fp-college-name"
                  value={details.collegeName}
                  onChange={(e) => updateDetailField('collegeName', e.target.value)}
                  placeholder="Enter college name (optional)"
                  className="text-sm"
                />
              </div>

              {/* Typography, Logo & Border Margin Tuning */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between text-xs">
                    <Label htmlFor="fp-college-font-size" className="text-xs font-medium">
                      College Name Font Size
                    </Label>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {collegeFontSizePt} pt
                    </span>
                  </div>
                  <Slider
                    id="fp-college-font-size"
                    value={[collegeFontSizePt]}
                    min={MIN_COLLEGE_FONT_SIZE_PT}
                    max={MAX_COLLEGE_FONT_SIZE_PT}
                    step={1}
                    onValueChange={([v]) => {
                      setCollegeFontSizePt(v);
                      markFormChanged();
                    }}
                  />
                </div>

                {logoMode !== 'none' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <Label className="text-xs font-medium">Logo Size</Label>
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {logoSizePt} pt
                      </span>
                    </div>
                    <Slider
                      value={[logoSizePt]}
                      min={MIN_LOGO_SIZE_PT}
                      max={MAX_LOGO_SIZE_PT}
                      step={2}
                      onValueChange={([v]) => {
                        setLogoSizePt(v);
                        markFormChanged();
                      }}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <Label className="text-xs font-medium">Page Border Margin</Label>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {borderMarginPt} pt
                    </span>
                  </div>
                  <Slider
                    value={[borderMarginPt]}
                    min={MIN_BORDER_MARGIN_PT}
                    max={MAX_BORDER_MARGIN_PT}
                    step={2}
                    onValueChange={([v]) => {
                      setBorderMarginPt(v);
                      markFormChanged();
                    }}
                  />
                </div>

                {logoMode !== 'none' && (
                  <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5 min-w-0">
                    <Label className="text-xs font-medium">Logo Position</Label>
                    <div className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto rounded-lg border border-border/60 bg-muted/60 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setLogoPosition('left');
                          markFormChanged();
                        }}
                        className={cn(
                          'px-2.5 py-1.5 sm:py-1 rounded-md transition-colors text-center whitespace-normal leading-tight',
                          logoPosition === 'left'
                            ? 'bg-card text-foreground font-semibold shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Top-Left (Classic)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLogoPosition('center');
                          markFormChanged();
                        }}
                        className={cn(
                          'px-2.5 py-1.5 sm:py-1 rounded-md transition-colors text-center whitespace-normal leading-tight',
                          logoPosition === 'center'
                            ? 'bg-card text-foreground font-semibold shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Top-Center
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Main Heading */}
          <Card className="overflow-hidden">
            <CardHeader className="p-4 max-[399px]:p-3.5 sm:p-6 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">2. Main Heading</CardTitle>
                  <CardDescription className="text-xs">
                    Both heading fields are optional and centered cleanly above the student section.
                  </CardDescription>
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLoadSample}
                    className="h-auto min-h-7 py-1 text-xs px-2 sm:px-2.5 gap-1 whitespace-normal text-center"
                  >
                    <Sparkles className="h-3 w-3 text-teal shrink-0" />
                    <span>Fill Sample</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openSaveProfileModal}
                    className="h-auto min-h-7 py-1 text-xs px-2 sm:px-2.5 gap-1 whitespace-normal text-center"
                  >
                    <BookmarkPlus className="h-3 w-3 text-primary shrink-0" />
                    <span>Save Details</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openSavedProfilesModal}
                    className="h-auto min-h-7 py-1 text-xs px-2 sm:px-2.5 gap-1 whitespace-normal text-center"
                  >
                    <FolderOpen className="h-3 w-3 text-primary shrink-0" />
                    <span>Saved Profiles</span>
                    {savedProfiles.length > 0 && (
                      <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0 text-[10px] font-semibold text-primary shrink-0">
                        {savedProfiles.length}
                      </span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearDetails}
                    className="h-auto min-h-7 py-1 text-xs px-2 text-muted-foreground hover:text-destructive whitespace-normal text-center"
                  >
                    Clear Fields
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 max-[399px]:p-3.5 sm:p-6 pt-0 space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="fp-main-title" className="text-xs font-semibold">
                  Main Title
                </Label>
                <Input
                  id="fp-main-title"
                  value={details.mainTitle}
                  onChange={(e) => updateDetailField('mainTitle', e.target.value)}
                  placeholder="e.g. Object Oriented Programming Lab"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fp-assignment-title" className="text-xs font-semibold">
                  Assignment Title
                </Label>
                <Input
                  id="fp-assignment-title"
                  value={details.assignmentTitle}
                  onChange={(e) => updateDetailField('assignmentTitle', e.target.value)}
                  placeholder="e.g. Lab Assignment I"
                />
              </div>

              {areTitlesEmpty && (
                <div className="flex items-start gap-2 rounded-lg border border-muted-foreground/25 bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-primary/70" />
                  <span>
                    Both title fields are currently empty. Leave them blank to omit headings cleanly, enter your own titles above, or click <strong className="text-foreground">Fill Sample</strong>.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Student Details */}
          <Card className="overflow-hidden">
            <CardHeader className="p-4 max-[399px]:p-3.5 sm:p-6 pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">3. Student Details</CardTitle>
                  <CardDescription className="text-xs">
                    All fields are optional — blank fields are omitted automatically with no gaps or stray colons.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-[11px] shrink-0">
                  {populatedStudentFieldCount}/8 filled
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 max-[399px]:p-3.5 sm:p-6 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="fp-name" className="text-xs font-semibold">
                    Name
                  </Label>
                  <Input
                    id="fp-name"
                    value={details.name}
                    onChange={(e) => updateDetailField('name', e.target.value)}
                    placeholder="e.g. Dip Mondal"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-roll" className="text-xs font-semibold">
                    Roll No.
                  </Label>
                  <Input
                    id="fp-roll"
                    value={details.rollNo}
                    onChange={(e) => updateDetailField('rollNo', e.target.value)}
                    placeholder="e.g. 10200100001"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-reg" className="text-xs font-semibold">
                    Registration No.
                  </Label>
                  <Input
                    id="fp-reg"
                    value={details.registrationNo}
                    onChange={(e) => updateDetailField('registrationNo', e.target.value)}
                    placeholder="e.g. 241020100001"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-dept" className="text-xs font-semibold">
                    Department
                  </Label>
                  <Input
                    id="fp-dept"
                    value={details.department}
                    onChange={(e) => updateDetailField('department', e.target.value)}
                    placeholder="e.g. Computer Science and Engineering"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-subject" className="text-xs font-semibold">
                    Subject
                  </Label>
                  <Input
                    id="fp-subject"
                    value={details.subject}
                    onChange={(e) => updateDetailField('subject', e.target.value)}
                    placeholder="e.g. Object Oriented Programming Lab"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-subject-code" className="text-xs font-semibold">
                    Subject Code
                  </Label>
                  <Input
                    id="fp-subject-code"
                    value={details.subjectCode}
                    onChange={(e) => updateDetailField('subjectCode', e.target.value)}
                    placeholder="e.g. PCC-CS 593"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-semester" className="text-xs font-semibold">
                    Semester
                  </Label>
                  <Input
                    id="fp-semester"
                    value={details.semester}
                    onChange={(e) => updateDetailField('semester', e.target.value)}
                    placeholder="e.g. 5th"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-year" className="text-xs font-semibold">
                    Year
                  </Label>
                  <Input
                    id="fp-year"
                    value={details.year}
                    onChange={(e) => updateDetailField('year', e.target.value)}
                    placeholder="e.g. 2026 - 2027"
                  />
                </div>
              </div>

              {!hasVisibleContent && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    All text fields and logo are currently empty. You can still generate an empty bordered A4 page, or fill in your details above.
                  </span>
                </div>
              )}

              {/* Primary Generate Preview Button */}
              <div className="mt-5 pt-4 border-t">
                <Button
                  type="button"
                  size="lg"
                  onClick={handleGenerateClick}
                  disabled={generatingPreview}
                  className="w-full max-w-full min-w-0 box-border h-auto min-h-11 px-4 sm:px-6 py-2.5 whitespace-normal break-words text-center font-semibold text-sm max-[399px]:text-xs leading-snug gap-2"
                >
                  {generatingPreview ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span className="min-w-0">Generating Preview...</span>
                    </>
                  ) : hasGeneratedPreview ? (
                    <>
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">Regenerate Preview</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">Generate Preview</span>
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Sticky A4 Preview & Output Actions */}
        <div ref={previewCardRef} className="lg:col-span-6 space-y-5 lg:sticky lg:top-20 min-w-0">
          <Card className="overflow-hidden">
            <CardHeader className="p-4 max-[399px]:p-3.5 sm:p-6 pb-3 border-b bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Eye className="h-4 w-4 text-primary shrink-0" />
                  <CardTitle className="text-base leading-snug">A4 Front Page Preview</CardTitle>
                  {hasGeneratedPreview && previewDirty && !generatingPreview && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500 shrink-0">
                      Updating...
                    </Badge>
                  )}
                </div>

                {/* Zoom & Navigation Controls */}
                <div className="flex flex-wrap items-center gap-1 shrink-0">
                  {hasGeneratedPreview && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleZoomOut}
                        disabled={zoomMode !== 'fit' && zoomMode <= 0.5}
                        title="Zoom Out"
                      >
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-[11px] font-medium px-1.5 min-w-[42px] text-center">
                        {zoomMode === 'fit' ? 'Fit' : `${Math.round(zoomMode * 100)}%`}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={handleZoomIn}
                        disabled={zoomMode !== 'fit' && zoomMode >= 2.0}
                        title="Zoom In"
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant={zoomMode === 'fit' ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setZoomMode('fit')}
                        title="Fit to preview width"
                      >
                        <Maximize2 className="h-3 w-3 mr-1" />
                        Fit
                      </Button>
                    </>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] lg:hidden"
                    onClick={scrollToForm}
                  >
                    <ArrowLeft className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-3 sm:p-5 bg-surface-secondary dark:bg-background/70">
              {previewError && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">Preview Could Not Be Generated</p>
                    <p>{previewError}</p>
                  </div>
                </div>
              )}

              {!hasGeneratedPreview || !previewImageUrl ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/90 p-5 sm:p-12 text-center min-h-[280px] sm:min-h-[380px]">
                  {generatingPreview ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                      <p className="text-sm font-semibold">Rendering A4 Front Page PDF...</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Building vector layout and live preview
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
                        <FileText className="h-7 w-7" />
                      </div>
                      <p className="text-sm sm:text-base font-semibold">No Preview Generated Yet</p>
                      <p className="text-xs text-muted-foreground max-w-sm mt-1.5 mb-5">
                        Configure your college logo, heading, and student details, then click{' '}
                        <strong className="text-foreground">Generate Preview</strong> to view the exact A4 PDF page.
                      </p>
                      <Button
                        type="button"
                        onClick={handleGenerateClick}
                        disabled={generatingPreview}
                        className="w-full sm:w-auto max-w-full box-border h-auto min-h-10 px-4 py-2 whitespace-normal text-center gap-2"
                      >
                        <Eye className="h-4 w-4 shrink-0" />
                        <span>Generate Preview</span>
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Scrollable Preview Sheet Viewport */}
                  <div className="max-h-[600px] max-w-full overflow-auto rounded-lg p-1.5 sm:p-2">
                    <div
                      className="relative mx-auto bg-white shadow-xl border border-slate-300 dark:border-slate-700 transition-all duration-150 shrink-0"
                      style={{
                        width: zoomMode === 'fit' ? 'min(100%, 460px)' : `${Math.round(460 * zoomMode)}px`,
                        aspectRatio: '595.28 / 841.89',
                      }}
                    >
                      {generatingPreview && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      )}
                      <img
                        src={previewImageUrl}
                        alt="Generated A4 Front Page Preview"
                        className="w-full h-full object-contain block select-none"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                    <span>Exact 1:1 A4 Portrait PDF preview (595.28 × 841.89 pt)</span>
                    <button
                      type="button"
                      onClick={scrollToForm}
                      className="text-primary hover:underline font-medium"
                    >
                      Back to edit details
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Output Options Card (shown prominently after preview, and also available directly) */}
          {hasGeneratedPreview && previewPdfBytes && (
            <Card className="overflow-hidden">
              <CardHeader className="p-4 max-[399px]:p-3.5 sm:p-6 pb-3">
                <CardTitle className="text-base">4. Export &amp; Output Options</CardTitle>
                <CardDescription className="text-xs">
                  Download the standalone cover sheet or prepend it as Page 1 of an existing PDF.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 max-[399px]:p-3.5 sm:p-6 pt-0 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
                  {/* Option A: Download Front Page */}
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleDownloadFrontPage}
                    disabled={downloadingStandalone || generatingPreview}
                    className="w-full max-w-full min-w-0 box-border h-auto min-h-[60px] py-2.5 sm:py-3 px-3 sm:px-4 flex flex-col items-center justify-center gap-1 whitespace-normal text-center"
                  >
                    <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 font-semibold text-[13px] max-[399px]:text-xs sm:text-sm leading-snug max-w-full">
                      {downloadingStandalone ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <Download className="h-4 w-4 shrink-0" />
                      )}
                      <span>Download Front Page</span>
                    </span>
                    <span className="text-[11px] font-normal opacity-85 w-full max-w-full text-center leading-snug whitespace-normal break-words [overflow-wrap:anywhere] md:truncate">
                      {buildFrontPageFilename(details)}
                    </span>
                  </Button>

                  {/* Option B: Add to Existing PDF */}
                  <Button
                    type="button"
                    variant={showMergePanel ? 'secondary' : 'outline'}
                    size="lg"
                    onClick={openMergePanel}
                    className="w-full max-w-full min-w-0 box-border h-auto min-h-[60px] py-2.5 sm:py-3 px-3 sm:px-4 flex flex-col items-center justify-center gap-1 whitespace-normal text-center border-primary/40"
                  >
                    <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 font-semibold text-[13px] max-[399px]:text-xs sm:text-sm leading-snug max-w-full">
                      <FilePlus2 className="h-4 w-4 text-primary shrink-0" />
                      <span>Add to Existing PDF</span>
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground w-full max-w-full text-center leading-snug whitespace-normal break-words">
                      Insert front page as Page 1
                    </span>
                  </Button>
                </div>

                {/* Option B Panel: Upload & Merge with Existing PDF */}
                {showMergePanel && (
                  <div
                    ref={mergePanelRef}
                    className="rounded-xl border bg-muted/20 p-3 sm:p-4 space-y-3 sm:space-y-4 transition-all min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold flex items-start sm:items-center gap-1.5 leading-snug">
                          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5 sm:mt-0" />
                          <span>Prepend Front Page to Existing PDF</span>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Generated front page becomes Page 1. Original pages stay intact in exact order without quality loss.
                        </p>
                      </div>
                    </div>

                    <input
                      ref={existingPdfInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        handleExistingPdfSelected(e.target.files?.[0]);
                        if (existingPdfInputRef.current) existingPdfInputRef.current.value = '';
                      }}
                    />

                    {/* Upload Dropzone */}
                    {!existingPdf ? (
                      <div
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDraggingExistingPdf(true);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDraggingExistingPdf(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsDraggingExistingPdf(false);
                          handleExistingPdfSelected(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => existingPdfInputRef.current?.click()}
                        className={cn(
                          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 sm:p-6 text-center cursor-pointer transition-colors bg-card',
                          isDraggingExistingPdf
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50 hover:bg-primary/[0.03]'
                        )}
                      >
                        {validatingExistingPdf ? (
                          <>
                            <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                            <p className="text-xs font-semibold">Validating PDF structure...</p>
                          </>
                        ) : (
                          <>
                            <Upload className="h-7 w-7 text-muted-foreground mb-2" />
                            <p className="text-sm font-semibold">
                              Drop existing PDF here, or click to upload
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Supports single &amp; multi-page PDFs (portrait, landscape, or mixed sizes) up to 100 MB
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 min-w-0">
                        {/* Validated PDF Summary Card */}
                        <div className="rounded-lg border bg-card p-2.5 sm:p-3 space-y-2.5 min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
                            <div className="flex items-start gap-2.5 min-w-0 flex-1 basis-[165px]">
                              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                <CheckCircle2 className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs sm:text-sm font-semibold leading-snug whitespace-normal break-words [overflow-wrap:anywhere]">
                                  {existingPdf.file.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                  {existingPdf.info.pageCount} original page
                                  {existingPdf.info.pageCount !== 1 ? 's' : ''} •{' '}
                                  {formatFileSize(existingPdf.file.size)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-auto">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={() => existingPdfInputRef.current?.click()}
                                disabled={mergingPdf}
                              >
                                Change
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setExistingPdf(null);
                                  setExistingPdfError(null);
                                }}
                                disabled={mergingPdf}
                                title="Remove PDF"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          {/* Page Sequence & Orientation Summary */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] min-w-0">
                            <Badge variant="secondary" className="text-[10px] max-w-full whitespace-normal text-left leading-tight">
                              Final Output: {existingPdf.info.pageCount + 1} Pages
                            </Badge>
                            <Badge variant="outline" className="text-[10px] max-w-full whitespace-normal text-left leading-tight">
                              Page 1: Front Page (A4)
                            </Badge>
                            <Badge variant="outline" className="text-[10px] max-w-full whitespace-normal text-left leading-tight">
                              Pages 2–{existingPdf.info.pageCount + 1}: Original Pages Preserved
                            </Badge>
                            {existingPdf.info.hasLandscapePages && (
                              <Badge variant="outline" className="text-[10px] max-w-full whitespace-normal text-left leading-tight">
                                Contains Landscape Pages
                              </Badge>
                            )}
                          </div>

                          {(existingPdf.info.hasUnusualDimensions || existingPdf.info.hasMixedDimensions) && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>
                                {existingPdf.info.hasMixedDimensions
                                  ? 'Mixed page dimensions detected. '
                                  : 'Unusual page dimensions detected. '}
                                All original page sizes, orientations, and content will be preserved untouched after Page 1.
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Merge & Download CTA */}
                        <Button
                          type="button"
                          size="lg"
                          onClick={handleMergeAndDownload}
                          disabled={mergingPdf || generatingPreview}
                          className="w-full max-w-full min-w-0 box-border h-auto min-h-11 px-3 sm:px-6 py-2.5 sm:py-3 whitespace-normal break-words text-center font-semibold text-[13px] max-[399px]:text-xs sm:text-sm leading-snug gap-2"
                        >
                          {mergingPdf ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                              <span className="min-w-0">
                                Adding Front Page &amp; Building Final PDF...
                              </span>
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 shrink-0" />
                              <span className="min-w-0">
                                Add Front Page as Page 1 &amp; Download{' '}
                                <span className="whitespace-nowrap">
                                  ({existingPdf.info.pageCount + 1} Pages)
                                </span>
                              </span>
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Error Display for Invalid / Encrypted / Corrupted PDFs */}
                    {existingPdfError && (
                      <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="space-y-1.5">
                          <p>{existingPdfError.message}</p>
                          {existingPdfError.code === 'ENCRYPTED_PDF' && (
                            <Link
                              to="/protect-pdf"
                              className="inline-flex items-center font-semibold underline hover:opacity-80"
                            >
                              Open Protect &amp; Unlock tool →
                            </Link>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Save Profile Modal */}
      <SaveProfileDialog
        open={saveProfileOpen}
        onOpenChange={setSaveProfileOpen}
        existingProfiles={savedProfiles}
        summary={{
          collegeName: details.collegeName,
          studentName: details.name,
          populatedStudentCount: populatedStudentFieldCount,
          logoMode,
          logoPosition,
          hasCustomLogo: Boolean(customLogoPayload),
          collegeFontSizePt,
          logoSizePt,
          borderMarginPt,
        }}
        saving={savingProfile}
        storageError={saveModalError}
        onSave={handleSaveProfile}
      />

      {/* Saved Profiles Modal (Load, Edit, Delete) */}
      <SavedProfilesDialog
        open={savedProfilesOpen}
        onOpenChange={setSavedProfilesOpen}
        profiles={savedProfiles}
        loading={loadingProfiles}
        storageError={profilesStorageError}
        currentSnapshot={{
          details,
          logoMode,
          logoPosition,
          logoSizePt,
          collegeFontSizePt,
          borderMarginPt,
          customLogoPayload,
          customLogoFileName: customLogoFile?.name || customLogoMeta?.fileName || null,
          customLogoFileSize: customLogoFile?.size ?? customLogoMeta?.fileSize ?? null,
        }}
        onLoadProfile={handleLoadProfile}
        onUpdateProfile={handleUpdateSavedProfile}
        onDeleteProfile={handleDeleteSavedProfile}
        onRequestSaveNew={openSaveProfileModal}
      />
    </div>
  );
}
