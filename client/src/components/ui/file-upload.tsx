import { useState, useRef } from "react";
import { Button } from "./button";
import { CloudUpload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface FileUploadProps {
  onUpload: (file: File) => void;
}

export function FileUpload({ onUpload }: FileUploadProps) {
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
    if (file.type !== 'application/pdf' && file.type !== 'text/plain') {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF or TXT file.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    
    try {
      await api.uploadBidPackage(file, {
        name: file.name,
        month: "August", // Would be dynamically determined
        year: 2025,
        base: "NYC",
        aircraft: "A220",
      });
      
      toast({
        title: "Upload successful",
        description: "Bid package uploaded and processing has begun.",
      });
      
      // Wait a moment for processing to begin, then trigger refresh
      setTimeout(() => {
        onUpload(file);
      }, 1000);
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "Failed to upload bid package. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
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
      <CloudUpload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
      <p className="text-sm text-gray-600 mb-2">
        {isUploading ? 'Uploading...' : 'Drop PDF or TXT file here or click to browse'}
      </p>
      <Button 
        variant="link" 
        className="text-blue-600 hover:text-blue-700 font-medium p-0"
        disabled={isUploading}
      >
        Select File
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
