import {
  DEFAULT_BORDER_MARGIN_PT,
  DEFAULT_COLLEGE_FONT_SIZE_PT,
  DEFAULT_LOGO_SIZE_PT,
  FrontPageDetails,
  LogoImageFormat,
  LogoImagePayload,
  LogoMode,
  LogoPosition,
  MAX_BORDER_MARGIN_PT,
  MAX_COLLEGE_FONT_SIZE_PT,
  MAX_LOGO_SIZE_PT,
  MIN_BORDER_MARGIN_PT,
  MIN_COLLEGE_FONT_SIZE_PT,
  MIN_LOGO_SIZE_PT,
} from '@/lib/frontPage/frontPagePdfEngine';

export const FRONT_PAGE_PROFILES_DB_NAME = 'pdf_render_front_page_db';
export const FRONT_PAGE_PROFILES_DB_VERSION = 1;
export const FRONT_PAGE_PROFILES_STORE_NAME = 'profiles';
export const MAX_PROFILE_NAME_LENGTH = 80;

export type ProfileStorageErrorCode =
  | 'INVALID_PROFILE_NAME'
  | 'DUPLICATE_PROFILE_NAME'
  | 'PROFILE_NOT_FOUND'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED';

export class ProfileStorageError extends Error {
  public readonly code: ProfileStorageErrorCode;

  constructor(code: ProfileStorageErrorCode, message: string) {
    super(message);
    this.name = 'ProfileStorageError';
    this.code = code;
  }
}

export interface StoredCustomLogo {
  bytes: Uint8Array;
  format: LogoImageFormat;
  width: number;
  height: number;
  fileName: string;
  fileSize: number;
}

export interface ProfileCollegeInfo {
  collegeName: string;
  logoMode: LogoMode;
  logoPosition: LogoPosition;
  logoSizePt: number;
  collegeFontSizePt: number;
  borderMarginPt: number;
  customLogo: StoredCustomLogo | null;
}

export interface ProfileStudentInfo {
  name: string;
  rollNo: string;
  registrationNo: string;
  department: string;
  semester: string;
  year: string;
  subject: string;
  subjectCode: string;
}

export interface FrontPageProfileDraft {
  name: string;
  collegeInfo: ProfileCollegeInfo;
  studentInfo: ProfileStudentInfo;
}

export interface FrontPageProfile extends FrontPageProfileDraft {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProfileDraftParams {
  profileName: string;
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

interface PersistedStoredCustomLogo {
  bytes: ArrayBuffer;
  format: LogoImageFormat;
  width: number;
  height: number;
  fileName: string;
  fileSize: number;
}

interface PersistedFrontPageProfile {
  id: string;
  name: string;
  collegeInfo: Omit<ProfileCollegeInfo, 'customLogo'> & {
    customLogo: PersistedStoredCustomLogo | null;
  };
  studentInfo: ProfileStudentInfo;
  createdAt: number;
  updatedAt: number;
}

export function normalizeProfileName(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

export function profileNameKey(raw: string): string {
  return normalizeProfileName(raw).toLowerCase();
}

export function validateProfileName(raw: string): string {
  const normalized = normalizeProfileName(raw);
  if (!normalized) {
    throw new ProfileStorageError('INVALID_PROFILE_NAME', 'Please enter a profile name.');
  }
  if (normalized.length > MAX_PROFILE_NAME_LENGTH) {
    throw new ProfileStorageError(
      'INVALID_PROFILE_NAME',
      `Profile name must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

export function findDuplicateProfile(
  profiles: FrontPageProfile[],
  candidateName: string,
  excludeId?: string
): FrontPageProfile | undefined {
  const key = profileNameKey(candidateName);
  if (!key) return undefined;
  return profiles.find((p) => p.id !== excludeId && profileNameKey(p.name) === key);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeLogoMode(value: unknown): LogoMode {
  if (value === 'kgec' || value === 'custom' || value === 'none') {
    return value;
  }
  return 'kgec';
}

function normalizeLogoPosition(value: unknown): LogoPosition {
  return value === 'center' ? 'center' : 'left';
}

function normalizeLogoFormat(value: unknown): LogoImageFormat {
  return value === 'jpg' ? 'jpg' : 'png';
}

function toExactUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data.slice(0);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    );
  }
  if (Array.isArray(data) && data.every((n) => typeof n === 'number')) {
    return new Uint8Array(data);
  }
  return null;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cloneStoredCustomLogo(logo: StoredCustomLogo | null): StoredCustomLogo | null {
  if (!logo || !(logo.bytes instanceof Uint8Array) || logo.bytes.byteLength === 0) {
    return null;
  }
  return {
    bytes: logo.bytes.slice(0),
    format: normalizeLogoFormat(logo.format),
    width: Math.max(1, Math.round(logo.width || 1)),
    height: Math.max(1, Math.round(logo.height || 1)),
    fileName: normalizeString(logo.fileName) || `custom-logo.${normalizeLogoFormat(logo.format)}`,
    fileSize:
      typeof logo.fileSize === 'number' && Number.isFinite(logo.fileSize) && logo.fileSize > 0
        ? logo.fileSize
        : logo.bytes.byteLength,
  };
}

function normalizeCollegeInfo(raw: unknown): ProfileCollegeInfo {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawLogo = src.customLogo;
  let customLogo: StoredCustomLogo | null = null;

  if (rawLogo && typeof rawLogo === 'object') {
    const logoObj = rawLogo as Record<string, unknown>;
    const bytes = toExactUint8Array(logoObj.bytes);
    if (bytes && bytes.byteLength > 0) {
      const format = normalizeLogoFormat(logoObj.format);
      customLogo = {
        bytes,
        format,
        width: clampNumber(logoObj.width, 1, 10000, 128),
        height: clampNumber(logoObj.height, 1, 10000, 128),
        fileName: normalizeString(logoObj.fileName) || `custom-logo.${format}`,
        fileSize: clampNumber(logoObj.fileSize, 1, 100 * 1024 * 1024, bytes.byteLength),
      };
    }
  }

  return {
    collegeName: normalizeString(src.collegeName),
    logoMode: normalizeLogoMode(src.logoMode),
    logoPosition: normalizeLogoPosition(src.logoPosition),
    logoSizePt: clampNumber(src.logoSizePt, MIN_LOGO_SIZE_PT, MAX_LOGO_SIZE_PT, DEFAULT_LOGO_SIZE_PT),
    collegeFontSizePt: clampNumber(
      src.collegeFontSizePt,
      MIN_COLLEGE_FONT_SIZE_PT,
      MAX_COLLEGE_FONT_SIZE_PT,
      DEFAULT_COLLEGE_FONT_SIZE_PT
    ),
    borderMarginPt: clampNumber(
      src.borderMarginPt,
      MIN_BORDER_MARGIN_PT,
      MAX_BORDER_MARGIN_PT,
      DEFAULT_BORDER_MARGIN_PT
    ),
    customLogo,
  };
}

function normalizeStudentInfo(raw: unknown): ProfileStudentInfo {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: normalizeString(src.name),
    rollNo: normalizeString(src.rollNo),
    registrationNo: normalizeString(src.registrationNo),
    department: normalizeString(src.department),
    semester: normalizeString(src.semester),
    year: normalizeString(src.year),
    subject: normalizeString(src.subject),
    subjectCode: normalizeString(src.subjectCode),
  };
}

export function sanitizeStoredProfileRecord(raw: unknown): FrontPageProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = normalizeString(obj.id).trim();
  const name = normalizeProfileName(normalizeString(obj.name));
  if (!id || !name) return null;

  const now = Date.now();
  const createdAt =
    typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : now;
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : createdAt;

  return {
    id,
    name,
    collegeInfo: normalizeCollegeInfo(obj.collegeInfo),
    studentInfo: normalizeStudentInfo(obj.studentInfo),
    createdAt,
    updatedAt,
  };
}

/**
 * Extracts only reusable college and student settings from current form state.
 * Main Title and Assignment Title are deliberately excluded because they change per assignment.
 */
export function createProfileDraftFromFormState(
  params: CreateProfileDraftParams
): FrontPageProfileDraft {
  const name = normalizeProfileName(params.profileName);
  let customLogo: StoredCustomLogo | null = null;

  if (
    params.logoMode === 'custom' &&
    params.customLogoPayload &&
    params.customLogoPayload.bytes.byteLength > 0
  ) {
    const copiedBytes = params.customLogoPayload.bytes.slice(0);
    const format = normalizeLogoFormat(params.customLogoPayload.format);
    customLogo = {
      bytes: copiedBytes,
      format,
      width: Math.max(1, Math.round(params.customLogoPayload.width)),
      height: Math.max(1, Math.round(params.customLogoPayload.height)),
      fileName:
        normalizeString(params.customLogoFileName).trim() || `custom-logo.${format}`,
      fileSize:
        typeof params.customLogoFileSize === 'number' && params.customLogoFileSize > 0
          ? params.customLogoFileSize
          : copiedBytes.byteLength,
    };
  }

  return {
    name,
    collegeInfo: {
      collegeName: normalizeString(params.details.collegeName),
      logoMode: normalizeLogoMode(params.logoMode),
      logoPosition: normalizeLogoPosition(params.logoPosition),
      logoSizePt: clampNumber(
        params.logoSizePt,
        MIN_LOGO_SIZE_PT,
        MAX_LOGO_SIZE_PT,
        DEFAULT_LOGO_SIZE_PT
      ),
      collegeFontSizePt: clampNumber(
        params.collegeFontSizePt,
        MIN_COLLEGE_FONT_SIZE_PT,
        MAX_COLLEGE_FONT_SIZE_PT,
        DEFAULT_COLLEGE_FONT_SIZE_PT
      ),
      borderMarginPt: clampNumber(
        params.borderMarginPt,
        MIN_BORDER_MARGIN_PT,
        MAX_BORDER_MARGIN_PT,
        DEFAULT_BORDER_MARGIN_PT
      ),
      customLogo,
    },
    studentInfo: {
      name: normalizeString(params.details.name),
      rollNo: normalizeString(params.details.rollNo),
      registrationNo: normalizeString(params.details.registrationNo),
      department: normalizeString(params.details.department),
      semester: normalizeString(params.details.semester),
      year: normalizeString(params.details.year),
      subject: normalizeString(params.details.subject),
      subjectCode: normalizeString(params.details.subjectCode),
    },
  };
}

/**
 * Applies a saved profile onto current FrontPageDetails while preserving
 * existing Main Title and Assignment Title values untouched.
 */
export function applyProfileToDetails(
  currentDetails: FrontPageDetails,
  profile: FrontPageProfile
): FrontPageDetails {
  return {
    collegeName: profile.collegeInfo.collegeName,
    mainTitle: currentDetails.mainTitle,
    assignmentTitle: currentDetails.assignmentTitle,
    name: profile.studentInfo.name,
    rollNo: profile.studentInfo.rollNo,
    registrationNo: profile.studentInfo.registrationNo,
    department: profile.studentInfo.department,
    semester: profile.studentInfo.semester,
    year: profile.studentInfo.year,
    subject: profile.studentInfo.subject,
    subjectCode: profile.studentInfo.subjectCode,
  };
}

function serializeProfileForIdb(profile: FrontPageProfile): PersistedFrontPageProfile {
  const normalizedCollege = normalizeCollegeInfo(profile.collegeInfo);
  const customLogo = cloneStoredCustomLogo(normalizedCollege.customLogo);

  return {
    id: profile.id,
    name: validateProfileName(profile.name),
    collegeInfo: {
      collegeName: normalizedCollege.collegeName,
      logoMode: normalizedCollege.logoMode,
      logoPosition: normalizedCollege.logoPosition,
      logoSizePt: normalizedCollege.logoSizePt,
      collegeFontSizePt: normalizedCollege.collegeFontSizePt,
      borderMarginPt: normalizedCollege.borderMarginPt,
      customLogo: customLogo
        ? {
            bytes: toExactArrayBuffer(customLogo.bytes),
            format: customLogo.format,
            width: customLogo.width,
            height: customLogo.height,
            fileName: customLogo.fileName,
            fileSize: customLogo.fileSize,
          }
        : null,
    },
    studentInfo: normalizeStudentInfo(profile.studentInfo),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function generateProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fp_prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveIdbFactory(idbFactory?: IDBFactory): IDBFactory {
  if (idbFactory) return idbFactory;
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as { indexedDB: IDBFactory }).indexedDB;
  }
  throw new ProfileStorageError(
    'STORAGE_UNAVAILABLE',
    'Local IndexedDB storage is not available in this browser context.'
  );
}

function mapDomException(err: unknown, fallbackCode: ProfileStorageErrorCode, fallbackMessage: string): ProfileStorageError {
  if (err instanceof ProfileStorageError) return err;
  const domErr = err as { name?: string; message?: string } | null;
  if (domErr?.name === 'QuotaExceededError') {
    return new ProfileStorageError(
      'STORAGE_QUOTA_EXCEEDED',
      'Browser storage quota exceeded. Delete unused profiles or use a smaller custom logo image.'
    );
  }
  return new ProfileStorageError(
    fallbackCode,
    domErr?.message ? `${fallbackMessage} (${domErr.message})` : fallbackMessage
  );
}

function openProfilesDatabase(idbFactory?: IDBFactory): Promise<IDBDatabase> {
  let factory: IDBFactory;
  try {
    factory = resolveIdbFactory(idbFactory);
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(FRONT_PAGE_PROFILES_DB_NAME, FRONT_PAGE_PROFILES_DB_VERSION);
    } catch (err) {
      reject(
        mapDomException(
          err,
          'STORAGE_UNAVAILABLE',
          'Could not open local IndexedDB storage for saved profiles.'
        )
      );
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FRONT_PAGE_PROFILES_STORE_NAME)) {
        const store = db.createObjectStore(FRONT_PAGE_PROFILES_STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_updated_at', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        mapDomException(
          request.error,
          'STORAGE_UNAVAILABLE',
          'Failed to open saved profiles database.'
        )
      );
    };

    request.onblocked = () => {
      reject(
        new ProfileStorageError(
          'STORAGE_UNAVAILABLE',
          'Saved profiles database upgrade is blocked by another open tab. Please close other tabs and retry.'
        )
      );
    };
  });
}

function sortProfilesDescending(profiles: FrontPageProfile[]): FrontPageProfile[] {
  return [...profiles].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function listFrontPageProfiles(idbFactory?: IDBFactory): Promise<FrontPageProfile[]> {
  const db = await openProfilesDatabase(idbFactory);

  return new Promise<FrontPageProfile[]>((resolve, reject) => {
    try {
      const tx = db.transaction(FRONT_PAGE_PROFILES_STORE_NAME, 'readonly');
      const store = tx.objectStore(FRONT_PAGE_PROFILES_STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const rawList = Array.isArray(req.result) ? req.result : [];
        const sanitized: FrontPageProfile[] = [];
        for (const item of rawList) {
          const parsed = sanitizeStoredProfileRecord(item);
          if (parsed) sanitized.push(parsed);
        }
        resolve(sortProfilesDescending(sanitized));
      };

      req.onerror = () => {
        reject(mapDomException(req.error, 'STORAGE_READ_FAILED', 'Failed to read saved profiles.'));
      };

      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(mapDomException(tx.error, 'STORAGE_READ_FAILED', 'Reading saved profiles was aborted.'));
      };
    } catch (err) {
      db.close();
      reject(mapDomException(err, 'STORAGE_READ_FAILED', 'Failed to load saved profiles.'));
    }
  });
}

export async function saveFrontPageProfile(
  draft: FrontPageProfileDraft,
  options?: { overwriteExisting?: boolean },
  idbFactory?: IDBFactory
): Promise<{ profile: FrontPageProfile; overwritten: boolean }> {
  const validatedName = validateProfileName(draft.name);
  const db = await openProfilesDatabase(idbFactory);

  return new Promise<{ profile: FrontPageProfile; overwritten: boolean }>((resolve, reject) => {
    try {
      const tx = db.transaction(FRONT_PAGE_PROFILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FRONT_PAGE_PROFILES_STORE_NAME);
      const listReq = store.getAll();
      let resultPayload: { profile: FrontPageProfile; overwritten: boolean } | null = null;
      let explicitError: ProfileStorageError | null = null;

      listReq.onsuccess = () => {
        const rawList = Array.isArray(listReq.result) ? listReq.result : [];
        const existingProfiles: FrontPageProfile[] = [];
        for (const item of rawList) {
          const parsed = sanitizeStoredProfileRecord(item);
          if (parsed) existingProfiles.push(parsed);
        }

        const duplicate = findDuplicateProfile(existingProfiles, validatedName);
        if (duplicate && !options?.overwriteExisting) {
          explicitError = new ProfileStorageError(
            'DUPLICATE_PROFILE_NAME',
            `A profile named "${duplicate.name}" already exists.`
          );
          try {
            tx.abort();
          } catch {
            // handled in onabort
          }
          return;
        }

        const now = Date.now();
        const nextProfile: FrontPageProfile = {
          id: duplicate ? duplicate.id : generateProfileId(),
          name: validatedName,
          collegeInfo: normalizeCollegeInfo(draft.collegeInfo),
          studentInfo: normalizeStudentInfo(draft.studentInfo),
          createdAt: duplicate ? duplicate.createdAt : now,
          updatedAt: now,
        };

        const serialized = serializeProfileForIdb(nextProfile);
        const putReq = store.put(serialized);
        putReq.onsuccess = () => {
          resultPayload = { profile: nextProfile, overwritten: Boolean(duplicate) };
        };
        putReq.onerror = () => {
          explicitError = mapDomException(
            putReq.error,
            'STORAGE_WRITE_FAILED',
            'Failed to save profile to IndexedDB.'
          );
        };
      };

      listReq.onerror = () => {
        explicitError = mapDomException(
          listReq.error,
          'STORAGE_READ_FAILED',
          'Failed to inspect existing profiles before saving.'
        );
      };

      tx.oncomplete = () => {
        db.close();
        if (resultPayload) {
          resolve(resultPayload);
        } else {
          reject(
            explicitError ||
              new ProfileStorageError('STORAGE_WRITE_FAILED', 'Profile save did not complete.')
          );
        }
      };

      tx.onabort = () => {
        db.close();
        reject(
          explicitError ||
            mapDomException(tx.error, 'STORAGE_WRITE_FAILED', 'Saving profile was aborted.')
        );
      };

      tx.onerror = () => {
        explicitError =
          explicitError ||
          mapDomException(tx.error, 'STORAGE_WRITE_FAILED', 'Failed to write profile to storage.');
      };
    } catch (err) {
      db.close();
      reject(mapDomException(err, 'STORAGE_WRITE_FAILED', 'Failed to save profile.'));
    }
  });
}

export async function updateFrontPageProfile(
  id: string,
  patch: {
    name?: string;
    collegeInfo?: ProfileCollegeInfo;
    studentInfo?: ProfileStudentInfo;
  },
  idbFactory?: IDBFactory
): Promise<FrontPageProfile> {
  const db = await openProfilesDatabase(idbFactory);

  return new Promise<FrontPageProfile>((resolve, reject) => {
    try {
      const tx = db.transaction(FRONT_PAGE_PROFILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FRONT_PAGE_PROFILES_STORE_NAME);
      const listReq = store.getAll();
      let updatedRecord: FrontPageProfile | null = null;
      let explicitError: ProfileStorageError | null = null;

      listReq.onsuccess = () => {
        const rawList = Array.isArray(listReq.result) ? listReq.result : [];
        const existingProfiles: FrontPageProfile[] = [];
        for (const item of rawList) {
          const parsed = sanitizeStoredProfileRecord(item);
          if (parsed) existingProfiles.push(parsed);
        }

        const target = existingProfiles.find((p) => p.id === id);
        if (!target) {
          explicitError = new ProfileStorageError(
            'PROFILE_NOT_FOUND',
            'This saved profile could not be found. It may have already been deleted.'
          );
          try {
            tx.abort();
          } catch {
            // handled in onabort
          }
          return;
        }

        let nextName: string;
        try {
          nextName =
            patch.name !== undefined ? validateProfileName(patch.name) : target.name;
        } catch (err) {
          explicitError = mapDomException(err, 'INVALID_PROFILE_NAME', 'Invalid profile name.');
          try {
            tx.abort();
          } catch {
            // handled in onabort
          }
          return;
        }

        const duplicate = findDuplicateProfile(existingProfiles, nextName, id);
        if (duplicate) {
          explicitError = new ProfileStorageError(
            'DUPLICATE_PROFILE_NAME',
            `Another profile named "${duplicate.name}" already exists.`
          );
          try {
            tx.abort();
          } catch {
            // handled in onabort
          }
          return;
        }

        const nextProfile: FrontPageProfile = {
          id: target.id,
          name: nextName,
          collegeInfo:
            patch.collegeInfo !== undefined
              ? normalizeCollegeInfo(patch.collegeInfo)
              : normalizeCollegeInfo(target.collegeInfo),
          studentInfo:
            patch.studentInfo !== undefined
              ? normalizeStudentInfo(patch.studentInfo)
              : normalizeStudentInfo(target.studentInfo),
          createdAt: target.createdAt,
          updatedAt: Date.now(),
        };

        const serialized = serializeProfileForIdb(nextProfile);
        const putReq = store.put(serialized);
        putReq.onsuccess = () => {
          updatedRecord = nextProfile;
        };
        putReq.onerror = () => {
          explicitError = mapDomException(
            putReq.error,
            'STORAGE_WRITE_FAILED',
            'Failed to update profile.'
          );
        };
      };

      listReq.onerror = () => {
        explicitError = mapDomException(
          listReq.error,
          'STORAGE_READ_FAILED',
          'Failed to read saved profiles before updating.'
        );
      };

      tx.oncomplete = () => {
        db.close();
        if (updatedRecord) {
          resolve(updatedRecord);
        } else {
          reject(
            explicitError ||
              new ProfileStorageError('STORAGE_WRITE_FAILED', 'Profile update did not complete.')
          );
        }
      };

      tx.onabort = () => {
        db.close();
        reject(
          explicitError ||
            mapDomException(tx.error, 'STORAGE_WRITE_FAILED', 'Updating profile was aborted.')
        );
      };

      tx.onerror = () => {
        explicitError =
          explicitError ||
          mapDomException(tx.error, 'STORAGE_WRITE_FAILED', 'Failed to update profile in storage.');
      };
    } catch (err) {
      db.close();
      reject(mapDomException(err, 'STORAGE_WRITE_FAILED', 'Failed to update profile.'));
    }
  });
}

export async function deleteFrontPageProfile(id: string, idbFactory?: IDBFactory): Promise<void> {
  const db = await openProfilesDatabase(idbFactory);

  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(FRONT_PAGE_PROFILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FRONT_PAGE_PROFILES_STORE_NAME);
      const delReq = store.delete(id);

      delReq.onerror = () => {
        reject(
          mapDomException(delReq.error, 'STORAGE_WRITE_FAILED', 'Failed to delete saved profile.')
        );
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onabort = () => {
        db.close();
        reject(
          mapDomException(tx.error, 'STORAGE_WRITE_FAILED', 'Deleting saved profile was aborted.')
        );
      };
    } catch (err) {
      db.close();
      reject(mapDomException(err, 'STORAGE_WRITE_FAILED', 'Failed to delete saved profile.'));
    }
  });
}
