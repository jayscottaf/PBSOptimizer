import { useState, useRef } from 'react';
import { Button } from './ui/button';
import { CloudUpload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';

interface ReasonsReportUploadProps {
  onUploadSuccess?: () => void;
}

export function ReasonsReportUpload({
  onUploadSuccess,
}: ReasonsReportUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (file: File) => {
    // Validate file type (HTML only)
    if (file.type !== 'text/html' && !file.name.endsWith('.html')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an HTML file (.html).',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('reasonsReport', file);

      // Upload the reasons report
      const response = await fetch('/api/upload-reasons-report', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to upload reasons report')
        );
      }

      const result = await response.json();

      // Build description with skipped and linking info
      let description = `Processed ${result.stats.stored} new awards from ${result.stats.month} ${result.stats.year} (${result.stats.base} ${result.stats.aircraft})`;
      if (result.stats.skipped > 0) {
        description += `. ${result.stats.skipped} duplicates skipped.`;
      }
      if (result.stats.linked > 0) {
        description += ` ${result.stats.linked} linked to bid package.`;
      }

      toast({
        title: 'Upload successful',
        description,
      });
      
      // Show warning if no bid package was found
      if (result.warning) {
        toast({
          title: 'Warning',
          description: result.warning,
          variant: 'destructive',
        });
      }

      // Call success callback
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to upload reasons report. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-blue-500'
        } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <div className="flex flex-col items-center">
          {isUploading ? (
            <CloudUpload className="mx-auto h-8 w-8 text-blue-500 mb-2 animate-pulse" />
          ) : (
            <FileText className="mx-auto h-8 w-8 text-gray-400 mb-2" />
          )}

          <p className="text-sm text-gray-600 mb-2">
            {isUploading
              ? 'Uploading...'
              : 'Drop HTML file here or click to browse'}
          </p>

          <Button
            variant="link"
            className="text-blue-600 hover:text-blue-700 font-medium p-0"
            disabled={isUploading}
          >
            Select File
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <div className="text-xs text-gray-500 flex items-center">
        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
        HTML format (Delta Reasons Report)
      </div>
    </div>
  );
}
