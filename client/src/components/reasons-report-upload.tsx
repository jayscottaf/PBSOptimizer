import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { CloudUpload, FileText, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ReasonsReportUploadProps {
  onUploadSuccess?: () => void;
}

interface UploadedReport {
  month: string;
  year: number;
  base: string;
  aircraft: string;
  count: number;
  uploadedAt: string;
}

export function ReasonsReportUpload({
  onUploadSuccess,
}: ReasonsReportUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedReports, setUploadedReports] = useState<UploadedReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Fetch uploaded reports on mount
  useEffect(() => {
    fetchUploadedReports();
  }, []);

  const fetchUploadedReports = async () => {
    try {
      const response = await fetch('/api/reasons-reports');
      if (response.ok) {
        const reports = await response.json();
        setUploadedReports(reports);
      }
    } catch (error) {
      console.error('Error fetching uploaded reports:', error);
    } finally {
      setIsLoadingReports(false);
    }
  };

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
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      const result = await response.json();

      // Build description with skipped info if applicable
      let description = `Processed ${result.stats.stored} new awards from ${result.stats.month} ${result.stats.year} (${result.stats.base} ${result.stats.aircraft})`;
      if (result.stats.skipped > 0) {
        description += `. ${result.stats.skipped} duplicates skipped.`;
      }

      toast({
        title: 'Upload successful',
        description,
      });

      // Refresh the uploaded reports list
      fetchUploadedReports();

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
    <div className="space-y-4">
      <div className="text-sm text-gray-600 space-y-2">
        <p>
          Upload a Delta Airlines Reasons Report (HTML file) to improve hold
          probability predictions.
        </p>
        <p>
          The system will extract historical award data and use it to calculate
          more accurate hold probabilities based on actual seniority numbers
          from past months.
        </p>
      </div>

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
            <CloudUpload className="mx-auto h-12 w-12 text-blue-500 mb-3 animate-pulse" />
          ) : (
            <FileText className="mx-auto h-12 w-12 text-gray-400 mb-3" />
          )}

          <p className="text-sm font-medium text-gray-700 mb-1">
            {isUploading
              ? 'Uploading and processing...'
              : 'Drop HTML file here or click to browse'}
          </p>

          <p className="text-xs text-gray-500 mb-3">
            Accepts: Delta Reasons Report HTML files
          </p>

          <Button
            variant="outline"
            className="text-blue-600 hover:text-blue-700 font-medium"
            disabled={isUploading}
          >
            {isUploading ? 'Processing...' : 'Select File'}
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

      <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
        <p className="text-xs text-blue-800">
          <strong>How it works:</strong> Historical award data is used to match
          similar trips and predict hold probabilities based on actual seniority
          numbers from previous months.
        </p>
      </div>

      {/* Previously Uploaded Reports */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="flex items-center gap-2 mb-3">
          <Database className="h-4 w-4 text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-700">
            Previously Uploaded Reports
          </h3>
        </div>

        {isLoadingReports ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : uploadedReports.length === 0 ? (
          <p className="text-xs text-gray-500">
            No reports uploaded yet. Upload your first reasons report to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {uploadedReports.map((report, index) => (
              <div
                key={index}
                className="flex justify-between items-center bg-white rounded px-3 py-2 text-xs border"
              >
                <div className="font-medium text-gray-700">
                  {report.month} {report.year} - {report.base} {report.aircraft}
                </div>
                <div className="text-gray-500">
                  {report.count} awards
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
