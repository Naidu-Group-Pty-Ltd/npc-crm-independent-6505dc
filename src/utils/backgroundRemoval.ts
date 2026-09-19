// Background removal feature temporarily disabled to fix build timeouts
// The @huggingface/transformers package was causing bun install to timeout

import { toast } from 'sonner';

export const removeBackground = async (imageElement: HTMLImageElement): Promise<Blob> => {
  toast.error('Background removal is temporarily unavailable');
  throw new Error('Background removal feature is temporarily disabled');
};

export const loadImage = (file: Blob): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
