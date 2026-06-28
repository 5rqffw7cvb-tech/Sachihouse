import React, { useRef, useState } from 'react';
import { Upload, Loader2, Image as ImageIcon, X } from 'lucide-react';
import { uploadPropertyImage } from '../services/storage';

interface ImageInputProps {
  value: string;
  onChange: (url: string) => void;
  /** Property id used by the backend to authorize the write and place the object. */
  propertyId: string;
  /** Only ADMIN may paste a raw URL; hosts must upload (keeps image quality/size sane). */
  allowUrlPaste: boolean;
  label?: string;
  placeholder?: string;
  /** Tailwind classes for the preview box so it can fit different layouts. */
  previewClassName?: string;
  /** Optional remove button (e.g. for room photo lists). */
  onRemove?: () => void;
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

export const ImageInput: React.FC<ImageInputProps> = ({
  value,
  onChange,
  propertyId,
  allowUrlPaste,
  label,
  placeholder = 'https://...',
  previewClassName = 'w-28 h-20',
  onRemove,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!propertyId) {
      setError('Please save the property first, then upload images.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const url = await uploadPropertyImage(propertyId, dataUrl);
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      {label && <label className="block text-xs font-bold text-gray-500 mb-1">{label}</label>}
      <div className="flex gap-3 items-start">
        {/* Preview */}
        <div className={`${previewClassName} bg-gray-200 rounded-lg overflow-hidden shrink-0 border border-gray-200 relative`}>
          {value ? (
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <ImageIcon className="w-6 h-6" />
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="absolute top-1 right-1 bg-white/80 rounded-full p-0.5 text-gray-500 hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="flex-grow space-y-2 min-w-0">
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
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm disabled:opacity-60"
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
            ) : (
              <><Upload className="w-4 h-4" /> Upload Image</>
            )}
          </button>

          {allowUrlPaste && (
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 text-sm"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
};
