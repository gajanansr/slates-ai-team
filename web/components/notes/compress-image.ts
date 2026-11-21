/**
 * Shrink a photo on the device before upload: long side at most 1600px, re-encoded as WebP
 * (JPEG where the browser can't encode WebP). A 4-5 MB camera photo ends up around 150-300 KB.
 * Anything the browser can't decode (e.g. HEIC outside Safari) or a GIF goes up untouched.
 */
export async function compressImage(file: File, max = 1600, quality = 0.8): Promise<File> {
  if (file.type === 'image/gif') return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return file;
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const encode = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  let blob = await encode('image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.82);
  if (!blob || (scale === 1 && blob.size >= file.size)) return file;
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`, { type: blob.type });
}
