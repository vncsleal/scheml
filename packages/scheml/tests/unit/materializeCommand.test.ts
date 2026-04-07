import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PredictionSession } from '../../src/prediction';
import { materializeCommand } from '../../src/commands/materialize';
import { createAdvancedTempProject } from '../support/project';

describe('materializeCommand cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposes the prediction session and disconnects the extractor after success', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-materialize-command-success-'));

    try {
      const project = await createAdvancedTempProject(tempRoot);
      const disposeSpy = vi.spyOn(PredictionSession.prototype, 'disposeAll');

      await materializeCommand.handler({
        config: path.join(tempRoot, 'scheml.config.ts'),
        schema: project.schemaPath,
        output: project.artifactsDir,
        trait: project.predictiveTraitName,
        'batch-size': 2,
        json: true,
      });

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      const cleanup = JSON.parse(fs.readFileSync(project.cleanupPath, 'utf-8')) as { events: string[] };
      expect(cleanup.events).toContain('disconnect');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('disposes the prediction session and disconnects the extractor after failure', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scheml-materialize-command-failure-'));

    try {
      const project = await createAdvancedTempProject(tempRoot);
      const disposeSpy = vi.spyOn(PredictionSession.prototype, 'disposeAll');
      const rows = JSON.parse(fs.readFileSync(project.dataPath, 'utf-8')) as Array<Record<string, unknown>>;
      delete rows[0].id;
      fs.writeFileSync(project.dataPath, JSON.stringify(rows, null, 2), 'utf-8');

      await materializeCommand.handler({
        config: path.join(tempRoot, 'scheml.config.ts'),
        schema: project.schemaPath,
        output: project.artifactsDir,
        trait: project.predictiveTraitName,
        'batch-size': 2,
        json: false,
      }).catch(() => undefined);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      const cleanup = JSON.parse(fs.readFileSync(project.cleanupPath, 'utf-8')) as { events: string[] };
      expect(cleanup.events).toContain('disconnect');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});