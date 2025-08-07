import { migrateTypeImports, migrateTypeImportsFromFile } from "./type-only-import-migrator";


// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node migrator.js <error-file-path>');
    console.log('  Or pipe TSC output: tsc --noEmit | node migrator.js');
    process.exit(1);
  }
  
  if (args[0]) {
    // File input
    migrateTypeImportsFromFile(args[0]);
  } else {
    // Stdin input
    let stdinData = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      stdinData += chunk;
    });
    
    process.stdin.on('end', () => {
      migrateTypeImports(stdinData);
    });
  }
}