/**
 * Utility to generate small, lightweight thumbnail blobs and extract image dimensions
 * without keeping massive multi-megapixel bitmaps in GPU or browser memory.
 */

export interface ThumbnailResult {
  preview: string;
  width?: number;
  height?: number;
}

export async function createImageThumbnail(
  file: File | Blob,
  maxDim = 160,
  mimeType = "image/webp"
): Promise<ThumbnailResult> {
  // If file is empty or clearly not an image, return early
  if (!file || file.size === 0) {
    return { preview: "" };
  }

  // Fast path: try createImageBitmap (Supported in all modern browsers)
  if (typeof window !== "undefined" && "createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;

      if (width > 0 && height > 0) {
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const thumbW = Math.max(1, Math.round(width * scale));
        const thumbH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = thumbW;
        canvas.height = thumbH;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "medium";
          ctx.drawImage(bitmap, 0, 0, thumbW, thumbH);
        }

        // Free the large uncompressed bitmap immediately
        bitmap.close();

        const preview = await new Promise<string>((resolve) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(URL.createObjectURL(blob));
              } else {
                resolve("");
              }
            },
            mimeType,
            0.7
          );
        });

        return { preview, width, height };
      }
      bitmap.close();
    } catch {
      // Fall through to HTMLImageElement fallback (e.g. CMYK JPEG, ICC profile variants)
    }
  }

  // Fallback: HTMLImageElement
  if (typeof window !== "undefined") {
    const tempUrl = URL.createObjectURL(file);
    try {
      const result = await new Promise<ThumbnailResult>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          if (width > 0 && height > 0) {
            const scale = Math.min(1, maxDim / Math.max(width, height));
            const thumbW = Math.max(1, Math.round(width * scale));
            const thumbH = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = thumbW;
            canvas.height = thumbH;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "medium";
              ctx.drawImage(img, 0, 0, thumbW, thumbH);
            }

            canvas.toBlob(
              (blob) => {
                URL.revokeObjectURL(tempUrl);
                if (blob) {
                  resolve({ preview: URL.createObjectURL(blob), width, height });
                } else {
                  resolve({ preview: "", width, height });
                }
              },
              mimeType,
              0.7
            );
          } else {
            URL.revokeObjectURL(tempUrl);
            resolve({ preview: "" });
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(tempUrl);
          resolve({ preview: "" });
        };
        img.src = tempUrl;
      });
      return result;
    } catch {
      URL.revokeObjectURL(tempUrl);
      return { preview: "" };
    }
  }

  return { preview: "" };
}

/**
 * Run async operations with a concurrency limit to prevent memory spikes
 * when dropping 20-100 large files simultaneously.
 */
export async function mapConcurrently<T, R>(
  items: T[],
  concurrency: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        results[idx] = await workerFn(items[idx], idx);
      }
    }
  );

  await Promise.all(workers);
  return results;
}
