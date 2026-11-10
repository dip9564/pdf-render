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
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 sm:p-8 transition-all cursor-pointer text-center touch-manipulation active:scale-[0.99]',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 active:bg-muted/60'
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
        <Upload className={cn('h-8 w-8 sm:h-10 sm:w-10 mb-3', isDragging ? 'text-primary' : 'text-muted-foreground')} />
        <p className="text-sm sm:text-base font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
        <p className="text-[11px] text-muted-foreground mt-1">
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
                className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs sm:text-sm"
              >
                <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 font-medium">{file.name}</span>
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
