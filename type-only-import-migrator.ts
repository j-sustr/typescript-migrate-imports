import * as fs from 'fs';
import * as path from 'path';

interface ImportError {
  filePath: string;
  line: number;
  column: number;
  typeName: string;
  errorMessage: string;
}

interface ImportStatement {
  line: number;
  fullStatement: string;
  module: string;
  imports: {
    name: string;
    isType: boolean;
  }[];
}

export class TypeOnlyImportMigrator {
  private errors: ImportError[] = [];
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = path.resolve(basePath);
  }

  /**
   * Parse TSC output to extract TS1484 errors
   */
  parseTscOutput(tscOutput: string): ImportError[] {
    const lines = tscOutput.split('\n');
    const errors: ImportError[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match the error pattern: filepath:line:column - error TS1484: 'TypeName' is a type...
      const errorMatch = line.match(/^(.+):(\d+):(\d+)\s+-\s+error\s+TS1484:\s+'([^']+)'\s+is\s+a\s+type/);
      
      if (errorMatch) {
        const [, filePath, lineNum, columnNum, typeName] = errorMatch;
        const resolvedPath = this.resolveFilePath(filePath.trim());
        
        errors.push({
          filePath: resolvedPath,
          line: parseInt(lineNum),
          column: parseInt(columnNum),
          typeName: typeName.trim(),
          errorMessage: line
        });
      }
    }
    
    this.errors = errors;
    return errors;
  }

  /**
   * Resolve file path relative to base path
   */
  private resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    
    // If the path is relative, resolve it against the base path
    return path.resolve(this.basePath, filePath);
  }

  /**
   * Get unique file paths that have TS1484 errors
   */
  getFilesWithErrors(): string[] {
    const uniqueFiles = new Set(this.errors.map(error => error.filePath));
    return Array.from(uniqueFiles);
  }

  /**
   * Parse import statements from a file
   */
  parseImportStatements(fileContent: string): ImportStatement[] {
    const lines = fileContent.split('\n');
    const importStatements: ImportStatement[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match import statements (both single line and multiline)
      if (line.startsWith('import ') && !line.startsWith('import type ')) {
        let fullStatement = line;
        let currentLine = i;
        
        // Handle multiline imports
        while (!fullStatement.includes(';') && !fullStatement.includes(' from ')) {
          currentLine++;
          if (currentLine >= lines.length) break;
          fullStatement += ' ' + lines[currentLine].trim();
        }
        
        // Extract module path
        const moduleMatch = fullStatement.match(/from\s+['"]([^'"]+)['"]/);
        if (!moduleMatch) continue;
        
        const module = moduleMatch[1];
        
        // Extract imported items
        const importsMatch = fullStatement.match(/import\s*\{([^}]+)\}/);
        if (!importsMatch) continue;
        
        const importsString = importsMatch[1];
        const imports = importsString
          .split(',')
          .map(imp => imp.trim())
          .filter(imp => imp.length > 0)
          .map(imp => ({
            name: imp,
            isType: false // Will be determined later
          }));
        
        importStatements.push({
          line: i + 1, // 1-based line numbers
          fullStatement,
          module,
          imports
        });
      }
    }
    
    return importStatements;
  }

  /**
   * Update import statement to use type-only imports
   */
  updateImportStatement(
    importStatement: ImportStatement, 
    typeOnlyImports: string[]
  ): string {
    const regularImports = importStatement.imports
      .filter(imp => !typeOnlyImports.includes(imp.name))
      .map(imp => imp.name);
    
    const typeImports = importStatement.imports
      .filter(imp => typeOnlyImports.includes(imp.name))
      .map(imp => imp.name);
    
    const statements: string[] = [];
    
    // Create regular import statement if there are non-type imports
    if (regularImports.length > 0) {
      statements.push(`import { ${regularImports.join(', ')} } from "${importStatement.module}";`);
    }
    
    // Create type-only import statement if there are type imports
    if (typeImports.length > 0) {
      statements.push(`import type { ${typeImports.join(', ')} } from "${importStatement.module}";`);
    }
    
    return statements.join('\n');
  }

  /**
   * Fix imports in a single file
   */
  async fixImportsInFile(filePath: string): Promise<void> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  File not found: ${filePath}`);
        return;
      }

      // Read file content
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');
      
      // Get errors for this file
      const fileErrors = this.errors.filter(error => error.filePath === filePath);
      if (fileErrors.length === 0) return;
      
      // Parse import statements
      const importStatements = this.parseImportStatements(fileContent);
      
      // Group errors by line number to handle multiple types in same import
      const errorsByLine = new Map<number, string[]>();
      fileErrors.forEach(error => {
        if (!errorsByLine.has(error.line)) {
          errorsByLine.set(error.line, []);
        }
        errorsByLine.get(error.line)!.push(error.typeName);
      });
      
      // Process each import statement that has errors
      let updatedLines = [...lines];
      let lineOffset = 0;
      
      for (const importStatement of importStatements) {
        const typeOnlyImports = errorsByLine.get(importStatement.line) || [];
        
        if (typeOnlyImports.length > 0) {
          // Find the actual line(s) of this import statement
          let startLine = importStatement.line - 1; // Convert to 0-based
          let endLine = startLine;
          
          // Find the end of the import statement (multiline support)
          while (endLine < lines.length - 1 && !lines[endLine].includes(';')) {
            endLine++;
          }
          
          // Generate new import statement(s)
          const newImportStatements = this.updateImportStatement(importStatement, typeOnlyImports);
          
          // Replace the old import with new import(s)
          const newLines = newImportStatements.split('\n');
          
          // Calculate adjustment for line offset
          const originalLineCount = endLine - startLine + 1;
          const newLineCount = newLines.length;
          
          // Replace lines in updatedLines
          updatedLines.splice(startLine + lineOffset, originalLineCount, ...newLines);
          
          // Update offset for subsequent replacements
          lineOffset += newLineCount - originalLineCount;
        }
      }
      
      // Write updated content back to file
      const updatedContent = updatedLines.join('\n');
      await fs.promises.writeFile(filePath, updatedContent, 'utf-8');
      
      console.log(`✅ Fixed imports in: ${path.relative(this.basePath, filePath)}`);
      
    } catch (error) {
      console.error(`❌ Error processing file ${filePath}:`, error);
    }
  }

  /**
   * Main method to migrate all imports based on TSC output
   */
  async migrateImports(tscOutput: string): Promise<void> {
    console.log(`🔍 Parsing TSC output for TS1484 errors... (Base path: ${this.basePath})`);
    
    // Parse errors
    const errors = this.parseTscOutput(tscOutput);
    console.log(`Found ${errors.length} TS1484 errors`);
    
    if (errors.length === 0) {
      console.log('No TS1484 errors found. Nothing to migrate.');
      return;
    }
    
    // Get unique files
    const filesToFix = this.getFilesWithErrors();
    console.log(`Files to fix: ${filesToFix.length}`);
    
    // Show which files will be processed
    filesToFix.forEach(file => {
      console.log(`  - ${path.relative(this.basePath, file)}`);
    });
    
    // Fix each file
    for (const filePath of filesToFix) {
      console.log(`🔧 Processing: ${path.relative(this.basePath, filePath)}`);
      await this.fixImportsInFile(filePath);
    }
    
    console.log('✨ Migration completed!');
  }
}