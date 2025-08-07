import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { processDirectory } from './migrate-imports';
import fs from 'fs/promises';
import path from 'path';

const testDir = path.join(__dirname, 'temp-test-dir-' + Date.now());

describe('processDirectory (e2e)', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(testDir, 'subdir'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'fileA.ts'),
      `import { B } from './fileB';\nconst a = 1;`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(testDir, 'fileB.ts'),
      `export const B = 'B';`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileC.ts'),
      `import { A } from '../fileA';\nconst c = 3;`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileD.ts'),
      `import { nonExistent } from './nonExistent';\nconst d = 4;`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileE.ts'),
      `import { A } from '../fileA.ts';\nconst e = 5;`,
      'utf-8'
    );
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('updates relative imports in TypeScript files by adding the ".ts" extension', async () => {
    await processDirectory(testDir);

    const fileAContent = await fs.readFile(path.join(testDir, 'fileA.ts'), 'utf-8');
    const fileCContent = await fs.readFile(path.join(testDir, 'subdir', 'fileC.ts'), 'utf-8');
    const fileDContent = await fs.readFile(path.join(testDir, 'subdir', 'fileD.ts'), 'utf-8');
    const fileEContent = await fs.readFile(path.join(testDir, 'subdir', 'fileE.ts'), 'utf-8');

    expect(fileAContent).toContain("from './fileB.ts'");
    expect(fileCContent).toContain("from '../fileA.ts'");
    expect(fileDContent).not.toContain("from './nonExistent.ts'");
    expect(fileEContent).toContain("from '../fileA.ts'");
  });
});