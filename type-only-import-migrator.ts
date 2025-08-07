import * as fs from 'fs';
import * as path from 'path';

interface ImportError {
  file: string;
  line: number;
  column: number;
  typeIdentifier: string;
  module: string;
}

interface ImportStatement {
  line: number;
  fullImport: string;
  module: string;
  imports: string[];
  hasTypeOnly: boolean;
}

class TypeOnlyImportMigrator {
  /**
   * Parse TSC error output and extract import error information
   */
  private parseErrorOutput(errorOutput: string): ImportError[] {
    const errors: ImportError[] = [];
    const lines = errorOutput.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match the error format: file:line:column - error TS1484: 'Type' is a type...
      const errorMatch = line.match(/^(.+?):(\d+):(\d+)\s+-\s+error\s+TS1484:\s+'([^']+)'\s+is a type/);
      if (errorMatch) {
        const [, filePath, lineNum, colNum, typeIdentifier] = errorMatch;
        
        // Look ahead to find the import line
        for (let j = i + 1; j < lines.length && j < i + 3; j++) {
          const importLine = lines[j];
          const importMatch = importLine.match(/^\d+\s+import\s+.*from\s+"([^"]+)"/);
          if (importMatch) {
            const [, moduleName] = importMatch;
            errors.push({
              file: filePath,
              line: parseInt(lineNum),
              column: parseInt(colNum),
              typeIdentifier,
              module: moduleName
            });
            break;
          }
        }
      }
    }
    
    return errors;
  }

  /**
   * Group errors by file and line number
   */
  private groupErrorsByFileLine(errors: ImportError[]): Map<string, Map<number, ImportError[]>> {
    const grouped = new Map<string, Map<number, ImportError[]>>();
    
    errors.forEach(error => {
      if (!grouped.has(error.file)) {
        grouped.set(error.file, new Map());
      }
      
      const fileErrors = grouped.get(error.file)!;
      if (!fileErrors.has(error.line)) {
        fileErrors.set(error.line, []);
      }
      
      fileErrors.get(error.line)!.push(error);
    });
    
    return grouped;
  }

  /**
   * Parse import statement and extract information
   */
  private parseImportStatement(importLine: string): ImportStatement | null {
    // Match various import patterns
    const patterns = [
      // import { A, B, C } from "module"
      /^(\s*)import\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']/,
      // import type { A, B } from "module"
      /^(\s*)import\s+type\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']/,
      // import A, { B, C } from "module"
      /^(\s*)import\s+([^,{]+),?\s*\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']/,
    ];

    for (const pattern of patterns) {
      const match = importLine.match(pattern);
      if (match) {
        const hasTypeOnly = importLine.includes('import type');
        let imports: string[] = [];
        let module: string;
        
        if (match.length === 4) {
          // Simple destructured import
          imports = match[2].split(',').map(imp => imp.trim());
          module = match[3];
        } else if (match.length === 5) {
          // Default + destructured import
          const defaultImport = match[2].trim();
          const destructuredImports = match[3].split(',').map(imp => imp.trim());
          imports = [defaultImport, ...destructuredImports];
          module = match[4];
        } else {
          continue;
        }
        
        return {
          line: 0, // Will be set by caller
          fullImport: importLine,
          module,
          imports,
          hasTypeOnly
        };
      }
    }
    
    return null;
  }

  /**
   * Generate new import statement with type-only imports
   */
  private generateNewImportStatement(
    importStatement: ImportStatement,
    typeIdentifiers: Set<string>,
    indent: string = ''
  ): string {
    const { module, imports, hasTypeOnly } = importStatement;
    
    if (hasTypeOnly) {
      // Already a type-only import, no changes needed
      return importStatement.fullImport;
    }
    
    const valueImports: string[] = [];
    const typeImports: string[] = [];
    
    imports.forEach(imp => {
      const cleanImport = imp.replace(/^type\s+/, '').trim();
      if (typeIdentifiers.has(cleanImport)) {
        typeImports.push(cleanImport);
      } else {
        valueImports.push(imp);
      }
    });
    
    const statements: string[] = [];
    
    // Add value imports if any
    if (valueImports.length > 0) {
      statements.push(`${indent}import { ${valueImports.join(', ')} } from "${module}";`);
    }
    
    // Add type imports if any
    if (typeImports.length > 0) {
      statements.push(`${indent}import type { ${typeImports.join(', ')} } from "${module}";`);
    }
    
    return statements.join('\n');
  }

  /**
   * Process a single file and fix import statements
   */
  private processFile(filePath: string, fileErrors: Map<number, ImportError[]>): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const modifiedLines = [...lines];
    
    // Process each line with errors (in reverse order to maintain line numbers)
    const sortedLineNumbers = Array.from(fileErrors.keys()).sort((a, b) => b - a);
    
    for (const lineNumber of sortedLineNumbers) {
      const lineIndex = lineNumber - 1; // Convert to 0-based index
      const lineErrors = fileErrors.get(lineNumber)!;
      const originalLine = lines[lineIndex];
      
      const importStatement = this.parseImportStatement(originalLine);
      if (!importStatement) {
        console.warn(`Could not parse import statement at ${filePath}:${lineNumber}`);
        continue;
      }
      
      // Get indent from original line
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      
      // Collect all type identifiers for this line
      const typeIdentifiers = new Set(lineErrors.map(error => error.typeIdentifier));
      
      // Generate new import statement
      const newImportStatement = this.generateNewImportStatement(
        importStatement,
        typeIdentifiers,
        indent
      );
      
      // Replace the line
      modifiedLines[lineIndex] = newImportStatement;
    }
    
    // Write the modified content back to file
    const newContent = modifiedLines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    console.log(`✅ Fixed ${fileErrors.size} import statements in ${filePath}`);
  }

  /**
   * Main migration method
   */
  public migrateFromErrorOutput(errorOutput: string): void {
    console.log('🔄 Parsing TypeScript error output...');
    
    const errors = this.parseErrorOutput(errorOutput);
    console.log(`📋 Found ${errors.length} type import errors`);
    
    if (errors.length === 0) {
      console.log('✅ No type import errors found to fix');
      return;
    }
    
    const groupedErrors = this.groupErrorsByFileLine(errors);
    console.log(`📁 Processing ${groupedErrors.size} files...`);
    
    // Process each file
    groupedErrors.forEach((fileErrors, filePath) => {
      this.processFile(filePath, fileErrors);
    });
    
    console.log('🎉 Migration completed!');
  }

  /**
   * Migrate from error output file
   */
  public migrateFromErrorFile(errorFilePath: string): void {
    if (!fs.existsSync(errorFilePath)) {
      throw new Error(`Error file not found: ${errorFilePath}`);
    }
    
    const errorOutput = fs.readFileSync(errorFilePath, 'utf-8');
    this.migrateFromErrorOutput(errorOutput);
  }
}

// Usage examples
export function migrateTypeImports(errorOutput: string): void {
  const migrator = new TypeOnlyImportMigrator();
  migrator.migrateFromErrorOutput(errorOutput);
}

export function migrateTypeImportsFromFile(errorFilePath: string): void {
  const migrator = new TypeOnlyImportMigrator();
  migrator.migrateFromErrorFile(errorFilePath);
}

// Example usage:
/*
const errorOutput = `
src/web/routes/api/v1/pms/endpoint.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static, Type } from "@sinclair/typebox";
           ~~~~~~

src/web/routes/api/v1/pms/endpoint.ts:2:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
           ~~~~~~~~~~~~~~~
`;

migrateTypeImports(errorOutput);
*/