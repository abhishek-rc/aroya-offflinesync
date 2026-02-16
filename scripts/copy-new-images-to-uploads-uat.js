'use strict';

/**
 * Copy new images from jease-data/uploads/uploads to jease-data/uploads-uat/uploads-uat
 * Only copies files that exist in uploads but NOT in uploads-uat.
 *
 * Usage: node scripts/copy-new-images-to-uploads-uat.js
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
  console.log('=== Copy New Images to uploads-uat ===\n');

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
  const newInUploads = uploadsFiles.filter((f) => !uatBasenames.has(f.basename));
  console.log(`  New images to copy: ${newInUploads.length}\n`);

  if (newInUploads.length === 0) {
    console.log('No new images to copy.');
    return;
  }

  console.log('Copying...');
  let copied = 0;
  let failed = 0;

  for (let i = 0; i < newInUploads.length; i++) {
    const file = newInUploads[i];
    const destPath = path.join(UPLOADS_UAT_DIR, file.relativePath);
    const destDir = path.dirname(destPath);

    try {
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(file.fullPath, destPath);
      copied++;
    } catch (err) {
      console.error(`  Failed: ${file.relativePath}: ${err.message}`);
      failed++;
    }

    if ((i + 1) % 200 === 0) {
      process.stdout.write(`\r  [${i + 1}/${newInUploads.length}] copied`);
    }
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`  Copied: ${copied}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Target: ${UPLOADS_UAT_DIR}`);
}

main();
