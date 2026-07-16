import { PrismaClient } from '@prisma/client';

/**
 * A single shared Prisma client. In dev (and serverless with hot-reload) a new
 * client per module reload would exhaust the connection pool, so we stash one on
 * globalThis and reuse it; production gets a fresh singleton per process.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
