import { PrismaClient } from '@prisma/client';
import { productCatalog } from '../src/demoData';

const prisma = new PrismaClient();

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

async function seedUsers(now: Date) {
  const random = createRng(42);
  await prisma.user.deleteMany();

  const plans = ['starter', 'growth', 'enterprise'] as const;
  const users = Array.from({ length: 480 }, (_, index) => {
    const planTier = plans[index % plans.length];
    const inactivityDays = Math.max(
      0,
      Math.round(random() * 72 + (planTier === 'starter' ? 10 : planTier === 'growth' ? 0 : -12))
    );
    const monthlySpend = round(
      (planTier === 'starter' ? 38 : planTier === 'growth' ? 142 : 510) + random() * (planTier === 'enterprise' ? 520 : 110)
    );
    const supportTickets = clamp(
      Math.round((planTier === 'starter' ? 3.2 : 1.5) + random() * 5 + (monthlySpend < 120 ? 2 : 0)),
      0,
      14,
    );
    const churnScore = inactivityDays * 1.4 + supportTickets * 7.2 - monthlySpend * 0.07 + (random() - 0.5) * 12;
    const willChurn = churnScore > 54;
    const createdAt = new Date(now.getTime() - (90 + index) * 86_400_000);

    return {
      id: `user-${index + 1}`,
      email: `demo-user-${index + 1}@scheml.dev`,
      createdAt,
      lastActiveAt: new Date(now.getTime() - inactivityDays * 86_400_000),
      monthlySpend,
      supportTickets,
      planTier,
      willChurn,
    };
  });

  await prisma.user.createMany({ data: users });
}

async function seedServerMetrics(now: Date) {
  const random = createRng(99);
  await prisma.serverMetric.deleteMany();

  const rows = Array.from({ length: 260 }, (_, index) => {
    const isAnomalous = index >= 220;
    let cpuUsage = 22 + random() * 44;
    let memoryPressure = 28 + random() * 42;
    let errorRate = random() * 1.4;

    if (isAnomalous) {
      const mode = index % 3;
      if (mode === 0) {
        cpuUsage = 84 + random() * 15;
      } else if (mode === 1) {
        memoryPressure = 86 + random() * 11;
        errorRate = 2.5 + random() * 4.5;
      } else {
        cpuUsage = 78 + random() * 18;
        memoryPressure = 81 + random() * 16;
        errorRate = 4 + random() * 5;
      }
    }

    return {
      id: `metric-${index + 1}`,
      recordedAt: new Date(now.getTime() - (260 - index) * 60_000),
      cpuUsage: round(cpuUsage),
      memoryPressure: round(memoryPressure),
      errorRate: round(errorRate),
      isAnomalous,
    };
  });

  await prisma.serverMetric.createMany({ data: rows });
}

async function seedProducts() {
  await prisma.product.deleteMany();
  await prisma.product.createMany({ data: productCatalog });
}

async function seedEngagement(now: Date) {
  const random = createRng(77);
  await prisma.engagementEvent.deleteMany();

  const base = now.getTime() - 90 * 86_400_000;
  const rows = Array.from({ length: 72 }, (_, index) => {
    const phase = index / 71;
    const baseline = phase < 0.45
      ? 82 - phase * 15
      : phase < 0.72
        ? 65 - (phase - 0.45) * 85
        : 28 - (phase - 0.72) * 22;
    const engagementScore = round(clamp(baseline + (random() - 0.5) * 10, 4, 96));
    const willChurnSoon = engagementScore < 34;

    return {
      id: `eng-${index + 1}`,
      createdAt: new Date(base + index * 86_400_000),
      engagementScore,
      willChurnSoon,
    };
  });

  await prisma.engagementEvent.createMany({ data: rows });
}

async function main() {
  const now = new Date('2026-04-07T12:00:00.000Z');
  await seedUsers(now);
  await seedServerMetrics(now);
  await seedProducts();
  await seedEngagement(now);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });