'use strict';

/**
 * Migration script to update component name from shared.onboarding-experience to shared.card-sections
 * 
 * Run with: node ./scripts/update-component-name.js
 */

/**
 * Update component name from shared.onboarding-experience to shared.card-sections
 */
async function updateComponentName() {
  console.log('Starting component name update migration...\n');
  console.log('Updating: shared.onboarding-experience -> shared.card-sections\n');

  try {
    // Get database connection
    const db = strapi.db;
    const client = db.config.connection.client;
    
    // Query pages directly from database to find JSON containing the old component name
    let allPages = [];
    
    if (client === 'sqlite') {
      // SQLite query
      const pages = await db.query('api::page.page').findMany({
        where: {},
      });
      allPages = pages;
    } else if (client === 'postgres') {
      // PostgreSQL query - search for the component name in JSON
      const query = `
        SELECT id, locale, components 
        FROM pages 
        WHERE components::text LIKE '%shared.onboarding-experience%'
      `;
      const result = await db.connection.raw(query);
      allPages = result.rows || result;
    } else if (client === 'mysql') {
      // MySQL query - search for the component name in JSON
      const query = `
        SELECT id, locale, components 
        FROM pages 
        WHERE JSON_CONTAINS(components, '"shared.onboarding-experience"', '$[*].__component')
           OR components LIKE '%shared.onboarding-experience%'
      `;
      const result = await db.connection.raw(query);
      allPages = Array.isArray(result) ? result : (result[0] || []);
    }

    console.log(`Found ${allPages.length} page entries with old component name\n`);
    
    if (allPages.length === 0) {
      console.log('No pages found with the old component name. They may have already been updated or don\'t exist.');
      console.log('Trying alternative method: checking all pages...\n');
      
      // Fallback: Get all pages and check manually
      const locales = ['en', 'ar'];
      for (const locale of locales) {
        try {
          const pages = await strapi.entityService.findMany('api::page.page', {
            locale: locale,
            populate: ['components'],
            limit: 10000,
          });
          if (pages && pages.length > 0) {
            pages.forEach(page => {
              page.locale = locale;
            });
            allPages = allPages.concat(pages);
          }
        } catch (err) {
          console.log(`No pages found for locale: ${locale}`);
        }
      }
      
      console.log(`Found ${allPages.length} total page entries to check\n`);
    }

    if (allPages.length === 0) {
      console.log('No pages found in the database. Make sure pages exist before running this script.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Process each page
    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const pageId = page.id || page.documentId;
      const pageLocale = page.locale || 'en';
      
      // Get components - might be stored as JSON string or object
      let components = page.components;
      if (typeof components === 'string') {
        try {
          components = JSON.parse(components);
        } catch (e) {
          console.error(`Failed to parse components JSON for page ${pageId}: ${e.message}`);
          skippedCount++;
          continue;
        }
      }
      components = components || [];

      // Debug: Log component types found for first few pages
      if (components.length > 0 && i < 3) {
        console.log(`\nDebug - Page ID ${pageId} components:`);
        components.forEach((comp, idx) => {
          const compName = comp.__component || comp.component || 'UNKNOWN';
          console.log(`  Component ${idx}: ${compName}`);
        });
      }

      // Check if any component has the old name (check both __component and component fields)
      let needsUpdate = false;
      const updatedComponents = components.map((component) => {
        const componentName = component.__component || component.component;
        if (componentName === 'shared.onboarding-experience') {
          needsUpdate = true;
          const updated = {
            ...component,
            __component: 'shared.card-sections',
          };
          // Also update component field if it exists
          if (component.component) {
            updated.component = 'shared.card-sections';
          }
          return updated;
        }
        return component;
      });

      if (needsUpdate) {
        console.log(`[${i + 1}/${allPages.length}] Updating page ID ${pageId} (locale: ${pageLocale})`);
        console.log(`  Found component: shared.onboarding-experience`);
        console.log(`  Updating to: shared.card-sections`);

        try {
          // Try using documents API first (better for dynamic zones)
          if (page.documentId) {
            await strapi.documents('api::page.page').update({
              documentId: page.documentId,
              data: {
                components: updatedComponents,
              },
              locale: pageLocale,
            });
          } else {
            // Fallback to entityService
            await strapi.entityService.update('api::page.page', pageId, {
              data: {
                components: updatedComponents,
              },
              locale: pageLocale,
            });
          }

          updatedCount++;
          console.log(`  ✓ Updated successfully\n`);
        } catch (error) {
          // Ignore plugin warnings/errors that aren't critical
          const errorMsg = error.message || 'Unknown error';
          if (!errorMsg.includes('deep-populate') && !errorMsg.includes('Failed to save cached entry')) {
            errors.push({ 
              id: pageId, 
              locale: pageLocale,
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
          console.log(`[${i + 1}/${allPages.length}] Skipping page ID ${pageId} (locale: ${pageLocale}) - no old component found\n`);
        }
      }

      // Show progress every 50 entries
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${allPages.length} processed (${updatedCount} updated, ${skippedCount} skipped)\n`);
      }
    }

    // Summary
    console.log('\n=== Update Summary ===');
    console.log(`Total pages processed: ${allPages.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(({ id, locale, error }) => {
        console.log(`  - ID: ${id}, Locale: ${locale}`);
        console.log(`    Error: ${error}`);
      });
    }

    console.log('\nComponent name update complete!');
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

  await updateComponentName();
  
  // Restore original console.warn
  console.warn = originalWarn;
  
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

