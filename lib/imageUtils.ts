// lib/imageUtils.ts

/**
 * 前端图片压缩（自动缩放至最大宽度 1200px，JPEG 0.82 质量）
 */
export function compressImage(
  file: File,
  options: { maxWidth?: number; quality?: number } = {}
): Promise<File> {
  const { maxWidth = 1200, quality = 0.82 } = options;

  if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
    return Promise.resolve(file);
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
            resolve(
              new File([blob], `${baseName}.jpg`, {
                type: 'image/jpeg',
              })
            );
          },
          'image/jpeg',
          quality
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
