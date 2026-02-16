'use strict';

/**
 * Create a new empty folder in Strapi Media Library for manual shorex image uploads.
 * Use this when you want to upload images manually via CMS UI.
 *
 * Usage: node scripts/create-shorex-images-folder.js [folder-name]
 * Default folder name: "missing-shorexes-images"
 */

const path = require('path');

const FOLDER_NAME = process.argv[2] || 'missing-shorexes-images';

async function main() {
  console.log('=== Create Strapi Media Folder ===\n');

  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  const existing = await strapi.query('plugin::upload.folder').findOne({
    where: {
      name: FOLDER_NAME,
      parent: null,
    },
  });

  if (existing) {
    console.log(`Folder "${FOLDER_NAME}" already exists (ID: ${existing.id})`);
    console.log('  Path:', existing.path);
    await app.destroy();
    process.exit(0);
    return;
  }

  const folders = await strapi.query('plugin::upload.folder').findMany({
    orderBy: { pathId: 'desc' },
    limit: 1,
  });
  const nextPathId = folders.length > 0 ? folders[0].pathId + 1 : 1;

  const pathSlug = FOLDER_NAME.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
  const folder = await strapi.query('plugin::upload.folder').create({
    data: {
      name: FOLDER_NAME,
      path: `/${pathSlug || 'folder'}`,
      pathId: nextPathId,
    },
  });

  console.log(`✓ Created folder: "${folder.name}"`);
  console.log(`  ID: ${folder.id}`);
  console.log(`  Path: ${folder.path}`);
  console.log('\nYou can now upload images manually in the CMS UI to this folder.');

  await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
