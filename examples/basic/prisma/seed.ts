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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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

  // ---------------------------------------------------------------------------
  // ServerMetric — 500 rows: 450 normal, 50 anomalous
  // ---------------------------------------------------------------------------
  await prisma.serverMetric.deleteMany();

  const rngMetric = createRng(99);
  const serverMetrics = Array.from({ length: 500 }, (_, i) => {
    const isAnomalous = i >= 450;
    let cpuUsage: number;
    let memoryPressure: number;
    let errorRate: number;

    if (isAnomalous) {
      // anomalous: at least one dimension significantly elevated
      const anomalyType = i % 3;
      if (anomalyType === 0) {
        // cpu spike
        cpuUsage = 82 + rngMetric() * 18;
        memoryPressure = 20 + rngMetric() * 55;
        errorRate = rngMetric() * 2.5;
      } else if (anomalyType === 1) {
        // memory + error spike
        cpuUsage = 15 + rngMetric() * 50;
        memoryPressure = 86 + rngMetric() * 13;
        errorRate = 3 + rngMetric() * 12;
      } else {
        // all elevated
        cpuUsage = 78 + rngMetric() * 22;
        memoryPressure = 80 + rngMetric() * 19;
        errorRate = 4 + rngMetric() * 11;
      }
    } else {
      cpuUsage = 12 + rngMetric() * 56;
      memoryPressure = 18 + rngMetric() * 57;
      errorRate = rngMetric() * 1.8;
    }

    return {
      id: `metric-${i + 1}`,
      timestamp: new Date(now.getTime() - (500 - i) * 60_000),
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryPressure: Math.round(memoryPressure * 100) / 100,
      errorRate: Math.round(errorRate * 1000) / 1000,
      isAnomalous,
    };
  });

  await prisma.serverMetric.createMany({ data: serverMetrics });
  console.log(`Seeded ${serverMetrics.length} server metrics`);

  // ---------------------------------------------------------------------------
  // Product — 20 items across 5 categories (categoryInt 0–4)
  // 0=laptop  1=tablet  2=audio  3=keyboard  4=monitor
  // ---------------------------------------------------------------------------
  await prisma.product.deleteMany();

  const products = [
    // laptops (cat 0)
    { id: 'prod-01', name: 'ThinkPad X1 Carbon', categoryInt: 0, price: 1849.00, batteryLife: 15.0, weightKg: 1.12 },
    { id: 'prod-02', name: 'Dell XPS 13',         categoryInt: 0, price: 1299.00, batteryLife: 12.0, weightKg: 1.20 },
    { id: 'prod-03', name: 'MacBook Air M3',       categoryInt: 0, price: 1099.00, batteryLife: 18.0, weightKg: 1.24 },
    { id: 'prod-04', name: 'Lenovo IdeaPad Slim 5',categoryInt: 0, price:  699.00, batteryLife:  9.0, weightKg: 1.55 },
    // tablets (cat 1)
    { id: 'prod-05', name: 'iPad Pro M4',          categoryInt: 1, price: 1299.00, batteryLife: 10.0, weightKg: 0.58 },
    { id: 'prod-06', name: 'Samsung Galaxy Tab S9',categoryInt: 1, price:  799.00, batteryLife: 12.0, weightKg: 0.50 },
    { id: 'prod-07', name: 'Microsoft Surface Pro 9',categoryInt: 1, price: 1199.00, batteryLife:  9.5, weightKg: 0.88 },
    { id: 'prod-08', name: 'Amazon Fire Max 11',   categoryInt: 1, price:  229.00, batteryLife: 14.0, weightKg: 0.62 },
    // audio (cat 2)
    { id: 'prod-09', name: 'Sony WH-1000XM5',      categoryInt: 2, price:  349.00, batteryLife: 30.0, weightKg: 0.25 },
    { id: 'prod-10', name: 'Bose QuietComfort 45', categoryInt: 2, price:  279.00, batteryLife: 24.0, weightKg: 0.24 },
    { id: 'prod-11', name: 'AirPods Pro (2nd gen)',categoryInt: 2, price:  249.00, batteryLife:  6.0, weightKg: 0.06 },
    { id: 'prod-12', name: 'Jabra Evolve2 85',     categoryInt: 2, price:  449.00, batteryLife: 37.0, weightKg: 0.34 },
    // keyboards (cat 3)
    { id: 'prod-13', name: 'Keychron Q3 Pro',      categoryInt: 3, price:  219.00, batteryLife:  0.0, weightKg: 1.10 },
    { id: 'prod-14', name: 'HHKB Professional Hybrid', categoryInt: 3, price: 299.00, batteryLife: 0.0, weightKg: 0.54 },
    { id: 'prod-15', name: 'Logitech MX Keys S',   categoryInt: 3, price:   99.00, batteryLife:  0.0, weightKg: 0.81 },
    { id: 'prod-16', name: 'Leopold FC660M',        categoryInt: 3, price:  139.00, batteryLife:  0.0, weightKg: 0.62 },
    // monitors (cat 4)
    { id: 'prod-17', name: 'Dell UltraSharp U2722D',categoryInt: 4, price:  549.00, batteryLife:  0.0, weightKg: 6.10 },
    { id: 'prod-18', name: 'LG 27UK850-W',          categoryInt: 4, price:  449.00, batteryLife:  0.0, weightKg: 5.90 },
    { id: 'prod-19', name: 'BenQ PD2705Q',           categoryInt: 4, price:  379.00, batteryLife:  0.0, weightKg: 5.50 },
    { id: 'prod-20', name: 'ASUS ProArt PA278QV',    categoryInt: 4, price:  349.00, batteryLife:  0.0, weightKg: 6.30 },
  ];

  await prisma.product.createMany({ data: products });
  console.log(`Seeded ${products.length} products`);

  // ---------------------------------------------------------------------------
  // EngagementEvent — 200 users × 12 weekly events = 2400 rows
  // 3 cohorts: healthy (0–79), declining (80–139), churning (140–199)
  // ---------------------------------------------------------------------------
  await prisma.engagementEvent.deleteMany();

  const rngEng = createRng(77);
  const engagementEvents: Array<{
    id: string;
    userId: string;
    engagementScore: number;
    occurredAt: Date;
    willChurn: boolean;
  }> = [];

  const baseTime = now.getTime() - 12 * 7 * 86_400_000; // 12 weeks ago

  for (let u = 0; u < 200; u++) {
    const userId = `eng-user-${u + 1}`;
    for (let w = 0; w < 12; w++) {
      let score: number;
      let willChurn: boolean;

      if (u < 80) {
        // healthy: consistently high engagement
        score = clamp(72 + rngEng() * 26 + (rngEng() - 0.5) * 8, 55, 100);
        willChurn = false;
      } else if (u < 140) {
        // declining: starts moderate, drops over time
        const decay = (w / 11) * 55; // 0 → 55 drop over 12 weeks
        score = clamp(75 - decay + (rngEng() - 0.5) * 12, 5, 90);
        willChurn = w >= 8; // labelled as churning in final 4 weeks
      } else {
        // churning: consistently low engagement
        score = clamp(8 + rngEng() * 30 + (rngEng() - 0.5) * 6, 3, 40);
        willChurn = true;
      }

      engagementEvents.push({
        id: `eng-${u + 1}-${w + 1}`,
        userId,
        engagementScore: Math.round(score * 10) / 10,
        occurredAt: new Date(baseTime + w * 7 * 86_400_000 + u * 3_600_000),
        willChurn,
      });
    }
  }

  await prisma.engagementEvent.createMany({ data: engagementEvents });
  console.log(`Seeded ${engagementEvents.length} engagement events`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
