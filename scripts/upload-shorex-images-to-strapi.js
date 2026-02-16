'use strict';

/**
 * Import images from jease-data/shorex-images into Strapi Media Library "shorexes" folder.
 * Skips images that already exist in the shorexes folder.
 *
 * Usage: node scripts/upload-shorex-images-to-strapi.js
 */

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const SOURCE_FOLDER = path.join(__dirname, '..', 'jease-data', 'shorex-images');
const STRAPI_FOLDER_NAME = 'shorexes';

function getFileData(filePath, fileName) {
  const stats = fs.statSync(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = mime.lookup(ext) || 'image/jpeg';
  return {
    filepath: filePath,
    originalFileName: fileName,
    size: stats.size,
    mimetype: mimeType,
  };
}

async function getOrCreateShorexesFolder() {
  const existingFolder = await strapi.query('plugin::upload.folder').findOne({
    where: {
      name: STRAPI_FOLDER_NAME,
      parent: null,
    },
  });

  if (existingFolder) {
    return existingFolder;
  }

  const folders = await strapi.query('plugin::upload.folder').findMany({
    orderBy: { pathId: 'desc' },
    limit: 1,
  });
  const nextPathId = folders.length > 0 ? folders[0].pathId + 1 : 1;

  return strapi.query('plugin::upload.folder').create({
    data: {
      name: STRAPI_FOLDER_NAME,
      path: `/${STRAPI_FOLDER_NAME}`,
      pathId: nextPathId,
    },
  });
}

async function uploadImage(filePath, fileName, folder) {
  const fileNameNoExt = path.parse(fileName).name;
  const fileData = getFileData(filePath, fileName);

  const result = await strapi.plugin('upload').service('upload').upload({
    files: fileData,
    data: {
      fileInfo: {
        alternativeText: fileNameNoExt,
        caption: fileNameNoExt,
        name: fileNameNoExt,
      },
    },
  });

  const uploadedFile = result[0];

  if (folder && uploadedFile) {
    await strapi.query('plugin::upload.file').update({
      where: { id: uploadedFile.id },
      data: {
        folder: folder.id,
        folderPath: folder.path,
      },
    });
  }

  return uploadedFile;
}

async function main() {
  console.log('=== Upload Shorex Images to Strapi ===\n');

  if (!fs.existsSync(SOURCE_FOLDER)) {
    console.error(`Error: Source folder not found: ${SOURCE_FOLDER}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SOURCE_FOLDER);
  const imageFiles = files.filter((f) =>
    ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(f).toLowerCase())
  );

  console.log(`Source: ${SOURCE_FOLDER}`);
  console.log(`Found ${imageFiles.length} images\n`);

  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  const folder = await getOrCreateShorexesFolder();
  console.log(`Target: Strapi Media Library → "${folder.name}" folder (ID: ${folder.id})\n`);

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < imageFiles.length; i++) {
    const fileName = imageFiles[i];
    const fileNameNoExt = path.parse(fileName).name;
    const filePath = path.join(SOURCE_FOLDER, fileName);

    try {
      const existing = await strapi.query('plugin::upload.file').findOne({
        where: {
          name: fileNameNoExt,
          folder: folder.id,
        },
      });

      if (existing) {
        console.log(`  [${i + 1}/${imageFiles.length}] ⊘ ${fileName}: Already exists`);
        skipped++;
        continue;
      }

      await uploadImage(filePath, fileName, folder);
      console.log(`  [${i + 1}/${imageFiles.length}] ✓ ${fileName}: Uploaded`);
      uploaded++;

      if (i < imageFiles.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error) {
      // EPERM on unlink = Windows temp file cleanup failed, but upload often succeeds
      if (error.message && error.message.includes('EPERM') && error.message.includes('unlink')) {
        await new Promise((r) => setTimeout(r, 800));
        const verified = await strapi.query('plugin::upload.file').findOne({
          where: { name: fileNameNoExt, folder: folder.id },
        });
        if (verified) {
          console.log(`  [${i + 1}/${imageFiles.length}] ✓ ${fileName}: Uploaded (cleanup error ignored)`);
          uploaded++;
        } else {
          console.error(`  [${i + 1}/${imageFiles.length}] ✗ ${fileName}: ${error.message}`);
          errors++;
        }
      } else {
        console.error(`  [${i + 1}/${imageFiles.length}] ✗ ${fileName}: ${error.message}`);
        errors++;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Skipped (already exists): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nImages in "shorexes" folder: ${folder.name}`);

  await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
