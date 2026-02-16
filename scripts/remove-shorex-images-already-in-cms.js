'use strict';

/**
 * Remove images from jease-data/shorex-images that already exist in Strapi CMS.
 * Keeps only images that are not yet in the Media Library.
 *
 * Usage: node scripts/remove-shorex-images-already-in-cms.js
 */

const fs = require('fs');
const path = require('path');

const LOCAL_FOLDER = path.join(__dirname, '..', 'jease-data', 'shorex-images');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

async function getCmsImageNames() {
  const files = await strapi.query('plugin::upload.file').findMany({});
  const names = new Set(files.map((f) => (f.name || '').toLowerCase().trim()).filter(Boolean));
  return names;
}

async function main() {
  console.log('=== Remove Shorex Images Already in CMS ===\n');

  if (!fs.existsSync(LOCAL_FOLDER)) {
    console.error(`Folder not found: ${LOCAL_FOLDER}`);
    process.exit(1);
  }

  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  console.log('Loading image names from CMS...');
  const cmsNames = await getCmsImageNames();
  console.log(`  Found ${cmsNames.size} images in CMS\n`);

  const localFiles = fs.readdirSync(LOCAL_FOLDER).filter((f) =>
    IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase())
  );

  console.log(`Checking ${localFiles.length} files in ${LOCAL_FOLDER}\n`);

  let removed = 0;
  let kept = 0;

  for (const fileName of localFiles) {
    const baseName = path.parse(fileName).name;
    const baseNameLower = baseName.toLowerCase();

    if (cmsNames.has(baseNameLower)) {
      const filePath = path.join(LOCAL_FOLDER, fileName);
      fs.unlinkSync(filePath);
      console.log(`  ✗ Removed: ${fileName} (exists in CMS)`);
      removed++;
    } else {
      console.log(`  ✓ Kept: ${fileName}`);
      kept++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Removed: ${removed}`);
  console.log(`Kept: ${kept}`);
  console.log(`\nFolder: ${LOCAL_FOLDER}`);

  await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
