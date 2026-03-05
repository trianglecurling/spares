import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isContentAdmin } from '../utils/auth.js';
import { getFileStorageAdapter } from '../utils/fileStorage.js';
import {
  authFileUrl,
  createStorageKey,
  detectMimeType,
  FileVisibility,
  publicFileUrl,
  sanitizeFilename,
  sha256Hex,
  shouldUseInlineContentDisposition,
} from '../utils/managedFiles.js';

const metadataSchema = z.object({
  displayName: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  visibility: z.enum(['public', 'authenticated']).optional(),
  suspectedOrphan: z.boolean().optional(),
});
const uploadMetadataSchema = z.object({
  displayName: z.string().trim().max(255).optional(),
  description: z.string().trim().max(5000).optional(),
  visibility: z.enum(['public', 'authenticated']).default('public'),
});

const resizeSchema = z.object({
  preset: z.enum(['thumbnail', 'small', 'medium', 'large']).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  keepOriginal: z.boolean(),
});

const rotateSchema = z.object({
  degrees: z.number().int().refine((value) => value % 90 === 0, 'Rotation must be a multiple of 90'),
});

const cropSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const cropRotateSchema = z.object({
  degrees: z.number().int().refine((value) => value % 90 === 0, 'Rotation must be a multiple of 90').default(0),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  const cropFields = [value.x, value.y, value.width, value.height];
  const hasAny = cropFields.some((field) => field !== undefined);
  const hasAll = cropFields.every((field) => field !== undefined);
  if (hasAny && !hasAll) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'x, y, width, and height must all be provided together for cropping',
    });
  }
});

const convertSchema = z.object({
  format: z.enum(['png', 'jpg', 'gif']),
});

function requireContentAdmin(
  request: { member?: Member },
  reply: { code: (n: number) => { send: (o: object) => unknown } }
): boolean {
  const member = request.member;
  if (!member || !isContentAdmin(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

type FileRow = {
  id: number;
  storage_key: string;
  original_filename: string;
  display_name: string | null;
  description: string | null;
  mime_type: string;
  byte_size: number;
  visibility: FileVisibility;
  checksum_sha256: string | null;
  thumbnail_storage_key: string | null;
  thumbnail_mime_type: string | null;
  thumbnail_byte_size: number | null;
  thumbnail_checksum_sha256: string | null;
  uploaded_by_member_id: number | null;
  suspected_orphan: number;
  last_referenced_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type FileListSort = 'createdAt' | 'name' | 'size' | 'type' | 'updatedAt';
type FileListOrder = 'asc' | 'desc';

function mapFileRow(row: FileRow) {
  const preferredName = row.display_name || row.original_filename;
  const thumbnailVersion = row.thumbnail_checksum_sha256 || row.checksum_sha256;
  return {
    id: row.id,
    originalFilename: row.original_filename,
    displayName: row.display_name,
    description: row.description,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    visibility: row.visibility,
    checksumSha256: row.checksum_sha256,
    uploadedByMemberId: row.uploaded_by_member_id,
    suspectedOrphan: row.suspected_orphan === 1,
    lastReferencedAt: row.last_referenced_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publicUrl: publicFileUrl(row.id, preferredName, row.checksum_sha256),
    authenticatedUrl: authFileUrl(row.id, preferredName, row.checksum_sha256),
    thumbnailPublicUrl: row.thumbnail_storage_key
      ? `/api/public/files/${row.id}/thumbnail${thumbnailVersion ? `?v=${thumbnailVersion}` : ''}`
      : null,
    thumbnailAuthenticatedUrl: row.thumbnail_storage_key
      ? `/api/files/${row.id}/thumbnail${thumbnailVersion ? `?v=${thumbnailVersion}` : ''}`
      : null,
  };
}

function resolveResizePreset(preset: 'thumbnail' | 'small' | 'medium' | 'large' | undefined): { width: number; height: number } | null {
  switch (preset) {
    case 'thumbnail':
      return { width: 320, height: 320 };
    case 'small':
      return { width: 640, height: 640 };
    case 'medium':
      return { width: 1024, height: 1024 };
    case 'large':
      return { width: 1600, height: 1600 };
    default:
      return null;
  }
}

async function getFileBuffer(storageKey: string): Promise<Buffer> {
  const stream = await getFileStorageAdapter().getReadStream(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function mimeTypeToSharpFormat(mimeType: string): 'png' | 'jpeg' | 'gif' | null {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpeg';
  if (mimeType === 'image/gif') return 'gif';
  return null;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    default:
      return '';
  }
}

function buildConvertedFilename(originalFilename: string, targetMimeType: string): string {
  const ext = extensionForMimeType(targetMimeType);
  if (!ext) return originalFilename;
  const dotIndex = originalFilename.lastIndexOf('.');
  const base = dotIndex > 0 ? originalFilename.slice(0, dotIndex) : originalFilename;
  return `${base}${ext}`;
}

async function generateThumbnail(
  imageBuffer: Buffer,
  sourceMimeType: string
): Promise<{ storageKey: string; mimeType: string; byteSize: number; checksumSha256: string } | null> {
  if (!sourceMimeType.startsWith('image/')) return null;
  const outputFormat = mimeTypeToSharpFormat(sourceMimeType) ?? 'jpeg';
  const pipeline = sharp(imageBuffer)
    .rotate()
    .resize({ width: 60, height: 60, fit: 'inside', withoutEnlargement: true });

  let outputBuffer: Buffer;
  let outputMimeType = sourceMimeType;
  if (outputFormat === 'png') {
    outputBuffer = await pipeline.png().toBuffer();
  } else if (outputFormat === 'gif') {
    outputBuffer = await pipeline.gif().toBuffer();
  } else {
    outputBuffer = await pipeline.jpeg({ quality: 80 }).toBuffer();
    outputMimeType = 'image/jpeg';
  }

  const storageKey = createStorageKey(`thumb-${Date.now()}${extensionForMimeType(outputMimeType) || '.jpg'}`);
  await getFileStorageAdapter().put(storageKey, outputBuffer);
  return {
    storageKey,
    mimeType: outputMimeType,
    byteSize: outputBuffer.length,
    checksumSha256: sha256Hex(outputBuffer),
  };
}

async function deleteStoredObject(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  try {
    await getFileStorageAdapter().delete(storageKey);
  } catch {
    // Keep deletion idempotent if object is already missing.
  }
}

async function upsertTransformedFile(
  source: FileRow,
  transformedBuffer: Buffer,
  options: {
    replaceOriginal: boolean;
    filenameSuffix: string;
    requestMemberId: number | null;
    transformedMimeType?: string;
    transformedOriginalFilename?: string;
  }
): Promise<FileRow> {
  const storage = getFileStorageAdapter();
  const { db, schema } = getDrizzleDb();
  const checksumSha256 = sha256Hex(transformedBuffer);
  const transformedMimeType = options.transformedMimeType ?? source.mime_type;
  const transformedOriginalFilename = options.transformedOriginalFilename ?? source.original_filename;
  const thumbnail = await generateThumbnail(transformedBuffer, transformedMimeType);

  if (options.replaceOriginal) {
    const newStorageKey = createStorageKey(transformedOriginalFilename);
    await storage.put(newStorageKey, transformedBuffer);
    await deleteStoredObject(source.storage_key);
    await deleteStoredObject(source.thumbnail_storage_key);
    const [row] = await db
      .update(schema.files)
      .set({
        storage_key: newStorageKey,
        original_filename: transformedOriginalFilename,
        mime_type: transformedMimeType,
        byte_size: transformedBuffer.length,
        checksum_sha256: checksumSha256,
        thumbnail_storage_key: thumbnail?.storageKey ?? null,
        thumbnail_mime_type: thumbnail?.mimeType ?? null,
        thumbnail_byte_size: thumbnail?.byteSize ?? null,
        thumbnail_checksum_sha256: thumbnail?.checksumSha256 ?? null,
      })
      .where(eq(schema.files.id, source.id))
      .returning();
    return row as FileRow;
  }

  const dotIndex = transformedOriginalFilename.lastIndexOf('.');
  const filenameBase = dotIndex > 0 ? transformedOriginalFilename.slice(0, dotIndex) : transformedOriginalFilename;
  const filenameExt = dotIndex > 0 ? source.original_filename.slice(dotIndex) : '';
  const newOriginalFilename = `${filenameBase}-${options.filenameSuffix}${filenameExt}`;
  const newStorageKey = createStorageKey(newOriginalFilename);

  await storage.put(newStorageKey, transformedBuffer);
  const [row] = await db
    .insert(schema.files)
    .values({
      storage_key: newStorageKey,
      original_filename: newOriginalFilename,
      display_name: source.display_name ? `${source.display_name} (${options.filenameSuffix})` : null,
      description: source.description,
      mime_type: transformedMimeType,
      byte_size: transformedBuffer.length,
      visibility: source.visibility,
      checksum_sha256: checksumSha256,
      thumbnail_storage_key: thumbnail?.storageKey ?? null,
      thumbnail_mime_type: thumbnail?.mimeType ?? null,
      thumbnail_byte_size: thumbnail?.byteSize ?? null,
      thumbnail_checksum_sha256: thumbnail?.checksumSha256 ?? null,
      uploaded_by_member_id: options.requestMemberId,
      suspected_orphan: 0,
      last_referenced_at: null,
    })
    .returning();
  return row as FileRow;
}

async function streamManagedFile(row: FileRow, reply: { header: (k: string, v: string) => void; send: (v: unknown) => unknown }) {
  const storage = getFileStorageAdapter();
  const downloadName = sanitizeFilename(row.display_name || row.original_filename);
  const isInline = shouldUseInlineContentDisposition(row.mime_type);
  const etag = row.checksum_sha256 ? `"${row.checksum_sha256}"` : `W/"${row.id}-${row.byte_size}"`;

  reply.header('Content-Type', row.mime_type);
  reply.header('Content-Length', String(row.byte_size));
  reply.header('ETag', etag);
  reply.header(
    'Cache-Control',
    row.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate'
  );
  reply.header('Content-Disposition', `${isInline ? 'inline' : 'attachment'}; filename="${downloadName}"`);

  const stream = await storage.getReadStream(row.storage_key);
  return reply.send(stream);
}

async function streamManagedThumbnail(
  row: FileRow,
  reply: { header: (k: string, v: string) => void; send: (v: unknown) => unknown; code: (n: number) => { send: (v: unknown) => unknown } }
) {
  if (!row.thumbnail_storage_key || !row.thumbnail_mime_type || !row.thumbnail_byte_size) {
    return reply.code(404).send({ error: 'Thumbnail not found' });
  }
  const etag = row.thumbnail_checksum_sha256
    ? `"${row.thumbnail_checksum_sha256}"`
    : `W/"thumb-${row.id}-${row.thumbnail_byte_size}"`;
  reply.header('Content-Type', row.thumbnail_mime_type);
  reply.header('Content-Length', String(row.thumbnail_byte_size));
  reply.header('ETag', etag);
  reply.header(
    'Cache-Control',
    row.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate'
  );
  reply.header('Content-Disposition', 'inline');
  const stream = await getFileStorageAdapter().getReadStream(row.thumbnail_storage_key);
  return reply.send(stream);
}

export async function fileRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: {
      visibility?: FileVisibility;
      suspectedOrphan?: 'true' | 'false';
      type?: 'all' | 'image' | 'video' | 'audio' | 'document' | 'other';
      search?: string;
      sort?: FileListSort;
      order?: FileListOrder;
      page?: number;
      pageSize?: number;
    };
  }>('/content/files', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;
    const search = request.query.search?.trim();

    const conditions: ReturnType<typeof eq>[] = [];
    if (request.query.visibility) {
      conditions.push(eq(schema.files.visibility, request.query.visibility));
    }
    if (request.query.suspectedOrphan === 'true') {
      conditions.push(eq(schema.files.suspected_orphan, 1));
    } else if (request.query.suspectedOrphan === 'false') {
      conditions.push(eq(schema.files.suspected_orphan, 0));
    }
    if (request.query.type && request.query.type !== 'all') {
      if (request.query.type === 'image') conditions.push(like(schema.files.mime_type, 'image/%'));
      else if (request.query.type === 'video') conditions.push(like(schema.files.mime_type, 'video/%'));
      else if (request.query.type === 'audio') conditions.push(like(schema.files.mime_type, 'audio/%'));
      else if (request.query.type === 'document') {
        conditions.push(
          sql`(${schema.files.mime_type} LIKE 'application/%' OR ${schema.files.mime_type} LIKE 'text/%')` as ReturnType<typeof eq>
        );
      } else if (request.query.type === 'other') {
        conditions.push(
          sql`(${schema.files.mime_type} NOT LIKE 'image/%'
            AND ${schema.files.mime_type} NOT LIKE 'video/%'
            AND ${schema.files.mime_type} NOT LIKE 'audio/%'
            AND ${schema.files.mime_type} NOT LIKE 'application/%'
            AND ${schema.files.mime_type} NOT LIKE 'text/%')` as ReturnType<typeof eq>
        );
      }
    }
    if (search) {
      const term = `%${search.toLowerCase()}%`;
      conditions.push(
        sql`(
          lower(${schema.files.original_filename}) LIKE ${term}
          OR lower(coalesce(${schema.files.display_name}, '')) LIKE ${term}
          OR lower(coalesce(${schema.files.description}, '')) LIKE ${term}
        )` as ReturnType<typeof eq>
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const sort = request.query.sort ?? 'createdAt';
    const order = request.query.order ?? 'desc';
    const sortColumn =
      sort === 'name'
        ? schema.files.original_filename
        : sort === 'size'
          ? schema.files.byte_size
          : sort === 'type'
            ? schema.files.mime_type
            : sort === 'updatedAt'
              ? schema.files.updated_at
              : schema.files.created_at;
    const sortExpr = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const countRows = whereClause
      ? await db.select({ count: sql<number>`count(*)` }).from(schema.files).where(whereClause)
      : await db.select({ count: sql<number>`count(*)` }).from(schema.files);
    const total = Number(countRows[0]?.count ?? 0);
    const rows = whereClause
      ? await db
          .select()
          .from(schema.files)
          .where(whereClause)
          .orderBy(sortExpr, asc(schema.files.id))
          .limit(pageSize)
          .offset(offset)
      : await db
          .select()
          .from(schema.files)
          .orderBy(sortExpr, asc(schema.files.id))
          .limit(pageSize)
          .offset(offset);

    return {
      items: rows.map((row) => mapFileRow(row as FileRow)),
      total,
      page,
      pageSize,
    };
  });

  fastify.get<{ Params: { id: string } }>('/content/files/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    return mapFileRow(row as FileRow);
  });

  fastify.post('/content/files', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const storage = getFileStorageAdapter();
    const filesToUpload: Array<{ originalFilename: string; mimeType: string; buffer: Buffer }> = [];
    let rawVisibility: string | undefined;
    let rawDisplayName: string | undefined;
    let rawDescription: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'visibility') {
          rawVisibility = String(part.value);
        } else if (part.fieldname === 'displayName') {
          rawDisplayName = String(part.value);
        } else if (part.fieldname === 'description') {
          rawDescription = String(part.value);
        }
        continue;
      }

      const originalFilename = sanitizeFilename(part.filename || 'upload.bin');
      const buffer = await part.toBuffer();
      if (buffer.length === 0) {
        return reply.code(400).send({ error: `File "${originalFilename}" is empty` });
      }
      filesToUpload.push({
        originalFilename,
        mimeType: detectMimeType(part.mimetype, originalFilename),
        buffer,
      });
    }

    if (filesToUpload.length === 0) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const parsedUploadMetadata = uploadMetadataSchema.safeParse({
      visibility: rawVisibility,
      displayName: rawDisplayName?.trim() ? rawDisplayName.trim() : undefined,
      description: rawDescription?.trim() ? rawDescription.trim() : undefined,
    });
    if (!parsedUploadMetadata.success) {
      return reply.code(400).send({ error: 'Invalid upload metadata', details: parsedUploadMetadata.error.flatten() });
    }
    const visibility: FileVisibility = parsedUploadMetadata.data.visibility;
    const singleFileDisplayName = filesToUpload.length === 1 ? (parsedUploadMetadata.data.displayName ?? null) : null;
    const singleFileDescription = filesToUpload.length === 1 ? (parsedUploadMetadata.data.description ?? null) : null;

    const createdRows: FileRow[] = [];
    for (const upload of filesToUpload) {
      const checksumSha256 = sha256Hex(upload.buffer);
      const storageKey = createStorageKey(upload.originalFilename);
      await storage.put(storageKey, upload.buffer);
      const thumbnail = await generateThumbnail(upload.buffer, upload.mimeType);
      const [row] = await db
        .insert(schema.files)
        .values({
          storage_key: storageKey,
          original_filename: upload.originalFilename,
          display_name: singleFileDisplayName,
          description: singleFileDescription,
          mime_type: upload.mimeType,
          byte_size: upload.buffer.length,
          visibility,
          checksum_sha256: checksumSha256,
          thumbnail_storage_key: thumbnail?.storageKey ?? null,
          thumbnail_mime_type: thumbnail?.mimeType ?? null,
          thumbnail_byte_size: thumbnail?.byteSize ?? null,
          thumbnail_checksum_sha256: thumbnail?.checksumSha256 ?? null,
          uploaded_by_member_id: request.member?.id ?? null,
          suspected_orphan: 0,
          last_referenced_at: null,
        })
        .returning();
      createdRows.push(row as FileRow);
    }

    return reply.code(201).send(createdRows.map((row) => mapFileRow(row)));
  });

  fastify.patch<{ Params: { id: string } }>('/content/files/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = metadataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined) updates.display_name = parsed.data.displayName;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.visibility !== undefined) updates.visibility = parsed.data.visibility;
    if (parsed.data.suspectedOrphan !== undefined) updates.suspected_orphan = parsed.data.suspectedOrphan ? 1 : 0;
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.update(schema.files).set(updates).where(eq(schema.files.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'File not found' });
    return mapFileRow(row as FileRow);
  });

  fastify.delete<{ Params: { id: string } }>('/content/files/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });

    await deleteStoredObject(row.storage_key);
    await deleteStoredObject(row.thumbnail_storage_key);

    await db.delete(schema.files).where(eq(schema.files.id, id));
    return { success: true };
  });

  fastify.post<{ Body: { ids?: number[] } }>('/content/files/bulk-delete', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const ids = Array.isArray(request.body?.ids)
      ? request.body.ids.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    if (ids.length === 0) return reply.code(400).send({ error: 'No ids provided' });
    const { db, schema } = getDrizzleDb();
    const rows = await db.select().from(schema.files);
    const targetRows = rows.filter((row) => ids.includes(row.id));
    for (const row of targetRows) {
      await deleteStoredObject(row.storage_key);
      await deleteStoredObject(row.thumbnail_storage_key);
      await db.delete(schema.files).where(eq(schema.files.id, row.id));
    }
    return { success: true, deletedCount: targetRows.length };
  });

  fastify.post<{ Params: { id: string } }>('/content/files/:id/resize', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const parsed = resizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    if (!row.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Only image files can be resized' });
    }

    const sourceBuffer = await getFileBuffer(row.storage_key);
    const image = sharp(sourceBuffer);
    const metadata = await image.metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;
    if (!sourceWidth || !sourceHeight) {
      return reply.code(400).send({ error: 'Could not determine image dimensions' });
    }

    const preset = resolveResizePreset(parsed.data.preset);
    const requestedWidth = parsed.data.width ?? preset?.width;
    const requestedHeight = parsed.data.height ?? preset?.height;
    if (!requestedWidth && !requestedHeight) {
      return reply.code(400).send({ error: 'Provide width/height or a preset' });
    }

    const effectiveWidth = requestedWidth ?? Math.round((requestedHeight! * sourceWidth) / sourceHeight);
    const effectiveHeight = requestedHeight ?? Math.round((requestedWidth! * sourceHeight) / sourceWidth);
    if (effectiveWidth >= sourceWidth || effectiveHeight >= sourceHeight) {
      return reply.code(400).send({ error: 'Resized dimensions must be smaller than the source image' });
    }

    const transformedBuffer = await image
      .resize({
        width: requestedWidth,
        height: requestedHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();

    const transformedRow = await upsertTransformedFile(row as FileRow, transformedBuffer, {
      replaceOriginal: !parsed.data.keepOriginal,
      filenameSuffix: `${effectiveWidth}x${effectiveHeight}`,
      requestMemberId: request.member?.id ?? null,
    });
    return mapFileRow(transformedRow);
  });

  fastify.post<{ Params: { id: string } }>('/content/files/:id/rotate', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const parsed = rotateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    if (!row.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Only image files can be rotated' });
    }

    const sourceBuffer = await getFileBuffer(row.storage_key);
    const transformedBuffer = await sharp(sourceBuffer).rotate(parsed.data.degrees).toBuffer();
    const transformedRow = await upsertTransformedFile(row as FileRow, transformedBuffer, {
      replaceOriginal: true,
      filenameSuffix: `rotated-${parsed.data.degrees}`,
      requestMemberId: request.member?.id ?? null,
    });
    return mapFileRow(transformedRow);
  });

  fastify.post<{ Params: { id: string } }>('/content/files/:id/crop', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const parsed = cropSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    if (!row.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Only image files can be cropped' });
    }

    const sourceBuffer = await getFileBuffer(row.storage_key);
    const image = sharp(sourceBuffer);
    const metadata = await image.metadata();
    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;
    if (!sourceWidth || !sourceHeight) {
      return reply.code(400).send({ error: 'Could not determine image dimensions' });
    }

    const { x, y, width, height } = parsed.data;
    if (x + width > sourceWidth || y + height > sourceHeight) {
      return reply.code(400).send({ error: 'Crop area exceeds image bounds' });
    }

    const transformedBuffer = await image.extract({ left: x, top: y, width, height }).toBuffer();
    const transformedRow = await upsertTransformedFile(row as FileRow, transformedBuffer, {
      replaceOriginal: true,
      filenameSuffix: `crop-${width}x${height}`,
      requestMemberId: request.member?.id ?? null,
    });
    return mapFileRow(transformedRow);
  });

  fastify.post<{ Params: { id: string } }>('/content/files/:id/crop-rotate', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const parsed = cropRotateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    if (!row.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Only image files can be transformed' });
    }

    const sourceBuffer = await getFileBuffer(row.storage_key);
    const rotated = sharp(sourceBuffer).rotate(parsed.data.degrees);
    const rotatedMetadata = await rotated.metadata();
    const rotatedWidth = rotatedMetadata.width;
    const rotatedHeight = rotatedMetadata.height;
    if (!rotatedWidth || !rotatedHeight) {
      return reply.code(400).send({ error: 'Could not determine image dimensions after rotation' });
    }

    const hasCrop = parsed.data.x !== undefined;
    let transformedBuffer: Buffer;
    if (hasCrop) {
      const x = parsed.data.x!;
      const y = parsed.data.y!;
      const width = parsed.data.width!;
      const height = parsed.data.height!;
      if (x + width > rotatedWidth || y + height > rotatedHeight) {
        return reply.code(400).send({ error: 'Crop area exceeds image bounds' });
      }
      transformedBuffer = await rotated.extract({ left: x, top: y, width, height }).toBuffer();
    } else {
      transformedBuffer = await rotated.toBuffer();
    }

    const transformedRow = await upsertTransformedFile(row as FileRow, transformedBuffer, {
      replaceOriginal: true,
      filenameSuffix: hasCrop ? `crop-rot-${parsed.data.degrees}` : `rot-${parsed.data.degrees}`,
      requestMemberId: request.member?.id ?? null,
    });
    return mapFileRow(transformedRow);
  });

  fastify.post<{ Params: { id: string } }>('/content/files/:id/convert', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = convertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    if (!row.mime_type.startsWith('image/')) {
      return reply.code(400).send({ error: 'Only image files can be converted' });
    }

    const targetMimeType = parsed.data.format === 'png'
      ? 'image/png'
      : parsed.data.format === 'gif'
        ? 'image/gif'
        : 'image/jpeg';
    const sourceBuffer = await getFileBuffer(row.storage_key);
    const convertedBuffer =
      parsed.data.format === 'png'
        ? await sharp(sourceBuffer).png().toBuffer()
        : parsed.data.format === 'gif'
          ? await sharp(sourceBuffer).gif().toBuffer()
          : await sharp(sourceBuffer).jpeg({ quality: 85 }).toBuffer();
    const convertedFilename = buildConvertedFilename(row.original_filename, targetMimeType);
    const transformedRow = await upsertTransformedFile(row as FileRow, convertedBuffer, {
      replaceOriginal: true,
      filenameSuffix: parsed.data.format,
      requestMemberId: request.member?.id ?? null,
      transformedMimeType: targetMimeType,
      transformedOriginalFilename: convertedFilename,
    });
    return mapFileRow(transformedRow);
  });

  fastify.get<{ Params: { id: string }; Querystring: { v?: string } }>('/files/:id/:slug?', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    const requestedVersion = request.query.v;
    if (row.checksum_sha256 && requestedVersion !== row.checksum_sha256) {
      const latestUrl = authFileUrl(row.id, row.display_name || row.original_filename, row.checksum_sha256);
      return reply.redirect(latestUrl, 302);
    }
    return streamManagedFile(row as FileRow, reply);
  });

  fastify.get<{ Params: { id: string }; Querystring: { v?: string } }>('/files/:id/thumbnail', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'File not found' });
    const requestedVersion = request.query.v;
    const latestVersion = row.thumbnail_checksum_sha256 || row.checksum_sha256;
    if (latestVersion && requestedVersion !== latestVersion) {
      const latestUrl = `/api/files/${row.id}/thumbnail?v=${latestVersion}`;
      return reply.redirect(latestUrl, 302);
    }
    return streamManagedThumbnail(row as FileRow, reply);
  });
}
