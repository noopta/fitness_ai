import { PrismaClient } from '@prisma/client';

/** One client for every personal-training service, rather than one per file. */
export const prisma = new PrismaClient();
