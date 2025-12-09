import { z } from "zod";
import { randomUUID } from "crypto";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { s3client, s3bucket } from "@/storage/files";
import { log } from "@/utils/log";

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const MAX_BLOB_SIZE = 20 * 1024 * 1024; // 20MB

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
    return ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType);
}

export function blobRoutes(app: Fastify) {

    // Register content type parser for binary data
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
        done(null, body);
    });

    // Upload encrypted blob
    app.post('/v1/sessions/:sid/blobs', {
        schema: {
            params: z.object({
                sid: z.string()
            })
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const { sid } = request.params;
        const userId = request.userId;

        // Get mime type and size from headers
        const mimeType = request.headers['x-blob-mimetype'] as string;
        const originalSizeStr = request.headers['x-blob-size'] as string;

        if (!mimeType) {
            return reply.status(400).send({ error: 'Missing X-Blob-MimeType header' });
        }

        if (!isAllowedMimeType(mimeType)) {
            return reply.status(400).send({
                error: `Invalid mime type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`
            });
        }

        const originalSize = parseInt(originalSizeStr, 10);
        if (isNaN(originalSize) || originalSize <= 0) {
            return reply.status(400).send({ error: 'Invalid or missing X-Blob-Size header' });
        }

        // Verify session ownership
        const session = await db.session.findFirst({
            where: { id: sid, accountId: userId }
        });
        if (!session) {
            log({ module: 'blob-upload', userId, sessionId: sid }, `Session not found or not owned by user`);
            return reply.status(404).send({ error: 'Session not found' });
        }

        // Get raw encrypted body
        // Fastify collects the body as Buffer when content-type is application/octet-stream
        const encryptedBody = request.body as Buffer;

        if (!encryptedBody || encryptedBody.length === 0) {
            return reply.status(400).send({ error: 'Empty body' });
        }

        if (encryptedBody.length > MAX_BLOB_SIZE) {
            return reply.status(413).send({
                error: `Blob too large. Maximum size: ${MAX_BLOB_SIZE / 1024 / 1024}MB`
            });
        }

        const blobId = randomUUID();
        const s3Key = `blobs/${userId}/${sid}/${blobId}`;

        try {
            // Upload encrypted blob to Minio (server never decrypts)
            await s3client.putObject(s3bucket, s3Key, encryptedBody, encryptedBody.length, {
                'Content-Type': 'application/octet-stream',
                'x-amz-meta-original-mimetype': mimeType,
                'x-amz-meta-original-size': originalSize.toString(),
            });

            // Save metadata to database
            await db.sessionBlob.create({
                data: {
                    id: blobId,
                    sessionId: sid,
                    accountId: userId,
                    mimeType,
                    size: originalSize,
                    s3Key,
                }
            });

            log({
                module: 'blob-upload',
                userId,
                sessionId: sid,
                blobId,
                mimeType,
                originalSize,
                encryptedSize: encryptedBody.length
            }, `Blob uploaded successfully`);

            return reply.send({
                blobId,
                size: encryptedBody.length
            });
        } catch (error) {
            log({
                module: 'blob-upload',
                userId,
                sessionId: sid,
                error: String(error)
            }, `Failed to upload blob`);
            return reply.status(500).send({ error: 'Failed to upload blob' });
        }
    });

    // Download encrypted blob
    app.get('/v1/sessions/:sid/blobs/:blobId', {
        schema: {
            params: z.object({
                sid: z.string(),
                blobId: z.string()
            })
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const { sid, blobId } = request.params;
        const userId = request.userId;

        // Verify ownership through session
        const blob = await db.sessionBlob.findFirst({
            where: {
                id: blobId,
                sessionId: sid,
                accountId: userId
            }
        });

        if (!blob) {
            log({ module: 'blob-download', userId, sessionId: sid, blobId }, `Blob not found or not owned by user`);
            return reply.status(404).send({ error: 'Blob not found' });
        }

        try {
            // Stream from Minio
            const stream = await s3client.getObject(s3bucket, blob.s3Key);

            reply.header('Content-Type', 'application/octet-stream');
            reply.header('X-Blob-MimeType', blob.mimeType);
            reply.header('X-Blob-Size', blob.size.toString());

            log({ module: 'blob-download', userId, sessionId: sid, blobId }, `Blob downloaded`);

            return reply.send(stream);
        } catch (error) {
            log({
                module: 'blob-download',
                userId,
                sessionId: sid,
                blobId,
                error: String(error)
            }, `Failed to download blob`);
            return reply.status(500).send({ error: 'Failed to download blob' });
        }
    });

    // Delete blob (optional - for cleanup)
    app.delete('/v1/sessions/:sid/blobs/:blobId', {
        schema: {
            params: z.object({
                sid: z.string(),
                blobId: z.string()
            })
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const { sid, blobId } = request.params;
        const userId = request.userId;

        // Verify ownership
        const blob = await db.sessionBlob.findFirst({
            where: {
                id: blobId,
                sessionId: sid,
                accountId: userId
            }
        });

        if (!blob) {
            return reply.status(404).send({ error: 'Blob not found' });
        }

        try {
            // Delete from Minio
            await s3client.removeObject(s3bucket, blob.s3Key);

            // Delete from database
            await db.sessionBlob.delete({
                where: { id: blobId }
            });

            log({ module: 'blob-delete', userId, sessionId: sid, blobId }, `Blob deleted`);

            return reply.send({ success: true });
        } catch (error) {
            log({
                module: 'blob-delete',
                userId,
                sessionId: sid,
                blobId,
                error: String(error)
            }, `Failed to delete blob`);
            return reply.status(500).send({ error: 'Failed to delete blob' });
        }
    });
}
