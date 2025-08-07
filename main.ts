// migrate-imports.ts
// This script automatically adds '.ts' extensions to all relative imports
// in a specified directory of TypeScript files, addressing the TS2835 error.

import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';

/**
 * The main function to orchestrate the import migration process.
 */
async function main() {
  const [srcDir] = process.argv.slice(2);

  if (!srcDir) {
    console.error('Please provide a source directory as an argument.');
    console.error('Usage: ts-node migrate-imports.ts <path/to/your/src>');
    process.exit(1);
  }

  try {
    const stats = await fs.stat(srcDir);
    if (!stats.isDirectory()) {
      console.error(`Error: The path "${srcDir}" is not a valid directory.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: The path "${srcDir}" does not exist.`);
    process.exit(1);
  }

  console.log(`Starting migration for all .ts files in: ${srcDir}`);
  await processDirectory(srcDir);
  console.log('\nMigration complete. All relative imports have been updated.');
}

main()