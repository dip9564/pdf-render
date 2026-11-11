import React, { useState } from 'react';
import * as pdfLib from 'pdf-lib';
import { PDFDocument } from 'pdf-lib';
import { configure, lock, unlockInPlace } from 'pdf-lib-encrypt';

// Configure pdf-lib-encrypt with pdf-lib once
configure(pdfLib);
import {
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Download,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileUploader } from '@/components/shared/FileUploader';
import { readFileAsArrayBuffer, createPdfBlob, downloadBlob, formatFileSize } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ProtectPdf() {
  const [activeTab, setActiveTab] = useState<'protect' | 'unlock'>('protect');

  // Protect state
  const [protectFile, setProtectFile] = useState<File | null>(null);
  const [protectBuffer, setProtectBuffer] = useState<ArrayBuffer | null>(null);
  const [protectPassword, setProtectPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showProtectPass, setShowProtectPass] = useState<boolean>(false);
  const [protecting, setProtecting] = useState<boolean>(false);

  // Unlock state
  const [unlockFile, setUnlockFile] = useState<File | null>(null);
  const [unlockBuffer, setUnlockBuffer] = useState<ArrayBuffer | null>(null);
  const [unlockPassword, setUnlockPassword] = useState<string>('');
  const [showUnlockPass, setShowUnlockPass] = useState<boolean>(false);
  const [unlocking, setUnlocking] = useState<boolean>(false);

  // Calculate password strength
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 10) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 2) return { score: 1, label: 'Weak', color: 'text-red-500 bg-red-500' };
    if (score <= 4) return { score: 2, label: 'Good', color: 'text-amber-500 bg-amber-500' };
    return { score: 3, label: 'Strong', color: 'text-emerald-500 bg-emerald-500' };
  };

  const strength = getPasswordStrength(protectPassword);

  // Handle file selections
  const handleProtectFileSelected = async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    setProtectFile(f);
    try {
      const buffer = await readFileAsArrayBuffer(f);
      setProtectBuffer(buffer);
      toast.success(`Loaded "${f.name}" (${formatFileSize(f.size)})`);
    } catch {
      toast.error('Failed to read PDF file');
    }
  };

  const handleUnlockFileSelected = async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    setUnlockFile(f);
    try {
      const buffer = await readFileAsArrayBuffer(f);
      setUnlockBuffer(buffer);
      toast.success(`Loaded "${f.name}" (${formatFileSize(f.size)})`);
    } catch {
      toast.error('Failed to read PDF file');
    }
  };

  // Encrypt / Protect
  const handleProtectPdf = async () => {
    if (!protectBuffer || !protectFile) {
      toast.warning('Please select a PDF file first');
      return;
    }
    if (!protectPassword) {
      toast.warning('Please enter a password');
      return;
    }
    if (protectPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setProtecting(true);
    try {
      // Encrypt bytes using Web Crypto AES-256 via pdf-lib-encrypt
      const encryptedBytes = await lock(protectBuffer, protectPassword);

      const blob = createPdfBlob(encryptedBytes as Uint8Array);
      const baseName = protectFile.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}_protected.pdf`);

      toast.success('PDF successfully password protected!');
    } catch (err) {
      console.error('Failed to encrypt PDF', err);
      toast.error('Failed to encrypt PDF. Please try again.');
    } finally {
      setProtecting(false);
    }
  };

  // Decrypt / Unlock
  const handleUnlockPdf = async () => {
    if (!unlockBuffer || !unlockFile) {
      toast.warning('Please select a PDF file first');
      return;
    }
    if (!unlockPassword) {
      toast.warning('Please enter the document password');
      return;
    }

    setUnlocking(true);
    try {
      // 1. Load document with ignoreEncryption: true
      const pdfDoc = await PDFDocument.load(unlockBuffer, { ignoreEncryption: true });

      // 2. Unlock in place with password
      const success = await unlockInPlace(pdfDoc, unlockPassword);
      if (!success) {
        throw new Error('Incorrect password');
      }

      // 3. Save unencrypted PDF
      const decryptedBytes = await pdfDoc.save();
      const blob = createPdfBlob(decryptedBytes);
      const baseName = unlockFile.name.replace(/\.[^/.]+$/, '');
      downloadBlob(blob, `${baseName}_unlocked.pdf`);

      toast.success('PDF unlocked successfully! Password removed.');
    } catch (err: any) {
      console.error('Failed to unlock PDF', err);
      toast.error('Incorrect password or unable to unlock this document.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-4xl">
      <div className="mb-4 sm:mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">PDF Security &amp; Passwords</h1>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Add military-grade AES encryption or permanently remove password restrictions from your documents.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'protect' | 'unlock')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 h-10 p-1">
          <TabsTrigger value="protect" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Lock className="h-3.5 w-3.5" />
            Protect PDF (Add Password)
          </TabsTrigger>
          <TabsTrigger value="unlock" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Unlock className="h-3.5 w-3.5" />
            Unlock PDF (Remove Password)
          </TabsTrigger>
        </TabsList>

        {/* PROTECT TAB */}
        <TabsContent value="protect" className="space-y-4">
          {!protectFile ? (
            <Card>
              <CardContent className="p-5 sm:p-7">
                <FileUploader
                  accept=".pdf,application/pdf"
                  multiple={false}
                  onFilesSelected={handleProtectFileSelected}
                  label="Select PDF to Protect"
                  description="Encrypt with AES-256 standard security"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* File header */}
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                    PDF
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate max-w-[200px] sm:max-w-md">{protectFile.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatFileSize(protectFile.size)}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => {
                    setProtectFile(null);
                    setProtectBuffer(null);
                    setProtectPassword('');
                    setConfirmPassword('');
                  }}
                  disabled={protecting}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Change
                </Button>
              </div>

              {/* Security Form Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-indigo-500" />
                    Set Document Password
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Choose a strong password. The document cannot be opened without it.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Password Input */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">New Password</Label>
                    <div className="relative">
                      <Input
                        type={showProtectPass ? 'text' : 'password'}
                        value={protectPassword}
                        onChange={(e) => setProtectPassword(e.target.value)}
                        placeholder="Enter secure password"
                        className="h-9 text-xs pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowProtectPass(!showProtectPass)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                      >
                        {showProtectPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Password Strength Indicator */}
                    {protectPassword && (
                      <div className="pt-1 space-y-1">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-muted-foreground">Strength:</span>
                          <span className={cn('font-semibold', strength.color.split(' ')[0])}>
                            {strength.label}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 h-1">
                          <div
                            className={cn(
                              'rounded-full',
                              strength.score >= 1 ? strength.color.split(' ')[1] : 'bg-muted'
                            )}
                          />
                          <div
                            className={cn(
                              'rounded-full',
                              strength.score >= 2 ? strength.color.split(' ')[1] : 'bg-muted'
                            )}
                          />
                          <div
                            className={cn(
                              'rounded-full',
                              strength.score >= 3 ? strength.color.split(' ')[1] : 'bg-muted'
                            )}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Confirm Password</Label>
                    <Input
                      type={showProtectPass ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="h-9 text-xs"
                    />
                    {confirmPassword && protectPassword !== confirmPassword && (
                      <p className="text-[11px] text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Passwords do not match
                      </p>
                    )}
                    {confirmPassword && protectPassword === confirmPassword && (
                      <p className="text-[11px] text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Passwords match perfectly
                      </p>
                    )}
                  </div>

                  {/* Encryption Badge */}
                  <div className="rounded-lg border bg-muted/20 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground text-xs">100% Client-Side AES-256 Encryption</p>
                      <p className="text-[11px] mt-0.5">
                        Your file and password never leave your device. The encryption is calculated natively in your browser using the Web Crypto API.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={handleProtectPdf}
                    disabled={protecting || !protectPassword || protectPassword !== confirmPassword}
                    className="w-full"
                  >
                    {protecting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Lock className="h-4 w-4 mr-2" />
                    )}
                    Encrypt & Download Protected PDF
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* UNLOCK TAB */}
        <TabsContent value="unlock" className="space-y-4">
          {!unlockFile ? (
            <Card>
              <CardContent className="p-5 sm:p-7">
                <FileUploader
                  accept=".pdf,application/pdf"
                  multiple={false}
                  onFilesSelected={handleUnlockFileSelected}
                  label="Select Password-Protected PDF"
                  description="Permanently remove password restrictions"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* File header */}
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                    PDF
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate max-w-[200px] sm:max-w-md">{unlockFile.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatFileSize(unlockFile.size)}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => {
                    setUnlockFile(null);
                    setUnlockBuffer(null);
                    setUnlockPassword('');
                  }}
                  disabled={unlocking}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Change
                </Button>
              </div>

              {/* Unlock Form Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Unlock className="h-4 w-4 text-indigo-500" />
                    Enter Document Password
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Type the existing password to unlock and save a copy without any password requirement.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Document Password</Label>
                    <div className="relative">
                      <Input
                        type={showUnlockPass ? 'text' : 'password'}
                        value={unlockPassword}
                        onChange={(e) => setUnlockPassword(e.target.value)}
                        placeholder="Enter password to unlock"
                        className="h-9 text-xs pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowUnlockPass(!showUnlockPass)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                      >
                        {showUnlockPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    onClick={handleUnlockPdf}
                    disabled={unlocking || !unlockPassword}
                    className="w-full"
                  >
                    {unlocking ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Unlock className="h-4 w-4 mr-2" />
                    )}
                    Unlock & Download Unrestricted PDF
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
