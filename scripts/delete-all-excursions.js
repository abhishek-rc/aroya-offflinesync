'use strict';

/**
 * Delete ALL Booking Journey - Excursion entries.
 * Use with caution - this is irreversible.
 *
 * Usage: node scripts/delete-all-excursions.js
 *        node scripts/delete-all-excursions.js --confirm  (required to actually delete)
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function main() {
  const confirm = process.argv.includes('--confirm');

  console.log('=== Delete All Excursions ===\n');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  const entries = await strapi.documents('api::excursion.excursion').findMany({
    locale: 'en',
    fields: ['documentId'],
  });

  const documentIds = [...new Set(entries.map((e) => e.documentId))];
  console.log(`Found ${documentIds.length} excursion documents.\n`);

  if (!confirm) {
    console.log('Dry run. To actually delete, run with --confirm:');
    console.log('  node scripts/delete-all-excursions.js --confirm\n');
    await app.destroy();
    process.exit(0);
    return;
  }

  console.log('Deleting...');
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < documentIds.length; i++) {
    const documentId = documentIds[i];
    try {
      await strapi.documents('api::excursion.excursion').delete({
        documentId,
        locale: '*',
      });
      deleted++;
      if ((i + 1) % 50 === 0) {
        process.stdout.write(`\r  [${i + 1}/${documentIds.length}] deleted`);
      }
    } catch (err) {
      console.error(`\n  Failed ${documentId}:`, err.message);
      failed++;
    }
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Failed: ${failed}`);

  await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
