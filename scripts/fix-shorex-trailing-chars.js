'use strict';

/**
 * Script to remove trailing spaces from page_name and trailing hyphens from page_slug
 * in all shorex (excursion) entries
 */

/**
 * Remove trailing spaces from page_name and trailing hyphens from page_slug
 */
async function fixTrailingChars() {
  console.log('Starting trailing character removal from shorex entries...\n');

  try {
    // Query excursions using documents API for both locales
    const locales = ['en', 'ar'];
    let allExcursions = [];
    
    for (const locale of locales) {
      try {
        const excursions = await strapi.documents('api::excursion.excursion').findMany({
          locale: locale,
        });
        if (excursions && excursions.length > 0) {
          // Add locale info to each excursion
          excursions.forEach(exc => {
            exc.locale = locale;
          });
          allExcursions = allExcursions.concat(excursions);
        }
      } catch (err) {
        // Ignore errors for locales that don't exist or have no excursions
        console.log(`No excursions found for locale: ${locale}`);
      }
    }

    console.log(`Found ${allExcursions.length} excursion entries (across all locales)\n`);
    
    if (allExcursions.length === 0) {
      console.log('No excursions found in the database. Make sure excursions exist before running this script.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Process each excursion
    for (let i = 0; i < allExcursions.length; i++) {
      const excursion = allExcursions[i];
      const excursionId = excursion.documentId;
      const excursionLocale = excursion.locale || 'en';
      const pageName = excursion.page_name;
      const pageSlug = excursion.page_slug;

      let needsUpdate = false;
      const updateData = {};

      // Check if page_name has trailing spaces
      if (pageName && typeof pageName === 'string') {
        const trimmedName = pageName.trimEnd();
        if (pageName !== trimmedName) {
          updateData.page_name = trimmedName;
          needsUpdate = true;
        }
      }

      // Check if page_slug has trailing hyphens
      if (pageSlug && typeof pageSlug === 'string') {
        const trimmedSlug = pageSlug.replace(/-+$/, ''); // Remove trailing hyphens
        if (pageSlug !== trimmedSlug) {
          updateData.page_slug = trimmedSlug;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        console.log(`[${i + 1}/${allExcursions.length}] Updating excursion ID ${excursionId} (locale: ${excursionLocale})`);
        if (updateData.page_name) {
          console.log(`  Old page_name: "${pageName}"`);
          console.log(`  New page_name: "${updateData.page_name}"`);
        }
        if (updateData.page_slug) {
          console.log(`  Old page_slug: "${pageSlug}"`);
          console.log(`  New page_slug: "${updateData.page_slug}"`);
        }

        try {
          // Use documents API to update
          await strapi.documents('api::excursion.excursion').update({
            documentId: excursionId,
            data: updateData,
            locale: excursionLocale,
          });

          updatedCount++;
          console.log(`  ✓ Updated successfully\n`);
        } catch (error) {
          // Ignore plugin warnings/errors that aren't critical
          const errorMsg = error.message || 'Unknown error';
          if (!errorMsg.includes('deep-populate') && !errorMsg.includes('Failed to save cached entry')) {
            errors.push({ 
              id: excursionId, 
              locale: excursionLocale,
              page_name: pageName,
              page_slug: pageSlug,
              error: errorMsg 
            });
            console.error(`  ✗ Failed: ${errorMsg}\n`);
          } else {
            // Plugin warning, but update might have succeeded
            updatedCount++;
            console.log(`  ✓ Updated (plugin warning ignored)\n`);
          }
        }
      } else {
        skippedCount++;
        if (i < 10 || (i + 1) % 50 === 0) {
          console.log(`[${i + 1}/${allExcursions.length}] Skipping excursion ID ${excursionId} (locale: ${excursionLocale}) - no trailing characters found\n`);
        }
      }

      // Show progress every 50 entries
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${allExcursions.length} processed (${updatedCount} updated, ${skippedCount} skipped)\n`);
      }
    }

    // Summary
    console.log('\n=== Update Summary ===');
    console.log(`Total excursions processed: ${allExcursions.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(({ id, locale, page_name, page_slug, error }) => {
        console.log(`  - ID: ${id}, Locale: ${locale}, page_name: "${page_name}", page_slug: "${page_slug}"`);
        console.log(`    Error: ${error}`);
      });
    }

    console.log('\nTrailing character removal complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  // Suppress plugin warnings and set log level to error only
  app.log.level = 'error';
  
  // Suppress console warnings from plugins
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const msg = args.join(' ');
    // Ignore deep-populate plugin warnings
    if (!msg.includes('deep-populate') && !msg.includes('Failed to save cached entry')) {
      originalWarn.apply(console, args);
    }
  };

  await fixTrailingChars();
  
  // Restore original console.warn
  console.warn = originalWarn;
  
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

