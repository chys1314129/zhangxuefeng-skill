// lib/storage.ts
// 图片存储服务：默认持久化到本地 data/uploads（通过 /api/uploads 访问）；配置了阿里云 OSS 环境变量时可无缝走云存储

import fs from 'node:fs/promises';
import path from 'node:path';

function getUploadRoot(): string {
  const baseDir =
    process.env.POCKETBAY_DATA_DIR || path.join(process.cwd(), 'data');
  return path.resolve(baseDir, 'uploads');
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(-60) || 'photo.jpg';
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('gif')) return '.gif';
  return '.jpg';
}

export async function saveUploadedPhoto(
  toiletId: string,
  file: File
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 限制单张图片最大 10MB
  if (buffer.byteLength > 10 * 1024 * 1024) {
    throw new Error('单张照片大小不能超过 10MB');
  }

  let safeName = sanitizeFileName(file.name);
  if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(safeName)) {
    safeName += extFromMime(file.type || 'image/jpeg');
  }

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
  const safeToiletDir = toiletId.replace(/[^a-zA-Z0-9_-]/g, '');
  const targetDir = path.join(getUploadRoot(), safeToiletDir);

  await fs.mkdir(targetDir, { recursive: true });
  const fullPath = path.join(targetDir, fileName);
  await fs.writeFile(fullPath, buffer);

  return `/api/uploads/${safeToiletDir}/${fileName}`;
}
