import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { migrateTypeImports, migrateTypeImportsFromFile, TypeOnlyImportMigrator } from './type-only-import-migrator';

// Mock fs module
vi.mock('fs');
const mockFs = vi.mocked(fs);

// Create a test class that exposes private methods for testing
class TestableTypeOnlyImportMigrator {
  private migrator: any;

  constructor() {
    this.migrator = new TypeOnlyImportMigrator();
  }

  // Expose private methods for testing
  parseErrorOutput(errorOutput: string) {
    return this.migrator.parseErrorOutput(errorOutput);
  }

  groupErrorsByFileLine(errors: any[]) {
    return this.migrator.groupErrorsByFileLine(errors);
  }

  parseImportStatement(importLine: string) {
    return this.migrator.parseImportStatement(importLine);
  }

  generateNewImportStatement(importStatement: any, typeIdentifiers: Set<string>, indent?: string) {
    return this.migrator.generateNewImportStatement(importStatement, typeIdentifiers, indent);
  }

  processFile(filePath: string, fileErrors: Map<number, any[]>) {
    return this.migrator.processFile(filePath, fileErrors);
  }

  migrateFromErrorOutput(errorOutput: string) {
    return this.migrator.migrateFromErrorOutput(errorOutput);
  }
}

describe('TypeOnlyImportMigrator', () => {
  let migrator: TestableTypeOnlyImportMigrator;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    migrator = new TestableTypeOnlyImportMigrator();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseErrorOutput', () => {
    it('should parse single error correctly', () => {
      const errorOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static, Type } from "@sinclair/typebox";
           ~~~~~~
`;

      const errors = migrator.parseErrorOutput(errorOutput);
      
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        file: 'src/test.ts',
        line: 1,
        column: 10,
        typeIdentifier: 'Static',
        module: '@sinclair/typebox'
      });
    });

    it('should parse multiple errors correctly', () => {
      const errorOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static, Type } from "@sinclair/typebox";
           ~~~~~~

src/test.ts:2:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyReply } from "fastify";
           ~~~~~~~~~~~~~~~
`;

      const errors = migrator.parseErrorOutput(errorOutput);
      
      expect(errors).toHaveLength(2);
      expect(errors[0].typeIdentifier).toBe('Static');
      expect(errors[0].module).toBe('@sinclair/typebox');
      expect(errors[1].typeIdentifier).toBe('FastifyInstance');
      expect(errors[1].module).toBe('fastify');
    });

    it('should handle empty error output', () => {
      const errors = migrator.parseErrorOutput('');
      expect(errors).toHaveLength(0);
    });

    it('should handle malformed error output', () => {
      const errorOutput = 'Some random text that does not match the pattern';
      const errors = migrator.parseErrorOutput(errorOutput);
      expect(errors).toHaveLength(0);
    });
  });

  describe('groupErrorsByFileLine', () => {
    it('should group errors by file and line number', () => {
      const errors = [
        { file: 'src/test1.ts', line: 1, column: 10, typeIdentifier: 'Static', module: 'module1' },
        { file: 'src/test1.ts', line: 1, column: 20, typeIdentifier: 'Type', module: 'module1' },
        { file: 'src/test1.ts', line: 2, column: 10, typeIdentifier: 'Other', module: 'module2' },
        { file: 'src/test2.ts', line: 1, column: 10, typeIdentifier: 'Another', module: 'module3' }
      ];

      const grouped = migrator.groupErrorsByFileLine(errors);

      expect(grouped.size).toBe(2);
      expect(grouped.get('src/test1.ts')?.size).toBe(2);
      expect(grouped.get('src/test1.ts')?.get(1)).toHaveLength(2);
      expect(grouped.get('src/test1.ts')?.get(2)).toHaveLength(1);
      expect(grouped.get('src/test2.ts')?.size).toBe(1);
    });
  });

  describe('parseImportStatement', () => {
    it('should parse simple destructured import', () => {
      const importLine = 'import { Static, Type } from "@sinclair/typebox";';
      const result = migrator.parseImportStatement(importLine);

      expect(result).toEqual({
        line: 0,
        fullImport: importLine,
        module: '@sinclair/typebox',
        imports: ['Static', 'Type'],
        hasTypeOnly: false
      });
    });

    it('should parse type-only import', () => {
      const importLine = 'import type { Static, Type } from "@sinclair/typebox";';
      const result = migrator.parseImportStatement(importLine);

      expect(result).toEqual({
        line: 0,
        fullImport: importLine,
        module: '@sinclair/typebox',
        imports: ['Static', 'Type'],
        hasTypeOnly: true
      });
    });

    it('should parse import with spaces and indentation', () => {
      const importLine = '  import {  Static ,  Type  } from "@sinclair/typebox";';
      const result = migrator.parseImportStatement(importLine);

      expect(result?.imports).toEqual(['Static', 'Type']);
      expect(result?.module).toBe('@sinclair/typebox');
    });

    it('should handle single quotes', () => {
      const importLine = "import { Static, Type } from '@sinclair/typebox';";
      const result = migrator.parseImportStatement(importLine);

      expect(result?.module).toBe('@sinclair/typebox');
    });

    it('should return null for invalid import statements', () => {
      const invalidImports = [
        'const x = require("module");',
        'import * as module from "module";',
        'export { something } from "module";',
        'not an import statement at all'
      ];

      invalidImports.forEach(importLine => {
        const result = migrator.parseImportStatement(importLine);
        expect(result).toBeNull();
      });
    });
  });

  describe('generateNewImportStatement', () => {
    it('should split value and type imports correctly', () => {
      const importStatement = {
        line: 1,
        fullImport: 'import { Static, Type, value } from "@sinclair/typebox";',
        module: '@sinclair/typebox',
        imports: ['Static', 'Type', 'value'],
        hasTypeOnly: false
      };

      const typeIdentifiers = new Set(['Static', 'Type']);
      const result = migrator.generateNewImportStatement(importStatement, typeIdentifiers);

      expect(result).toContain('import { value } from "@sinclair/typebox";');
      expect(result).toContain('import type { Static, Type } from "@sinclair/typebox";');
    });

    it('should handle only type imports', () => {
      const importStatement = {
        line: 1,
        fullImport: 'import { Static, Type } from "@sinclair/typebox";',
        module: '@sinclair/typebox',
        imports: ['Static', 'Type'],
        hasTypeOnly: false
      };

      const typeIdentifiers = new Set(['Static', 'Type']);
      const result = migrator.generateNewImportStatement(importStatement, typeIdentifiers);

      expect(result).toBe('import type { Static, Type } from "@sinclair/typebox";');
      expect(result).not.toContain('import {  } from');
    });

    it('should handle only value imports', () => {
      const importStatement = {
        line: 1,
        fullImport: 'import { value1, value2 } from "module";',
        module: 'module',
        imports: ['value1', 'value2'],
        hasTypeOnly: false
      };

      const typeIdentifiers = new Set<string>();
      const result = migrator.generateNewImportStatement(importStatement, typeIdentifiers);

      expect(result).toBe('import { value1, value2 } from "module";');
    });

    it('should preserve existing type-only imports', () => {
      const importStatement = {
        line: 1,
        fullImport: 'import type { Static, Type } from "@sinclair/typebox";',
        module: '@sinclair/typebox',
        imports: ['Static', 'Type'],
        hasTypeOnly: true
      };

      const typeIdentifiers = new Set(['Static', 'Type']);
      const result = migrator.generateNewImportStatement(importStatement, typeIdentifiers);

      expect(result).toBe('import type { Static, Type } from "@sinclair/typebox";');
    });

    it('should handle indentation', () => {
      const importStatement = {
        line: 1,
        fullImport: '  import { Static, value } from "module";',
        module: 'module',
        imports: ['Static', 'value'],
        hasTypeOnly: false
      };

      const typeIdentifiers = new Set(['Static']);
      const result = migrator.generateNewImportStatement(importStatement, typeIdentifiers, '  ');

      expect(result).toContain('  import { value } from "module";');
      expect(result).toContain('  import type { Static } from "module";');
    });
  });

  describe('processFile', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('should process file and fix imports', () => {
      const fileContent = `import { Static, Type, value } from "@sinclair/typebox";
import { FastifyInstance, handler } from "fastify";
const x = 1;`;

      mockFs.readFileSync.mockReturnValue(fileContent);
      
      const fileErrors = new Map([
        [1, [{ file: 'test.ts', line: 1, column: 10, typeIdentifier: 'Static', module: '@sinclair/typebox' }]],
        [2, [{ file: 'test.ts', line: 2, column: 10, typeIdentifier: 'FastifyInstance', module: 'fastify' }]]
      ]);

      migrator.processFile('test.ts', fileErrors);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        'test.ts',
        expect.stringContaining('import { Type, value } from "@sinclair/typebox";'),
        'utf-8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        'test.ts',
        expect.stringContaining('import type { Static } from "@sinclair/typebox";'),
        'utf-8'
      );
    });

    it('should handle non-existent files gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const fileErrors = new Map();
      migrator.processFile('nonexistent.ts', fileErrors);

      expect(consoleWarnSpy).toHaveBeenCalledWith('File not found: nonexistent.ts');
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('migrateFromErrorOutput', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('import { Static } from "module";');
    });

    it('should complete full migration process', () => {
      const errorOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static } from "module";
           ~~~~~~
`;

      migrator.migrateFromErrorOutput(errorOutput);

      expect(consoleLogSpy).toHaveBeenCalledWith('🔄 Parsing TypeScript error output...');
      expect(consoleLogSpy).toHaveBeenCalledWith('📋 Found 1 type import errors');
      expect(consoleLogSpy).toHaveBeenCalledWith('📁 Processing 1 files...');
      expect(consoleLogSpy).toHaveBeenCalledWith('🎉 Migration completed!');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle empty error output', () => {
      migrator.migrateFromErrorOutput('');

      expect(consoleLogSpy).toHaveBeenCalledWith('✅ No type import errors found to fix');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('public API functions', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('import { Static } from "module";');
    });

    it('should call migrateTypeImports correctly', () => {
      const errorOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static } from "module";
           ~~~~~~
`;

      migrateTypeImports(errorOutput);

      expect(consoleLogSpy).toHaveBeenCalledWith('🔄 Parsing TypeScript error output...');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should call migrateTypeImportsFromFile correctly', () => {
      const errorOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static } from "module";
           ~~~~~~
`;

      // Mock reading the error file
      mockFs.readFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'errors.txt') {
          return errorOutput;
        }
        return 'import { Static } from "module";';
      });

      migrateTypeImportsFromFile('errors.txt');

      expect(mockFs.readFileSync).toHaveBeenCalledWith('errors.txt', 'utf-8');
      expect(consoleLogSpy).toHaveBeenCalledWith('🔄 Parsing TypeScript error output...');
    });

    it('should handle non-existent error file', () => {
      mockFs.existsSync.mockImplementation((filePath: string) => {
        return filePath !== 'nonexistent.txt';
      });

      expect(() => {
        migrateTypeImportsFromFile('nonexistent.txt');
      }).toThrow('Error file not found: nonexistent.txt');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle complex import patterns', () => {
      const complexImports = [
        'import { A as AliasA, B } from "module";',
        'import   {   A,   B   }   from   "module"  ;',
        'import {\n  A,\n  B\n} from "module";',
      ];

      complexImports.forEach(importLine => {
        const result = migrator.parseImportStatement(importLine);
        expect(result).toBeTruthy();
        expect(result?.imports).toContain('A');
        expect(result?.imports).toContain('B');
      });
    });

    it('should handle files with mixed line endings', () => {
      const fileContent = 'import { Static } from "module";\r\nimport { Other } from "other";';
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(fileContent);

      const fileErrors = new Map([
        [1, [{ file: 'test.ts', line: 1, column: 10, typeIdentifier: 'Static', module: 'module' }]]
      ]);

      expect(() => {
        migrator.processFile('test.ts', fileErrors);
      }).not.toThrow();
    });

    it('should preserve file structure when no changes are needed', () => {
      const fileContent = 'import type { Static } from "module";\nconst x = 1;';
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(fileContent);

      const fileErrors = new Map([
        [1, [{ file: 'test.ts', line: 1, column: 10, typeIdentifier: 'Static', module: 'module' }]]
      ]);

      migrator.processFile('test.ts', fileErrors);

      // Should still write the file even if no changes were made to the import structure
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });
});