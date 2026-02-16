// Server plugin entry point for Strapi 5
// Load TypeScript files directly using ts-node in development
'use strict';

// Register ts-node to handle TypeScript files
// Configure ts-node to compile files even if they're excluded in tsconfig
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'node',
    target: 'ES2019',
    lib: ['ES2020'],
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowJs: true,
  },
  ignore: ['(?:^|/)node_modules/'],
});

// Load the TypeScript source file directly
// Handle default export from TypeScript module
const plugin = require('./server/src/index.ts');
module.exports = plugin.default || plugin;

