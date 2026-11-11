import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  BookmarkPlus,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  Save,
  Search,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import kgecLogoUrl from '@/assets/kgec-logo.jpg';
import { cn, formatFileSize } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
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
  prepareLogoImageFromFile,
} from '@/lib/frontPage/frontPagePdfEngine';
import {
  FrontPageProfile,
  MAX_PROFILE_NAME_LENGTH,
  ProfileCollegeInfo,
  ProfileStudentInfo,
  StoredCustomLogo,
  findDuplicateProfile,
  normalizeProfileName,
} from '@/lib/frontPage/frontPageProfilesDb';

export interface SaveProfileSummary {
  collegeName: string;
  studentName: string;
  populatedStudentCount: number;
  logoMode: LogoMode;
  logoPosition: LogoPosition;
  hasCustomLogo: boolean;
  collegeFontSizePt: number;
  logoSizePt: number;
  borderMarginPt: number;
}

export interface CurrentFormProfileSnapshot {
  details: FrontPageDetails;
  logoMode: LogoMode;
  logoPosition: LogoPosition;
  logoSizePt: number;
  collegeFontSizePt: number;
  borderMarginPt: number;
  customLogoPayload: LogoImagePayload | null;
  customLogoFileName?: string | null;
  customLogoFileSize?: number | null;
}

function formatLogoModeLabel(mode: LogoMode): string {
  if (mode === 'kgec') return 'KGEC Logo';
  if (mode === 'custom') return 'Custom Logo';
  return 'Without Logo';
}

function CustomLogoThumbnail({
  logo,
  alt,
  className,
}: {
  logo: StoredCustomLogo;
  alt: string;
  className?: string;
}) {
  const blobUrl = useMemo(() => {
    const mime = logo.format === 'png' ? 'image/png' : 'image/jpeg';
    return URL.createObjectURL(new Blob([logo.bytes as unknown as BlobPart], { type: mime }));
  }, [logo]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  return <img src={blobUrl} alt={alt} className={className} />;
}

interface SaveProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingProfiles: FrontPageProfile[];
  summary: SaveProfileSummary;
  saving: boolean;
  storageError: string | null;
  onSave: (profileName: string, options: { overwriteExisting: boolean }) => Promise<void>;
}

export function SaveProfileDialog({
  open,
  onOpenChange,
  existingProfiles,
  summary,
  saving,
  storageError,
  onSave,
}: SaveProfileDialogProps) {
  const [profileName, setProfileName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setProfileName('');
      setValidationError(null);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const normalizedName = normalizeProfileName(profileName);
  const duplicateProfile = useMemo(
    () => findDuplicateProfile(existingProfiles, profileName),
    [existingProfiles, profileName]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!normalizedName) {
      setValidationError('Please enter a profile name (for example: "My KGEC Profile").');
      return;
    }

    if (normalizedName.length > MAX_PROFILE_NAME_LENGTH) {
      setValidationError(
        `Profile name must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`
      );
      return;
    }

    if (duplicateProfile) {
      setValidationError(
        `A profile named "${duplicateProfile.name}" already exists. Choose a different name or click Overwrite Existing below.`
      );
      return;
    }

    setValidationError(null);
    await onSave(normalizedName, { overwriteExisting: false });
  };

  const handleOverwriteClick = async () => {
    if (saving || !normalizedName || !duplicateProfile) return;
    setValidationError(null);
    await onSave(normalizedName, { overwriteExisting: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookmarkPlus className="h-4 w-4 text-primary" />
            Save Details as Profile
          </DialogTitle>
          <DialogDescription className="text-xs">
            Save your college and student details locally in browser storage for quick reuse later. Main Title and Assignment Title are excluded automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fp-profile-name-input" className="text-xs font-semibold">
              Profile Name
            </Label>
            <Input
              ref={inputRef}
              id="fp-profile-name-input"
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="e.g. My KGEC Profile"
              maxLength={MAX_PROFILE_NAME_LENGTH}
              disabled={saving}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Examples: My KGEC Profile, Friend&apos;s Profile, Project Report Profile
            </p>
          </div>

          {duplicateProfile && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                A profile named <strong className="font-semibold">&ldquo;{duplicateProfile.name}&rdquo;</strong> already exists. Enter a unique name to create a new profile, or click <strong className="font-semibold">Overwrite Existing</strong> to update it.
              </span>
            </div>
          )}

          {validationError && !duplicateProfile && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {storageError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{storageError}</span>
            </div>
          )}

          {/* Snapshot Preview Box */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">
              Information Included
            </p>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">College:</span>
                <span className="font-medium truncate text-right">
                  {summary.collegeName.trim() || (
                    <span className="italic text-muted-foreground">Empty</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Logo &amp; Header:</span>
                <span className="font-medium text-right">
                  {formatLogoModeLabel(summary.logoMode)}
                  {summary.logoMode === 'custom' && !summary.hasCustomLogo ? ' (no image)' : ''} ·{' '}
                  {summary.collegeFontSizePt}pt · Border {summary.borderMarginPt}pt
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Student:</span>
                <span className="font-medium truncate text-right">
                  {summary.studentName.trim() || (
                    <span className="italic text-muted-foreground">Not specified</span>
                  )}{' '}
                  ({summary.populatedStudentCount}/8 fields)
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            {duplicateProfile ? (
              <Button
                type="button"
                onClick={handleOverwriteClick}
                disabled={saving || !normalizedName}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Overwrite Existing
                  </>
                )}
              </Button>
            ) : (
              <Button type="submit" disabled={saving || !normalizedName}>
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save Profile
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SavedProfilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: FrontPageProfile[];
  loading: boolean;
  storageError: string | null;
  currentSnapshot: CurrentFormProfileSnapshot;
  onLoadProfile: (profile: FrontPageProfile) => void;
  onUpdateProfile: (
    id: string,
    patch: {
      name: string;
      collegeInfo: ProfileCollegeInfo;
      studentInfo: ProfileStudentInfo;
    }
  ) => Promise<void>;
  onDeleteProfile: (profile: FrontPageProfile) => Promise<void>;
  onRequestSaveNew: () => void;
}

export function SavedProfilesDialog({
  open,
  onOpenChange,
  profiles,
  loading,
  storageError,
  currentSnapshot,
  onLoadProfile,
  onUpdateProfile,
  onDeleteProfile,
  onRequestSaveNew,
}: SavedProfilesDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Edit profile state
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCollege, setEditCollege] = useState<ProfileCollegeInfo | null>(null);
  const [editStudent, setEditStudent] = useState<ProfileStudentInfo | null>(null);
  const [editCustomLogoCache, setEditCustomLogoCache] = useState<StoredCustomLogo | null>(null);
  const [editLogoLoading, setEditLogoLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const editLogoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setConfirmDeleteId(null);
      setEditingProfileId(null);
      setEditCollege(null);
      setEditStudent(null);
      setEditCustomLogoCache(null);
      setEditError(null);
    }
  }, [open]);

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        p.collegeInfo.collegeName.toLowerCase().includes(q) ||
        p.studentInfo.name.toLowerCase().includes(q) ||
        p.studentInfo.department.toLowerCase().includes(q) ||
        p.studentInfo.subject.toLowerCase().includes(q)
      );
    });
  }, [profiles, searchQuery]);

  const startEditProfile = (profile: FrontPageProfile) => {
    setConfirmDeleteId(null);
    setEditingProfileId(profile.id);
    setEditName(profile.name);
    const clonedLogo = profile.collegeInfo.customLogo
      ? {
          ...profile.collegeInfo.customLogo,
          bytes: profile.collegeInfo.customLogo.bytes.slice(0),
        }
      : null;
    setEditCollege({
      ...profile.collegeInfo,
      customLogo: clonedLogo,
    });
    setEditCustomLogoCache(clonedLogo);
    setEditStudent({ ...profile.studentInfo });
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingProfileId(null);
    setEditCollege(null);
    setEditStudent(null);
    setEditCustomLogoCache(null);
    setEditError(null);
  };

  const copyFromCurrentForm = () => {
    const snap = currentSnapshot;
    let nextCustomLogo = editCustomLogoCache;
    if (snap.customLogoPayload && snap.customLogoPayload.bytes.byteLength > 0) {
      const format = snap.customLogoPayload.format;
      nextCustomLogo = {
        bytes: snap.customLogoPayload.bytes.slice(0),
        format,
        width: snap.customLogoPayload.width,
        height: snap.customLogoPayload.height,
        fileName: snap.customLogoFileName?.trim() || `custom-logo.${format}`,
        fileSize: snap.customLogoFileSize || snap.customLogoPayload.bytes.byteLength,
      };
      setEditCustomLogoCache(nextCustomLogo);
    } else if (snap.logoMode === 'custom') {
      nextCustomLogo = null;
      setEditCustomLogoCache(null);
    }

    setEditCollege({
      collegeName: snap.details.collegeName,
      logoMode: snap.logoMode,
      logoPosition: snap.logoPosition,
      logoSizePt: snap.logoSizePt,
      collegeFontSizePt: snap.collegeFontSizePt,
      borderMarginPt: snap.borderMarginPt,
      customLogo: snap.logoMode === 'custom' ? nextCustomLogo : null,
    });

    setEditStudent({
      name: snap.details.name,
      rollNo: snap.details.rollNo,
      registrationNo: snap.details.registrationNo,
      department: snap.details.department,
      semester: snap.details.semester,
      year: snap.details.year,
      subject: snap.details.subject,
      subjectCode: snap.details.subjectCode,
    });

    toast.info('Copied current form details into editor (click Save Changes to persist)');
  };

  const handleEditLogoUpload = async (file: File | undefined) => {
    if (!file || !editCollege) return;
    setEditLogoLoading(true);
    setEditError(null);

    try {
      const prepared = await prepareLogoImageFromFile(file);
      const nextLogo: StoredCustomLogo = {
        bytes: prepared.bytes.slice(0),
        format: prepared.format,
        width: prepared.width,
        height: prepared.height,
        fileName: file.name,
        fileSize: file.size || prepared.bytes.byteLength,
      };
      setEditCustomLogoCache(nextLogo);
      setEditCollege((prev) =>
        prev
          ? {
              ...prev,
              logoMode: 'custom',
              customLogo: nextLogo,
            }
          : prev
      );
      toast.success(`Custom logo "${file.name}" attached to profile`);
    } catch (err) {
      const msg =
        err instanceof FrontPageError
          ? err.message
          : 'Invalid logo image. Please upload a PNG, JPG, JPEG, or SVG file.';
      setEditError(msg);
      toast.error(msg);
    } finally {
      setEditLogoLoading(false);
    }
  };

  const editDuplicateMatch = useMemo(() => {
    if (!editingProfileId) return undefined;
    return findDuplicateProfile(profiles, editName, editingProfileId);
  }, [profiles, editName, editingProfileId]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfileId || !editCollege || !editStudent || savingEdit) return;

    const normalized = normalizeProfileName(editName);
    if (!normalized) {
      setEditError('Profile name cannot be empty.');
      return;
    }
    if (normalized.length > MAX_PROFILE_NAME_LENGTH) {
      setEditError(`Profile name must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (editDuplicateMatch) {
      setEditError(`Another profile named "${editDuplicateMatch.name}" already exists.`);
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const activeCustomLogo = editCollege.logoMode === 'custom' ? editCustomLogoCache : null;
      await onUpdateProfile(editingProfileId, {
        name: normalized,
        collegeInfo: {
          ...editCollege,
          customLogo: activeCustomLogo,
        },
        studentInfo: editStudent,
      });
      cancelEdit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update saved profile.';
      setEditError(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteConfirm = async (profile: FrontPageProfile) => {
    if (deletingId) return;
    setDeletingId(profile.id);
    try {
      await onDeleteProfile(profile);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const isEditView = editingProfileId !== null && editCollege !== null && editStudent !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-lg">
        {isEditView ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 -ml-1 shrink-0"
                    onClick={cancelEdit}
                    disabled={savingEdit}
                    title="Back to Saved Profiles"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <DialogTitle className="text-base">Edit Profile</DialogTitle>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-7 py-1 text-xs px-2.5 gap-1 whitespace-normal"
                  onClick={copyFromCurrentForm}
                  disabled={savingEdit}
                  title="Copy college and student fields from current page form"
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  <span>Sync from Current Form</span>
                </Button>
              </div>
              <DialogDescription className="text-xs">
                Update saved college settings and student details for this profile.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
                {/* Profile Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="fp-edit-profile-name" className="text-xs font-semibold">
                    Profile Name
                  </Label>
                  <Input
                    id="fp-edit-profile-name"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      if (editError) setEditError(null);
                    }}
                    placeholder="Profile name"
                    maxLength={MAX_PROFILE_NAME_LENGTH}
                    disabled={savingEdit}
                  />
                  {editDuplicateMatch && (
                    <p className="text-[11px] text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Another profile named &ldquo;{editDuplicateMatch.name}&rdquo; already exists.
                    </p>
                  )}
                </div>

                {/* College Info Section */}
                <div className="rounded-lg border p-3 space-y-3 bg-muted/15">
                  <p className="text-xs font-semibold">College Information</p>

                  <div className="space-y-1.5">
                    <Label htmlFor="fp-edit-college-name" className="text-xs">
                      College / Institution Name
                    </Label>
                    <Input
                      id="fp-edit-college-name"
                      value={editCollege.collegeName}
                      onChange={(e) =>
                        setEditCollege((prev) =>
                          prev ? { ...prev, collegeName: e.target.value } : prev
                        )
                      }
                      placeholder="Enter college name (optional)"
                      className="text-sm"
                    />
                  </div>

                  {/* Logo Mode */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">College Logo Selection</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['kgec', 'custom', 'none'] as LogoMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            setEditCollege((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    logoMode: mode,
                                    customLogo: mode === 'custom' ? editCustomLogoCache : null,
                                  }
                                : prev
                            )
                          }
                          className={cn(
                            'flex items-center justify-center rounded-lg border px-2 sm:px-2.5 py-2 sm:py-1.5 text-xs font-medium leading-tight transition-colors text-center',
                            editCollege.logoMode === mode
                              ? 'border-primary bg-primary/10 text-primary font-semibold'
                              : 'border-border bg-background hover:bg-muted/50'
                          )}
                        >
                          {formatLogoModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Logo inside Edit */}
                  {editCollege.logoMode === 'custom' && (
                    <div className="rounded-lg border bg-background p-2.5 space-y-2">
                      <input
                        ref={editLogoInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          void handleEditLogoUpload(e.target.files?.[0]);
                          if (editLogoInputRef.current) editLogoInputRef.current.value = '';
                        }}
                      />
                      {editCustomLogoCache ? (
                        <div className="flex flex-wrap items-center gap-2.5">
                          <div className="h-11 w-11 rounded border bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden">
                            <CustomLogoThumbnail
                              logo={editCustomLogoCache}
                              alt="Saved custom logo"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="min-w-[120px] flex-1">
                            <p className="text-xs font-medium break-words [overflow-wrap:anywhere] leading-snug">
                              {editCustomLogoCache.fileName}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {editCustomLogoCache.width} × {editCustomLogoCache.height} px •{' '}
                              {formatFileSize(editCustomLogoCache.fileSize)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-auto">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => editLogoInputRef.current?.click()}
                              disabled={editLogoLoading}
                            >
                              Replace
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => {
                                setEditCustomLogoCache(null);
                                setEditCollege((prev) =>
                                  prev ? { ...prev, customLogo: null } : prev
                                );
                              }}
                              title="Remove custom logo"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">
                            No custom logo image attached to this profile yet.
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2.5 gap-1 shrink-0 ml-auto"
                            onClick={() => editLogoInputRef.current?.click()}
                            disabled={editLogoLoading}
                          >
                            {editLogoLoading ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Upload className="h-3 w-3" />
                            )}
                            Upload Logo
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Typography & Layout Settings */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5 sm:col-span-2">
                      <div className="flex items-center justify-between text-xs">
                        <Label className="text-xs">College Name Font Size</Label>
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {editCollege.collegeFontSizePt} pt
                        </span>
                      </div>
                      <Slider
                        value={[editCollege.collegeFontSizePt]}
                        min={MIN_COLLEGE_FONT_SIZE_PT}
                        max={MAX_COLLEGE_FONT_SIZE_PT}
                        step={1}
                        onValueChange={([v]) =>
                          setEditCollege((prev) =>
                            prev ? { ...prev, collegeFontSizePt: v } : prev
                          )
                        }
                      />
                    </div>

                    {editCollege.logoMode !== 'none' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <Label className="text-xs">Logo Size</Label>
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {editCollege.logoSizePt} pt
                          </span>
                        </div>
                        <Slider
                          value={[editCollege.logoSizePt]}
                          min={MIN_LOGO_SIZE_PT}
                          max={MAX_LOGO_SIZE_PT}
                          step={2}
                          onValueChange={([v]) =>
                            setEditCollege((prev) => (prev ? { ...prev, logoSizePt: v } : prev))
                          }
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <Label className="text-xs">Page Border Margin</Label>
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {editCollege.borderMarginPt} pt
                        </span>
                      </div>
                      <Slider
                        value={[editCollege.borderMarginPt]}
                        min={MIN_BORDER_MARGIN_PT}
                        max={MAX_BORDER_MARGIN_PT}
                        step={2}
                        onValueChange={([v]) =>
                          setEditCollege((prev) =>
                            prev ? { ...prev, borderMarginPt: v } : prev
                          )
                        }
                      />
                    </div>

                    {editCollege.logoMode !== 'none' && (
                      <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <Label className="text-xs">Logo Position</Label>
                        <div className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto rounded-lg border bg-muted/40 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              setEditCollege((prev) =>
                                prev ? { ...prev, logoPosition: 'left' } : prev
                              )
                            }
                            className={cn(
                              'px-2.5 py-1 rounded-md transition-colors text-center',
                              editCollege.logoPosition === 'left'
                                ? 'bg-background text-foreground font-semibold shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            Top-Left
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditCollege((prev) =>
                                prev ? { ...prev, logoPosition: 'center' } : prev
                              )
                            }
                            className={cn(
                              'px-2.5 py-1 rounded-md transition-colors text-center',
                              editCollege.logoPosition === 'center'
                                ? 'bg-background text-foreground font-semibold shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            Top-Center
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Student Info Section */}
                <div className="rounded-lg border p-3 space-y-3 bg-muted/15">
                  <p className="text-xs font-semibold">Student Information</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-student-name" className="text-xs">
                        Name
                      </Label>
                      <Input
                        id="fp-edit-student-name"
                        value={editStudent.name}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, name: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. Dip Mondal"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-roll" className="text-xs">
                        Roll No.
                      </Label>
                      <Input
                        id="fp-edit-roll"
                        value={editStudent.rollNo}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, rollNo: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. 10200100001"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-reg" className="text-xs">
                        Registration No.
                      </Label>
                      <Input
                        id="fp-edit-reg"
                        value={editStudent.registrationNo}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, registrationNo: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. 241020100001"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-dept" className="text-xs">
                        Department
                      </Label>
                      <Input
                        id="fp-edit-dept"
                        value={editStudent.department}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, department: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. Computer Science and Engineering"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-subject" className="text-xs">
                        Subject
                      </Label>
                      <Input
                        id="fp-edit-subject"
                        value={editStudent.subject}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, subject: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. Object Oriented Programming Lab"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-sub-code" className="text-xs">
                        Subject Code
                      </Label>
                      <Input
                        id="fp-edit-sub-code"
                        value={editStudent.subjectCode}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, subjectCode: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. PCC-CS 593"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-sem" className="text-xs">
                        Semester
                      </Label>
                      <Input
                        id="fp-edit-sem"
                        value={editStudent.semester}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, semester: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. 5th"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fp-edit-year" className="text-xs">
                        Year
                      </Label>
                      <Input
                        id="fp-edit-year"
                        value={editStudent.year}
                        onChange={(e) =>
                          setEditStudent((prev) =>
                            prev ? { ...prev, year: e.target.value } : prev
                          )
                        }
                        placeholder="e.g. 2026 - 2027"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {editError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelEdit}
                  disabled={savingEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    savingEdit || !normalizeProfileName(editName) || Boolean(editDuplicateMatch)
                  }
                >
                  {savingEdit ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving Changes...
                    </>
                  ) : (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Save Changes
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <FolderOpen className="h-4 w-4 text-amber-500" />
                  Saved Profiles
                </DialogTitle>
                <Badge variant="secondary" className="text-[11px]">
                  {profiles.length} saved
                </Badge>
              </div>
              <DialogDescription className="text-xs">
                Load a saved profile to fill college and student details and update the A4 preview immediately. Your Main Title and Assignment Title will stay intact.
              </DialogDescription>
            </DialogHeader>

            {storageError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{storageError}</span>
              </div>
            )}

            {profiles.length >= 4 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search profiles by name, college, or student..."
                  className="pl-8 h-8 text-xs"
                />
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                <p className="text-xs text-muted-foreground">Loading saved profiles...</p>
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/15 px-6 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <BookmarkPlus className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold">No saved profiles yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
                  Save your college header settings and student information once so you can reuse them on future assignments in one click.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onRequestSaveNew();
                  }}
                >
                  <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                  Save Current Details
                </Button>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="rounded-lg border p-6 text-center text-xs text-muted-foreground">
                No saved profiles match &ldquo;{searchQuery.trim()}&rdquo;.
              </div>
            ) : (
              <div className="max-h-[58vh] overflow-y-auto space-y-2.5 pr-1">
                {filteredProfiles.map((profile) => {
                  const isConfirmingDelete = confirmDeleteId === profile.id;
                  const isDeletingThis = deletingId === profile.id;
                  const collegeDisplay = profile.collegeInfo.collegeName.trim();
                  const studentDisplay = profile.studentInfo.name.trim();

                  return (
                    <div
                      key={profile.id}
                      className="rounded-xl border bg-card p-3 transition-colors hover:bg-muted/20"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Profile Info */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="h-11 w-11 rounded-lg border bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden">
                            {profile.collegeInfo.logoMode === 'kgec' ? (
                              <img
                                src={kgecLogoUrl}
                                alt="KGEC Logo"
                                className="h-full w-full object-contain"
                              />
                            ) : profile.collegeInfo.logoMode === 'custom' &&
                              profile.collegeInfo.customLogo ? (
                              <CustomLogoThumbnail
                                logo={profile.collegeInfo.customLogo}
                                alt={`${profile.name} logo`}
                                className="h-full w-full object-contain"
                              />
                            ) : profile.collegeInfo.logoMode === 'custom' ? (
                              <Upload className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Ban className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-semibold break-words [overflow-wrap:anywhere] leading-snug">
                                {profile.name}
                              </p>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                {formatLogoModeLabel(profile.collegeInfo.logoMode)}
                              </Badge>
                            </div>
                            <p className="text-xs text-foreground/90 break-words leading-snug">
                              {collegeDisplay || (
                                <span className="italic text-muted-foreground">
                                  No college name
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground flex items-start gap-1 leading-snug">
                              <User className="h-3 w-3 shrink-0 mt-0.5" />
                              <span className="min-w-0 break-words">
                                Student:{' '}
                                {studentDisplay || (
                                  <span className="italic">Not specified</span>
                                )}
                                {profile.studentInfo.rollNo.trim()
                                  ? ` · Roll ${profile.studentInfo.rollNo.trim()}`
                                  : ''}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        {isConfirmingDelete ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5 w-full sm:w-auto sm:shrink-0">
                            <span className="text-[11px] text-destructive font-medium mr-1">
                              Delete?
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isDeletingThis}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs px-2.5"
                              onClick={() => void handleDeleteConfirm(profile)}
                              disabled={isDeletingThis}
                            >
                              {isDeletingThis ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'Confirm'
                              )}
                            </Button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto sm:shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              className="h-auto min-h-8 sm:min-h-7 py-1 text-xs px-2.5 gap-1 whitespace-normal text-center"
                              onClick={() => onLoadProfile(profile)}
                            >
                              <Check className="h-3 w-3 shrink-0" />
                              <span>Load Profile</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-auto min-h-8 sm:min-h-7 py-1 text-xs px-2.5 gap-1 whitespace-normal text-center"
                              onClick={() => startEditProfile(profile)}
                            >
                              <Pencil className="h-3 w-3 shrink-0" />
                              <span>Edit Profile</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="col-span-2 sm:col-span-1 w-full sm:w-auto h-auto min-h-7 py-1 text-xs px-2 text-muted-foreground hover:text-destructive gap-1 whitespace-normal"
                              onClick={() => setConfirmDeleteId(profile.id)}
                            >
                              <Trash2 className="h-3 w-3 shrink-0" />
                              <span>Delete Profile</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
