'use strict';

/**
 * Compare jease-data/uploads/uploads vs jease-data/uploads-uat/uploads-uat
 * Find images in uploads that are NOT in uploads-uat (new images).
 *
 * Usage: node scripts/count-new-images-in-uploads.js
 */

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'jease-data', 'uploads', 'uploads');
const UPLOADS_UAT_DIR = path.join(__dirname, '..', 'jease-data', 'uploads-uat', 'uploads-uat');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      const ext = path.extname(item).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        files.push({
          fullPath,
          relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
          basename: item,
        });
      }
    }
  }
  return files;
}

function main() {
  console.log('=== Count New Images in uploads (not in uploads-uat) ===\n');

  if (!fs.existsSync(UPLOADS_DIR)) {
    console.error(`Error: ${UPLOADS_DIR} not found`);
    process.exit(1);
  }
  if (!fs.existsSync(UPLOADS_UAT_DIR)) {
    console.error(`Error: ${UPLOADS_UAT_DIR} not found`);
    process.exit(1);
  }

  console.log('Loading uploads-uat filenames...');
  const uatFiles = getAllFiles(UPLOADS_UAT_DIR);
  const uatBasenames = new Set(uatFiles.map((f) => f.basename));
  console.log(`  uploads-uat: ${uatFiles.length} images\n`);

  console.log('Loading uploads filenames...');
  const uploadsFiles = getAllFiles(UPLOADS_DIR);
  console.log(`  uploads: ${uploadsFiles.length} images\n`);

  const newInUploads = uploadsFiles.filter((f) => !uatBasenames.has(f.basename));
  const count = newInUploads.length;

  console.log('=== Result ===');
  console.log(`New images in uploads (not in uploads-uat): ${count}\n`);

  if (count > 0) {
    console.log('Files:');
    newInUploads.slice(0, 50).forEach((f) => console.log(`  ${f.relativePath}`));
    if (count > 50) {
      console.log(`  ... and ${count - 50} more`);
    }

    const outputFile = path.join(__dirname, '..', 'jease-data', 'new-images-in-uploads.txt');
    const content = newInUploads.map((f) => f.relativePath).join('\n');
    fs.writeFileSync(outputFile, content, 'utf-8');
    console.log(`\nFull list saved to: ${outputFile}`);
  }
}

main();
