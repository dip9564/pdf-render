import React, { useCallback, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Upload, X, FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/utils';

interface FileUploaderProps {
  accept: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // in bytes
  onFilesSelected: (files: File[]) => void;
  label?: string;
  description?: string;
  className?: string;
  files?: File[];
  onRemoveFile?: (index: number) => void;
  showFileList?: boolean;
}

export function FileUploader({
  accept,
  multiple = true,
  maxFiles = 50,
  maxSize = 100 * 1024 * 1024,
  onFilesSelected,
  label = 'Upload Files',
  description = 'Drag & drop files here, or click to browse',
  className,
  files = [],
  onRemoveFile,
  showFileList = true,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const processFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const acceptedTypes = accept.split(',').map((t) => t.trim());
      const validFiles: File[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const isValidType = acceptedTypes.some((type) => {
          if (type.startsWith('.')) {
            return file.name.toLowerCase().endsWith(type.toLowerCase());
          }
          if (type.endsWith('/*')) {
            return file.type.startsWith(type.replace('/*', '/'));
          }
          return file.type === type;
        });

        if (isValidType && file.size <= maxSize) {
          validFiles.push(file);
        }
      }

      const remaining = maxFiles - files.length;
      onFilesSelected(validFiles.slice(0, remaining));
    },
    [accept, maxFiles, maxSize, files.length, onFilesSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(e.target.files);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [processFiles]
  );

  return (
    <div className={cn('space-y-4', className)}>
      <div
        className={cn(
          'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 sm:p-9 transition-[border-color,background-color,box-shadow,transform] cursor-pointer text-center touch-manipulation active:scale-[0.99] bg-card shadow-card',
          isDragging
            ? 'border-primary bg-primary/[0.06] ring-2 ring-primary/15'
            : 'border-border hover:border-primary/50 hover:bg-surface-secondary/90 dark:hover:bg-surface-secondary/50'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileChange}
          className="hidden"
        />
        <div
          className={cn(
            'mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl transition-colors',
            isDragging
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-primary/10 text-primary'
          )}
        >
          <Upload className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <p className="text-sm sm:text-base font-semibold text-foreground">{label}</p>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
        <p className="text-[11px] text-subtle mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-secondary dark:bg-surface-secondary px-2.5 py-0.5 border border-border/70">
          Max {formatFileSize(maxSize)} per file
          {multiple && ` · Up to ${maxFiles} files`}
        </p>
      </div>

      {showFileList && files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground">
            {files.length} file{files.length !== 1 ? 's' : ''} selected
          </p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs sm:text-sm shadow-sm"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <FileIcon className="h-3.5 w-3.5" />
                </div>
                <span className="truncate flex-1 font-medium text-foreground">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFileSize(file.size)}
                </span>
                {onRemoveFile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 touch-manipulation text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(index);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
