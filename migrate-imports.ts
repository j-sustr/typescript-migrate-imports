import fs from 'fs/promises';
import path from 'path';

/**
 * Recursively processes a directory to find and update TypeScript files.
 * @param directoryPath The path to the directory to process.
 */
export async function processDirectory(directoryPath: string) {
  try {
    const items = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(directoryPath, item.name);

      if (item.isDirectory()) {
        await processDirectory(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        await processFile(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error processing directory ${directoryPath}:`, err);
  }
}

/**
 * Processes a single TypeScript file, updating its relative imports.
 * @param filePath The path to the file to process.
 */
async function processFile(filePath: string) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    let fileContentModified = false;
    let newContent = '';

    // Regex to find import/export statements with a relative path.
    const importRegex = /(import|export)(?:[\s\S]*?)from\s+['"](?<path>\..+?)['"];?/g;
    
    let match;
    let lastIndex = 0;
    
    while ((match = importRegex.exec(fileContent)) !== null) {
      const importPath = match.groups?.path;
      
      // Only modify paths that don't already have an extension.
      if (importPath && !importPath.endsWith('.ts') && !importPath.endsWith('.js')) {
        const resolvedPath = path.resolve(path.dirname(filePath), importPath);
        
        try {
          // Check if the file exists with a '.ts' extension.
          await fs.access(resolvedPath + '.ts');
          
          const newImportPath = importPath + '.ts';
          
          newContent += fileContent.substring(lastIndex, match.index);
          newContent += match[0].replace(importPath, newImportPath);
          
          lastIndex = match.index + match[0].length;
          fileContentModified = true;
          console.log(`Updated import in: ${filePath}`);
          console.log(`  - Old: "${importPath}"`);
          console.log(`  - New: "${newImportPath}"`);
        } catch (error) {
          // File with '.ts' extension does not exist, so we do nothing.
        }
      }
    }
    
    if (fileContentModified) {
      newContent += fileContent.substring(lastIndex);
      await fs.writeFile(filePath, newContent, 'utf-8');
    }
  } catch (err) {
    console.error(`Error processing file ${filePath}:`, err);
  }
}