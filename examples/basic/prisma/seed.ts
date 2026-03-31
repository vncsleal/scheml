import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function createRng(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const random = createRng(42);
  const now = new Date('2026-03-08T12:00:00.000Z');
  const sources = ['organic', 'paid', 'referral'] as const;
  const plans = ['free', 'pro', 'enterprise'] as const;

  await prisma.user.deleteMany();

  const users = Array.from({ length: 480 }, (_, index) => {
    const source = sources[index % sources.length];
    const plan = plans[index % plans.length];
    const accountAgeDays = 45 + Math.floor(random() * 760);
    const monthsActive = Math.max(1, Math.floor(accountAgeDays / 30));
    const planBaseSpend = plan === 'free' ? 32 : plan === 'pro' ? 118 : 265;
    const spendSwing = random() * (plan === 'enterprise' ? 120 : 55);
    const sourceLift = source === 'referral' ? 18 : source === 'organic' ? 11 : -9;
    const monthlySpend = roundToCents(planBaseSpend + spendSwing + sourceLift);
    const supportTickets = Math.max(
      0,
      Math.min(
        12,
        Math.round((plan === 'free' ? 3.4 : 1.6) + random() * 5 + (monthlySpend < 80 ? 2 : 0))
      )
    );
    const inactivityDays = Math.max(
      0,
      Math.round(
        random() * 70 +
          supportTickets * 3.2 -
          monthlySpend * 0.06 +
          (plan === 'free' ? 11 : plan === 'pro' ? -4 : -9)
      )
    );
    const churnScore = inactivityDays * 1.45 + supportTickets * 7.5 - monthlySpend * 0.1 + (random() - 0.5) * 10;
    const willChurn = churnScore > 56;
    const planPremiumBoost = plan === 'enterprise' ? 980 : plan === 'pro' ? 360 : 40;
    const actualLifetimeValue = roundToCents(
      monthlySpend * monthsActive * (source === 'referral' ? 1.12 : source === 'organic' ? 1.04 : 0.93) +
        planPremiumBoost +
        accountAgeDays * 1.35 +
        (random() - 0.5) * 85
    );

    return {
      id: `user-${index + 1}`,
      email: `demo-user-${index + 1}@scheml.dev`,
      createdAt: new Date(now.getTime() - accountAgeDays * 86_400_000),
      source,
      monthlySpend,
      monthsActive,
      plan,
      actualLifetimeValue,
      lastActiveAt: new Date(now.getTime() - inactivityDays * 86_400_000),
      supportTickets,
      willChurn,
    };
  });

  await prisma.user.createMany({ data: users });

  console.log(`Seeded ${users.length} demo users`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });