import { z } from 'zod';

export const PaginationMetadataSchema = z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    totalCount: z.number().int().nonnegative()
});

export type PaginationMetadata = z.infer<typeof PaginationMetadataSchema>;

export const MessageHistoryQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(150).optional().default(150)
});

export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>;
