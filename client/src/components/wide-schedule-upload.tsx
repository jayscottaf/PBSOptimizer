import { useRef, useState } from 'react';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface Props {
  onUploadSuccess?: () => void;
}

export function WideScheduleUpload({ onUploadSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      toast({
        title: 'Invalid file type',
        description: 'Wide schedules must be PDF files.',
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadWideSchedule(file);
      toast({
        title: 'Wide schedule imported',
        description: `${result.linesStored} anonymized ${result.category} lines stored for ${result.month} ${result.year}.`,
      });
      onUploadSuccess?.();
    } catch (error) {
      toast({
        title: 'Wide schedule upload failed',
        description:
          error instanceof Error ? error.message : 'Could not import the PDF.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'hover:border-primary'
      } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={event => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={event => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files[0]);
      }}
    >
      {uploading ? (
        <LoaderCircle className="mx-auto mb-2 h-8 w-8 animate-spin text-primary" />
      ) : (
        <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
      )}
      <p className="mb-2 text-sm text-muted-foreground">
        {uploading
          ? 'Anonymizing and importing…'
          : 'Drop wide schedule PDF here or click to browse'}
      </p>
      <Button variant="link" className="h-auto p-0" disabled={uploading}>
        Select File
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={event => void upload(event.target.files?.[0])}
      />
    </div>
  );
}
