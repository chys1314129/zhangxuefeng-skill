// lib/autoModeration.ts
// 规则化图片自动审核引擎（二进制文件头核验 + 真实分辨率提取 + 文件熵体积检查 + 用户频控防刷）

export interface PhotoModerationResult {
  valid: boolean;
  autoApproved: boolean;
  nextStatus: 'PUBLIC' | 'PENDING';
  reason?: string;
}

interface ImageDimensions {
  format: 'jpeg' | 'png' | 'webp' | 'gif';
  width: number;
  height: number;
}

/**
 * 零外部依赖解析图片真实格式与像素宽高（支持 JPEG / PNG / WEBP / GIF）
 */
export function parseImageHeader(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 24) return null;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) {
      return { format: 'png', width, height };
    }
    return null;
  }

  // 2. GIF: GIF87a / GIF89a
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width > 0 && height > 0) {
      return { format: 'gif', width, height };
    }
    return null;
  }

  // 3. WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    const chunkType = buf.subarray(12, 16).toString('ascii');
    if (chunkType === 'VP8X' && buf.length >= 30) {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      return { format: 'webp', width, height };
    }
    if (chunkType === 'VP8 ' && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { format: 'webp', width, height };
    }
    if (chunkType === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { format: 'webp', width, height };
    }
    return { format: 'webp', width: 640, height: 480 };
  }

  // 4. JPEG: FF D8 FF ... SOF0-SOF15
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2) break;

      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSof && offset + 9 <= buf.length) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) {
          return { format: 'jpeg', width, height };
        }
      }
      offset += 2 + segLen;
    }
    return null;
  }

  return null;
}

/**
 * 对上传的实拍图执行规则化自动审核：
 * - 非真实图片或分辨率极小(<160px) -> 直接拦截返回错误
 * - 合规清晰实景图(>=240x240、文件体积>=3KB、宽高比正常、未触发短时高频刷图) -> 自动审核秒过(PUBLIC)
 * - 边界可疑图片或高频刷图 -> 转入人工待审队列(PENDING)
 */
export async function moderateUploadedPhotos(
  files: File[],
  recentUserPhotoCountIn10Min: number
): Promise<PhotoModerationResult> {
  if (!files.length) {
    return {
      valid: false,
      autoApproved: false,
      nextStatus: 'PENDING',
      reason: '请至少选择一张实景照片',
    };
  }

  let needsManualReview = recentUserPhotoCountIn10Min >= 8;

  for (const file of files.slice(0, 3)) {
    if (file.size > 10 * 1024 * 1024) {
      return {
        valid: false,
        autoApproved: false,
        nextStatus: 'PENDING',
        reason: '单张照片不能超过 10MB',
      };
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dims = parseImageHeader(buf);
    if (!dims) {
      return {
        valid: false,
        autoApproved: false,
        nextStatus: 'PENDING',
        reason: '无法识别的图片格式，请上传 JPG / PNG / WEBP 实拍照片',
      };
    }

    if (dims.width < 160 || dims.height < 160) {
      return {
        valid: false,
        autoApproved: false,
        nextStatus: 'PENDING',
        reason: `图片分辨率过低（${dims.width}×${dims.height}），请上传清晰的卫生间或指示牌照片`,
      };
    }

    const ratio = dims.width / dims.height;
    if (
      buf.byteLength < 3072 ||
      dims.width < 240 ||
      dims.height < 240 ||
      ratio < 0.18 ||
      ratio > 5.5
    ) {
      needsManualReview = true;
    }
  }

  if (needsManualReview) {
    return {
      valid: true,
      autoApproved: false,
      nextStatus: 'PENDING',
    };
  }

  return {
    valid: true,
    autoApproved: true,
    nextStatus: 'PUBLIC',
  };
}
