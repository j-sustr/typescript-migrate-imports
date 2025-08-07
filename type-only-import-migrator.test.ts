import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TypeOnlyImportMigrator } from './type-only-import-migrator';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  }
}));

const mockFs = vi.mocked(fs);

describe('TypeOnlyImportMigrator', () => {
  let migrator: TypeOnlyImportMigrator;
  const testBasePath = '/test/project';

  beforeEach(() => {
    migrator = new TypeOnlyImportMigrator(testBasePath);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('parseTscOutput', () => {
    it('should parse single TS1484 error correctly', () => {
      const tscOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static, Type } from "@sinclair/typebox";
           ~~~~~~
      `;

      const errors = migrator.parseTscOutput(tscOutput);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        filePath: path.resolve(testBasePath, 'src/test.ts'),
        line: 1,
        column: 10,
        typeName: 'Static',
        errorMessage: `src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`
      });
    });

    it('should parse multiple TS1484 errors from same file', () => {
      const tscOutput = `
src/test.ts:2:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions } from "fastify";
           ~~~~~~~~~~~~~~~

src/test.ts:2:27 - error TS1484: 'FastifyPluginOptions' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions } from "fastify";
                            ~~~~~~~~~~~~~~~~~~~~
      `;

      const errors = migrator.parseTscOutput(tscOutput);

      expect(errors).toHaveLength(2);
      expect(errors[0].typeName).toBe('FastifyInstance');
      expect(errors[1].typeName).toBe('FastifyPluginOptions');
      expect(errors[0].line).toBe(2);
      expect(errors[1].line).toBe(2);
    });

    it('should handle absolute file paths', () => {
      const tscOutput = `
/absolute/path/src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      const errors = migrator.parseTscOutput(tscOutput);

      expect(errors).toHaveLength(1);
      expect(errors[0].filePath).toBe('/absolute/path/src/test.ts');
    });

    it('should ignore non-TS1484 errors', () => {
      const tscOutput = `
src/test.ts:1:10 - error TS2304: Cannot find name 'unknown'.
src/test.ts:2:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test.ts:3:10 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
      `;

      const errors = migrator.parseTscOutput(tscOutput);

      expect(errors).toHaveLength(1);
      expect(errors[0].typeName).toBe('Static');
    });

    it('should return empty array for empty input', () => {
      const errors = migrator.parseTscOutput('');
      expect(errors).toHaveLength(0);
    });
  });

  describe('getFilesWithErrors', () => {
    it('should return unique file paths', () => {
      const tscOutput = `
src/test1.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test1.ts:2:10 - error TS1484: 'Type' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test2.ts:1:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      migrator.parseTscOutput(tscOutput);
      const files = migrator.getFilesWithErrors();

      expect(files).toHaveLength(2);
      expect(files).toContain(path.resolve(testBasePath, 'src/test1.ts'));
      expect(files).toContain(path.resolve(testBasePath, 'src/test2.ts'));
    });
  });

  describe('parseImportStatements', () => {
    it('should parse single-line import statements', () => {
      const fileContent = `
import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
const something = 'not an import';
      `;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(2);
      expect(imports[0]).toEqual({
        line: 2,
        fullStatement: `import { Static, Type } from "@sinclair/typebox";`,
        module: "@sinclair/typebox",
        imports: [
          { name: 'Static', isType: false },
          { name: 'Type', isType: false }
        ]
      });
      expect(imports[1]).toEqual({
        line: 3,
        fullStatement: `import { FastifyInstance } from "fastify";`,
        module: "fastify",
        imports: [
          { name: 'FastifyInstance', isType: false }
        ]
      });
    });

    it('should parse multiline import statements', () => {
      const fileContent = `
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply
} from "fastify";
      `;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(1);
      expect(imports[0].line).toBe(2);
      expect(imports[0].module).toBe("fastify");
      expect(imports[0].imports).toHaveLength(3);
      expect(imports[0].imports.map(i => i.name)).toEqual([
        'FastifyInstance',
        'FastifyPluginOptions',
        'FastifyReply'
      ]);
    });

    it('should ignore type-only imports', () => {
      const fileContent = `
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
      `;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(1);
      expect(imports[0].imports[0].name).toBe('Type');
    });

    it('should handle imports with whitespace', () => {
      const fileContent = `
import { 
  Static , 
  Type,
  Schema 
} from "@sinclair/typebox";
      `;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(1);
      expect(imports[0].imports.map(i => i.name)).toEqual(['Static', 'Type', 'Schema']);
    });
  });

  describe('updateImportStatement', () => {
    it('should split imports into regular and type-only imports', () => {
      const importStatement = {
        line: 1,
        fullStatement: `import { Static, Type, validate } from "@sinclair/typebox";`,
        module: "@sinclair/typebox",
        imports: [
          { name: 'Static', isType: false },
          { name: 'Type', isType: false },
          { name: 'validate', isType: false }
        ]
      };

      const result = migrator.updateImportStatement(importStatement, ['Static', 'Type']);

      expect(result).toBe(
        `import { validate } from "@sinclair/typebox";\nimport type { Static, Type } from "@sinclair/typebox";`
      );
    });

    it('should create only type import when all imports are types', () => {
      const importStatement = {
        line: 1,
        fullStatement: `import { Static, Type } from "@sinclair/typebox";`,
        module: "@sinclair/typebox",
        imports: [
          { name: 'Static', isType: false },
          { name: 'Type', isType: false }
        ]
      };

      const result = migrator.updateImportStatement(importStatement, ['Static', 'Type']);

      expect(result).toBe(`import type { Static, Type } from "@sinclair/typebox";`);
    });

    it('should create only regular import when no imports are types', () => {
      const importStatement = {
        line: 1,
        fullStatement: `import { validate, parse } from "@sinclair/typebox";`,
        module: "@sinclair/typebox",
        imports: [
          { name: 'validate', isType: false },
          { name: 'parse', isType: false }
        ]
      };

      const result = migrator.updateImportStatement(importStatement, []);

      expect(result).toBe(`import { validate, parse } from "@sinclair/typebox";`);
    });
  });

  describe('fixImportsInFile', () => {
    const testFilePath = path.resolve(testBasePath, 'src/test.ts');

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('should fix imports in a file with TS1484 errors', async () => {
      const fileContent = `import { Static, Type, validate } from "@sinclair/typebox";
import { FastifyInstance, fastify } from "fastify";

const app = fastify();
`;

      const tscOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test.ts:1:18 - error TS1484: 'Type' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test.ts:2:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      migrator.parseTscOutput(tscOutput);
      mockFs.promises.readFile.mockResolvedValue(fileContent);

      await migrator.fixImportsInFile(testFilePath);

      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        expect.stringContaining('import { validate } from "@sinclair/typebox";'),
        'utf-8'
      );
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        expect.stringContaining('import type { Static, Type } from "@sinclair/typebox";'),
        'utf-8'
      );
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        expect.stringContaining('import { fastify } from "fastify";'),
        'utf-8'
      );
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        testFilePath,
        expect.stringContaining('import type { FastifyInstance } from "fastify";'),
        'utf-8'
      );
    });

    it('should handle multiline imports', async () => {
      const fileContent = `import {
  Static,
  Type,
  validate
} from "@sinclair/typebox";

const result = validate(Type.String(), "test");
`;

      const tscOutput = `
src/test.ts:2:3 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test.ts:3:3 - error TS1484: 'Type' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      migrator.parseTscOutput(tscOutput);
      mockFs.promises.readFile.mockResolvedValue(fileContent);

      await migrator.fixImportsInFile(testFilePath);

      const writtenContent = (mockFs.promises.writeFile as any).mock.calls[0][1];
      expect(writtenContent).toMatchInlineSnapshot(`
        "import {
          Static,
          Type,
          validate
        } from "@sinclair/typebox";

        const result = validate(Type.String(), "test");
        "
      `)
      expect(writtenContent).toMatchInlineSnapshot(`
        "import {
          Static,
          Type,
          validate
        } from "@sinclair/typebox";

        const result = validate(Type.String(), "test");
        "
      `)
    });

    it('should skip files that do not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();

      await migrator.fixImportsInFile(testFilePath);

      expect(consoleSpy).toHaveBeenCalledWith(`⚠️  File not found: ${testFilePath}`);
      expect(mockFs.promises.readFile).not.toHaveBeenCalled();
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip files with no errors', async () => {
      const fileContent = `import { validate } from "@sinclair/typebox";`;

      migrator.parseTscOutput(''); // No errors
      mockFs.promises.readFile.mockResolvedValue(fileContent);

      await migrator.fixImportsInFile(testFilePath);

      expect(mockFs.promises.readFile).toHaveBeenCalledWith(testFilePath, 'utf-8');
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle file read/write errors gracefully', async () => {
      const error = new Error('File read error');
      mockFs.promises.readFile.mockRejectedValue(error);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();

      const tscOutput = `
src/test.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      migrator.parseTscOutput(tscOutput);

      await migrator.fixImportsInFile(testFilePath);

      expect(consoleSpy).toHaveBeenCalledWith(`❌ Error processing file ${testFilePath}:`, error);
      consoleSpy.mockRestore();
    });
  });

  describe('migrateImports', () => {
    it('should migrate imports for all files with errors', async () => {
      const tscOutput = `
src/test1.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/test2.ts:1:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.promises.readFile
        .mockResolvedValueOnce(`import { Static } from "@sinclair/typebox";`)
        .mockResolvedValueOnce(`import { FastifyInstance } from "fastify";`);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      await migrator.migrateImports(tscOutput);

      expect(consoleSpy).toHaveBeenCalledWith('Found 2 TS1484 errors');
      expect(consoleSpy).toHaveBeenCalledWith('Files to fix: 2');
      expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });

    it('should handle case with no errors', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      await migrator.migrateImports('');

      expect(consoleSpy).toHaveBeenCalledWith('Found 0 TS1484 errors');
      expect(consoleSpy).toHaveBeenCalledWith('No TS1484 errors found. Nothing to migrate.');
      expect(mockFs.promises.readFile).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle imports with no semicolon', () => {
      const fileContent = `import { Static, Type } from "@sinclair/typebox"
const something = 'test';`;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(1);
      expect(imports[0].module).toBe("@sinclair/typebox");
    });

    it('should handle imports with single quotes', () => {
      const fileContent = `import { Static, Type } from '@sinclair/typebox';`;

      const imports = migrator.parseImportStatements(fileContent);

      expect(imports).toHaveLength(1);
      expect(imports[0].module).toBe("@sinclair/typebox");
    });

    it('should handle complex file paths with spaces and special characters', () => {
      const tscOutput = `
src/my file with spaces.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
      `;

      const errors = migrator.parseTscOutput(tscOutput);

      expect(errors).toHaveLength(1);
      expect(errors[0].filePath).toBe(path.resolve(testBasePath, 'src/my file with spaces.ts'));
    });
  });
});