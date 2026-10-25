import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

function getUploadRoot(): string {
  const baseDir =
    process.env.POCKETBAY_DATA_DIR || path.join(process.cwd(), 'data');
  return path.resolve(baseDir, 'uploads');
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const uploadRoot = getUploadRoot();
    const segments = params.path || [];
    const safeSegments = segments.map((s) => path.basename(s));
    const resolvedPath = path.resolve(uploadRoot, ...safeSegments);

    if (!resolvedPath.startsWith(uploadRoot)) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const buffer = await fs.readFile(resolvedPath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': getMimeType(resolvedPath),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
