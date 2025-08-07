// Usage example
async function main() {
  // Get base path from command line arguments or use current directory
  const basePath = process.argv[2] || process.cwd();
  
  const tscOutput = `
src/web/routes/api/v1/pms/endpoint.ts:1:10 - error TS1484: 'Static' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

1 import { Static, Type } from "@sinclair/typebox";
           ~~~~~~

src/web/routes/api/v1/pms/endpoint.ts:2:10 - error TS1484: 'FastifyInstance' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
           ~~~~~~~~~~~~~~~

src/web/routes/api/v1/pms/endpoint.ts:2:27 - error TS1484: 'FastifyPluginOptions' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
                            ~~~~~~~~~~~~~~~~~~~~

src/web/routes/api/v1/pms/endpoint.ts:2:49 - error TS1484: 'FastifyReply' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
                                                  ~~~~~~~~~~~~

src/web/routes/api/v1/pms/endpoint.ts:2:63 - error TS1484: 'FastifyRequest' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.

2 import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
                                                                ~~~~~~~~~~~~~~
  `;

  const migrator = new TypeOnlyImportMigrator(basePath);
  await migrator.migrateImports(tscOutput);
}

// Export for use as a module
export { TypeOnlyImportMigrator };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}