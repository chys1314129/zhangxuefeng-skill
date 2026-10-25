// lib/oss.ts
// 阿里云 OSS 上传适配（未配置 OSS 环境变量时自动回退本地持久化存储 lib/storage.ts）

import { saveUploadedPhoto } from '@/lib/storage';

export function isOssConfigured(): boolean {
  return Boolean(
    process.env.OSS_REGION &&
      process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET &&
      process.env.OSS_BUCKET
  );
}

export async function uploadToiletPhoto(
  toiletId: string,
  file: File
): Promise<string> {
  return saveUploadedPhoto(toiletId, file);
}
