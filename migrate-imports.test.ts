import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { processDirectory } from './migrate-imports';
import fs from 'fs/promises';
import path from 'path';

// Define a unique temporary directory for the test to avoid conflicts.
const testDir = path.join(__dirname, 'temp-test-dir-' + Date.now());

describe('processDirectory (e2e)', () => {
  // Set up a mock file system for the tests.
  beforeAll(async () => {
    // Create the test directory and a subdirectory.
    await fs.mkdir(path.join(testDir, 'subdir'), { recursive: true });

    // Create the mock files.
    // fileA.ts: should be updated to import 'fileB.ts'
    await fs.writeFile(
      path.join(testDir, 'fileA.ts'),
      `import { B } from './fileB';\nconst a = 1;`,
      'utf-8'
    );
    // fileB.ts: the file that is imported by fileA.ts
    await fs.writeFile(
      path.join(testDir, 'fileB.ts'),
      `export const B = 'B';`,
      'utf-8'
    );
    // fileC.ts: a file in a subdirectory, should be updated to import '../fileA.ts'
    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileC.ts'),
      `import { A } from '../fileA';\nconst c = 3;`,
      'utf-8'
    );
    // fileD.ts: a file with an import that should NOT be modified because the file doesn't exist
    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileD.ts'),
      `import { nonExistent } from './nonExistent';\nconst d = 4;`,
      'utf-8'
    );
    // fileE.ts: a file with a relative import that already has the .ts extension
    await fs.writeFile(
      path.join(testDir, 'subdir', 'fileE.ts'),
      `import { A } from '../fileA.ts';\nconst e = 5;`,
      'utf-8'
    );
  });

  // Clean up the mock file system after all tests are complete.
  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('updates relative imports in TypeScript files by adding the ".ts" extension', async () => {
    // Run the function on the mock directory.
    await processDirectory(testDir);

    // Read the contents of the files to verify changes.
    const fileAContent = await fs.readFile(path.join(testDir, 'fileA.ts'), 'utf-8');
    const fileCContent = await fs.readFile(path.join(testDir, 'subdir', 'fileC.ts'), 'utf-8');
    const fileDContent = await fs.readFile(path.join(testDir, 'subdir', 'fileD.ts'), 'utf-8');
    const fileEContent = await fs.readFile(path.join(testDir, 'subdir', 'fileE.ts'), 'utf-8');


    // Assertions
    expect(fileAContent).toContain("from './fileB.ts'");
    expect(fileCContent).toContain("from '../fileA.ts'");
    
    // Ensure that files that should not be modified are unchanged.
    expect(fileDContent).not.toContain("from './nonExistent.ts'");
    expect(fileEContent).toContain("from '../fileA.ts'");
  });
});
