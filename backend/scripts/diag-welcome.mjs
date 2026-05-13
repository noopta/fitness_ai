// One-shot diagnostic for the Anakin-note bug. Prints the bits of the user
// record that gate whether /coach/welcome renders on the home screen.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const username = process.argv[2] || 'pomelowarrior';
const user = await prisma.user.findFirst({
  where: { username },
  select: {
    id: true,
    username: true,
    name: true,
    tier: true,
    coachProfile: true,
    savedProgram: true,
    programStartDate: true,
    currentStreak: true,
  },
});

if (!user) {
  console.log(`No user found for username: ${username}`);
  process.exit(1);
}

const profile = user.coachProfile ? JSON.parse(user.coachProfile) : {};

console.log(JSON.stringify({
  id: user.id,
  username: user.username,
  name: user.name,
  tier: user.tier,
  hasProgram: !!user.savedProgram,
  programStartDate: user.programStartDate,
  currentStreak: user.currentStreak,
  welcome: {
    welcomeMessage: profile.welcomeMessage ?? null,
    welcomeMessageDate: profile.welcomeMessageDate ?? null,
    welcomeDismissed: profile.welcomeDismissed ?? false,
    cacheAgeHours: profile.welcomeMessageDate
      ? ((Date.now() - new Date(profile.welcomeMessageDate).getTime()) / 3600000).toFixed(2)
      : null,
  },
}, null, 2));

await prisma.$disconnect();
