import { ModelVersionManager, ABTestingStrategy } from '../../src';
import path from 'path';

async function main() {
  console.log('Model Versioning & A/B Testing Example\n');
  
  const modelDir = path.join(process.cwd(), 'prisml', 'generated');
  const versionManager = new ModelVersionManager(modelDir);

  // Example 1: Register model versions
  console.log('Example 1: Version Registration');
  
  versionManager.registerVersion('churnPredictor', 'v1.0', {
    modelPath: path.join(modelDir, 'churnPredictor-v1.0.onnx'),
    accuracy: 0.82,
    metrics: {
      precision: 0.79,
      recall: 0.85,
      f1Score: 0.82
    },
    metadata: {
      trainingDate: new Date('2026-01-10'),
      datasetSize: 10000,
      algorithm: 'RandomForest',
      features: ['totalSpent', 'daysSinceLastLogin', 'accountAge']
    }
  });

  versionManager.registerVersion('churnPredictor', 'v1.1', {
    modelPath: path.join(modelDir, 'churnPredictor-v1.1.onnx'),
    accuracy: 0.87,
    metrics: {
      precision: 0.85,
      recall: 0.89,
      f1Score: 0.87
    },
    metadata: {
      trainingDate: new Date('2026-01-14'),
      datasetSize: 15000,
      algorithm: 'GradientBoosting',
      features: ['totalSpent', 'daysSinceLastLogin', 'accountAge', 'purchaseFrequency']
    }
  });

  console.log('Registered versions:');
  const versions = versionManager.listVersions('churnPredictor');
  versions.forEach((v: any) => {
    console.log(`  - ${v.version}: accuracy ${v.accuracy?.toFixed(2)}`);
  });
  console.log();

  // Example 2: Deploy a version
  console.log('Example 2: Version Deployment');
  
  versionManager.activateVersion('churnPredictor', 'v1.0');
  console.log('Deployed v1.0 to production');
  
  const activeV1 = versionManager.getActiveVersion('churnPredictor');
  console.log(`Active version: ${activeV1?.version}\n`);

  // Example 3: Compare versions
  console.log('Example 3: Version Comparison');
  
  const comparison = versionManager.compareVersions('churnPredictor', 'v1.0', 'v1.1');
  if (comparison) {
    console.log('Performance improvements in v1.1:');
    console.log(`  - Accuracy: +${(comparison.accuracyDiff! * 100).toFixed(1)}%`);
    console.log(`  - Precision: +${(comparison.metricsDiff.precision * 100).toFixed(1)}%`);
    console.log(`  - Recall: +${(comparison.metricsDiff.recall * 100).toFixed(1)}%`);
    console.log(`  - F1 Score: +${(comparison.metricsDiff.f1Score * 100).toFixed(1)}%`);
  }
  console.log();

  // Example 4: A/B Testing
  console.log('Example 4: A/B Testing Setup');
  
  const abTesting = new ABTestingStrategy(versionManager);
  
  // Configure 70/30 split between v1.0 and v1.1
  abTesting.configureTest('churnPredictor', {
    'v1.0': 0.7,
    'v1.1': 0.3
  });
  
  console.log('A/B test configured: 70% v1.0, 30% v1.1');
  
  // Simulate user routing
  const testUsers = [
    'user-123', 'user-456', 'user-789', 
    'user-abc', 'user-def', 'user-ghi'
  ];
  
  console.log('\nUser routing (consistent hashing):');
  testUsers.forEach(userId => {
    const version = abTesting.selectVersion('churnPredictor', userId);
    console.log(`  ${userId} → ${version}`);
    
    // Verify consistency
    const version2 = abTesting.selectVersion('churnPredictor', userId);
    if (version !== version2) {
      console.error('ERROR: Inconsistent routing!');
    }
  });
  console.log();

  // Example 5: Traffic distribution check
  console.log('Example 5: Traffic Distribution Analysis');
  
  const distribution = { 'v1.0': 0, 'v1.1': 0 };
  const testSize = 1000;
  
  for (let i = 0; i < testSize; i++) {
    const version = abTesting.selectVersion('churnPredictor', `user-${i}`);
    if (version) (distribution as any)[version]++;
  }
  
  console.log(`Distribution across ${testSize} users:`);
  console.log(`  v1.0: ${distribution['v1.0']} (${(distribution['v1.0'] / testSize * 100).toFixed(1)}%)`);
  console.log(`  v1.1: ${distribution['v1.1']} (${(distribution['v1.1'] / testSize * 100).toFixed(1)}%)`);
  console.log();

  // Example 6: Promote winner after A/B test
  console.log('Example 6: Promote Winner');
  
  // Simulate: After 2 weeks, v1.1 shows better metrics
  console.log('A/B test results after 2 weeks:');
  console.log('  v1.0: 82% accuracy, 15% churn reduction');
  console.log('  v1.1: 87% accuracy, 23% churn reduction');
  console.log('\nPromoting v1.1 to 100% traffic...');
  
  abTesting.promoteWinner('churnPredictor', 'v1.1');
  
  const newActive = versionManager.getActiveVersion('churnPredictor');
  console.log(`Active version: ${newActive?.version}`);
  console.log('A/B test ended, all traffic now on v1.1\n');

  // Example 7: Rollback scenario
  console.log('Example 7: Rollback (Emergency)');
  
  // Simulate: Critical bug found in v1.1
  console.log('ALERT: Critical bug detected in v1.1!');
  console.log('Initiating rollback to v1.0...');
  
  versionManager.rollback('churnPredictor', 'v1.0');
  
  const rolledBack = versionManager.getActiveVersion('churnPredictor');
  console.log(`Rolled back to: ${rolledBack?.version}`);
  console.log('System stable on previous version\n');

  // Example 8: Version history
  console.log('Example 8: Version History');
  
  const history = versionManager.getVersionHistory('churnPredictor');
  console.log(`Current version: ${history.currentVersion}`);
  console.log('\nVersion timeline:');
  history.versions.forEach((v: any, i: number) => {
    const status = v.isActive ? '(active)' : '(inactive)';
    const deployed = v.deployedAt ? `deployed ${v.deployedAt.toLocaleDateString()}` : 'never deployed';
    console.log(`  ${i + 1}. ${v.version} ${status} - accuracy ${v.accuracy?.toFixed(2)} (${deployed})`);
  });
  console.log();

  // Example 9: Cleanup old versions
  console.log('Example 9: Version Cleanup');
  
  // Safe to delete v1.0 now (not active)
  const deleted = versionManager.deleteVersion('churnPredictor', 'v1.1');
  console.log(`Deleted v1.1: ${deleted ? 'Success' : 'Failed'}`);
  
  const remainingVersions = versionManager.listVersions('churnPredictor');
  console.log(`Remaining versions: ${remainingVersions.map((v: any) => v.version).join(', ')}\n`);

  // Example 10: Persist registry
  console.log('Example 10: Registry Persistence');
  
  const registry = versionManager.exportRegistry();
  console.log('Exported registry (sample):');
  console.log(JSON.stringify(registry, null, 2).substring(0, 200) + '...');
  
  console.log('\n Registry can be saved to database or file for persistence');
  console.log('Use importRegistry() to restore on next startup');
}

main().catch(console.error);
