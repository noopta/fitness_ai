import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function logActivity(userId: string, type: 'workout' | 'nutrition' | 'wellness' | 'analysis') {
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  await prisma.activityLog.upsert({
    where: { userId_date_type: { userId, date, type } },
    create: { userId, date, type, count: 1 },
    update: { count: { increment: 1 } },
  });
}
