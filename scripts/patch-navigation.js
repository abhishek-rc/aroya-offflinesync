/**
 * Patch for strapi-plugin-navigation
 * Fixes ZodError when navigation items have parent with related field as array
 * Issue: Strapi 5 returns parent.related as array, but plugin expects object
 */

const fs = require('fs');
const path = require('path');

// Patterns for both minified (.js) and non-minified (.mjs) versions
const PATTERNS = [
  // Non-minified version (with spaces)
  {
    old: 'related: y.object({ documentId: y.string().optional(), __type: y.string() }).catchall(y.unknown()).nullish().optional()',
    new: 'related: y.union([y.object({ documentId: y.string().optional(), __type: y.string() }).catchall(y.unknown()), y.array(y.object({ documentId: y.string().optional(), __type: y.string() }).catchall(y.unknown()))]).nullish().optional()'
  },
  // Minified version (no spaces)
  {
    old: 'related:y.object({documentId:y.string().optional(),__type:y.string()}).catchall(y.unknown()).nullish().optional()',
    new: 'related:y.union([y.object({documentId:y.string().optional(),__type:y.string()}).catchall(y.unknown()),y.array(y.object({documentId:y.string().optional(),__type:y.string()}).catchall(y.unknown()))]).nullish().optional()'
  }
];

const filesToPatch = [
  'node_modules/strapi-plugin-navigation/dist/server/index.js',
  'node_modules/strapi-plugin-navigation/dist/server/index.mjs',
];

function patchFile(filePath) {
  const fullPath = path.join(process.cwd(), filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`[patch-navigation] Skipping ${filePath} - file not found`);
    return false;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let patched = false;

  for (const pattern of PATTERNS) {
    if (content.includes(pattern.new)) {
      console.log(`[patch-navigation] ${filePath} already patched`);
      return true;
    }

    if (content.includes(pattern.old)) {
      content = content.replace(pattern.old, pattern.new);
      patched = true;
      console.log(`[patch-navigation] Applied patch to ${filePath}`);
    }
  }

  if (patched) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`[patch-navigation] Successfully saved ${filePath}`);
    return true;
  }

  console.log(`[patch-navigation] ${filePath} - no matching pattern found, may have different version`);
  return false;
}

console.log('[patch-navigation] Patching strapi-plugin-navigation for Strapi 5 compatibility...');

let patchedCount = 0;
for (const file of filesToPatch) {
  if (patchFile(file)) {
    patchedCount++;
  }
}

if (patchedCount > 0) {
  console.log(`[patch-navigation] Done! Patched ${patchedCount} file(s)`);
} else {
  console.log('[patch-navigation] No files were patched');
}
