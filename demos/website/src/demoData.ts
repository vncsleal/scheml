export type DemoProduct = {
  id: string;
  name: string;
  categoryLabel: string;
  categoryIndex: number;
  price: number;
  batteryHours: number;
  weightKg: number;
};

export const productCatalog: DemoProduct[] = [
  { id: 'prod-01', name: 'ThinkPad X1 Carbon', categoryLabel: 'Laptop', categoryIndex: 0, price: 1849, batteryHours: 15, weightKg: 1.12 },
  { id: 'prod-02', name: 'Dell XPS 13', categoryLabel: 'Laptop', categoryIndex: 0, price: 1299, batteryHours: 12, weightKg: 1.2 },
  { id: 'prod-03', name: 'MacBook Air M3', categoryLabel: 'Laptop', categoryIndex: 0, price: 1099, batteryHours: 18, weightKg: 1.24 },
  { id: 'prod-04', name: 'Lenovo IdeaPad Slim 5', categoryLabel: 'Laptop', categoryIndex: 0, price: 699, batteryHours: 9, weightKg: 1.55 },
  { id: 'prod-05', name: 'iPad Pro M4', categoryLabel: 'Tablet', categoryIndex: 1, price: 1299, batteryHours: 10, weightKg: 0.58 },
  { id: 'prod-06', name: 'Samsung Galaxy Tab S9', categoryLabel: 'Tablet', categoryIndex: 1, price: 799, batteryHours: 12, weightKg: 0.5 },
  { id: 'prod-07', name: 'Sony WH-1000XM5', categoryLabel: 'Audio', categoryIndex: 2, price: 349, batteryHours: 30, weightKg: 0.25 },
  { id: 'prod-08', name: 'Bose QuietComfort 45', categoryLabel: 'Audio', categoryIndex: 2, price: 279, batteryHours: 24, weightKg: 0.24 },
  { id: 'prod-09', name: 'Keychron Q3 Pro', categoryLabel: 'Keyboard', categoryIndex: 3, price: 219, batteryHours: 0, weightKg: 1.1 },
  { id: 'prod-10', name: 'Logitech MX Keys S', categoryLabel: 'Keyboard', categoryIndex: 3, price: 99, batteryHours: 0, weightKg: 0.81 },
  { id: 'prod-11', name: 'Dell UltraSharp U2722D', categoryLabel: 'Monitor', categoryIndex: 4, price: 549, batteryHours: 0, weightKg: 6.1 },
  { id: 'prod-12', name: 'ASUS ProArt PA278QV', categoryLabel: 'Monitor', categoryIndex: 4, price: 349, batteryHours: 0, weightKg: 6.3 }
];

export const predictivePresets = {
  healthy: { label: 'Healthy account', daysSinceActive: 4, monthlySpend: 420, supportTickets: 1 },
  atRisk: { label: 'At-risk account', daysSinceActive: 29, monthlySpend: 180, supportTickets: 6 },
  churning: { label: 'Likely churn', daysSinceActive: 74, monthlySpend: 49, supportTickets: 11 }
} as const;

export const anomalyPresets = {
  healthy: { label: 'Healthy cluster', cpuUsage: 42, memoryPressure: 54, errorRate: 0.6 },
  spike: { label: 'Memory spike', cpuUsage: 58, memoryPressure: 92, errorRate: 1.4 },
  critical: { label: 'Critical state', cpuUsage: 95, memoryPressure: 97, errorRate: 7.8 }
} as const;

export const similarityPresets = {
  laptop: { label: 'Light laptop', categoryIndex: 0, price: 1250, batteryHours: 15, weightKg: 1.2, limit: 4 },
  audio: { label: 'Wireless audio', categoryIndex: 2, price: 320, batteryHours: 26, weightKg: 0.26, limit: 4 },
  monitor: { label: 'Budget monitor', categoryIndex: 4, price: 400, batteryHours: 0, weightKg: 5.9, limit: 4 }
} as const;

export const temporalPresets = {
  stable: { label: 'Stable usage', scores: [88, 91, 86, 89, 92] },
  declining: { label: 'Declining usage', scores: [78, 64, 51, 37, 23] },
  churnRisk: { label: 'Churn risk', scores: [30, 18, 15, 22, 11] }
} as const;

export const generativeExamples = {
  growth: {
    label: 'Growth plan account',
    context: { planTier: 'growth', willChurn: false, monthlySpend: 289 },
    expectedShape: 'choice'
  },
  rescue: {
    label: 'Rescue motion',
    context: { planTier: 'starter', willChurn: true, monthlySpend: 61 },
    expectedShape: 'choice'
  },
  enterprise: {
    label: 'Enterprise retention',
    context: { planTier: 'enterprise', willChurn: false, monthlySpend: 1280 },
    expectedShape: 'choice'
  }
} as const;