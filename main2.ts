import path from "path";
import { TypeOnlyImportMigrator } from "./type-only-import-migrator.ts";
import * as fs from "fs";

// Usage example
async function main() {
  // Get base path from command line arguments or use current directory
  const basePath = process.argv[2] || process.cwd();
  
  const tscOutput = fs.readFileSync(path.join('./tsc-errors.txt'), 'utf-8');


  const migrator = new TypeOnlyImportMigrator(basePath);
  await migrator.migrateImports(tscOutput);
}

main().catch((error) => {
  console.error("Error during migration:", error);
  process.exit(1);
});