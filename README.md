
# TypeScript Import Fixer

A utility to recursively process a directory and automatically append the .ts extension to relative TypeScript imports.

It is designed to be safe and idempotent:
 - It only modifies imports that are relative (start with . or ..).
 - It only adds the .ts extension if it's not already present.
 - It checks for the existence of the target file before making any changes.

