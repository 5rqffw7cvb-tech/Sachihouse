import React, { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { uploadPropertyImage } from '../services/storage';

interface UploadButtonProps {
  propertyId: string;
  onUploaded: (url: string) => void;
  label?: string;
  className?: string;
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

/** Compact button that uploads an image and returns its public URL via onUploaded. */
export const UploadButton: React.FC<UploadButtonProps> = ({
  propertyId,
  onUploaded,
  label = 'Upload Image',
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!propertyId) {
      setError('Save the property first.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPropertyImage(propertyId, dataUrl);
      onUploaded(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={className || 'inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm disabled:opacity-60'}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? 'Uploading...' : label}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
};
