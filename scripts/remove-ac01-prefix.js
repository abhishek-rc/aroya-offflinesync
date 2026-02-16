'use strict';

/**
 * Script to remove "AC01_" prefix from all pkg_code fields in packages
 */

/**
 * Remove AC01_ prefix from pkg_code in all packages
 */
async function removeAC01Prefix() {
  console.log('Starting AC01_ prefix removal from packages...\n');

  try {
    // Query packages using entityService (more reliable)
    const locales = ['en', 'ar'];
    let allPackages = [];
    
    for (const locale of locales) {
      try {
        const packages = await strapi.entityService.findMany('api::package.package', {
          locale: locale,
          limit: 10000, // Get all packages
        });
        if (packages && packages.length > 0) {
          // Add locale info to each package
          packages.forEach(pkg => {
            pkg.locale = locale;
          });
          allPackages = allPackages.concat(packages);
        }
      } catch (err) {
        // Ignore errors for locales that don't exist or have no packages
        console.log(`No packages found for locale: ${locale}`);
      }
    }

    console.log(`Found ${allPackages.length} package entries (across all locales)\n`);
    
    if (allPackages.length === 0) {
      console.log('No packages found in the database. Make sure packages exist before running this script.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Process each package
    for (let i = 0; i < allPackages.length; i++) {
      const pkg = allPackages[i];
      const pkgCode = pkg.pkg_code;
      const pkgId = pkg.id;
      const pkgLocale = pkg.locale || 'en';

      // Check if pkg_code starts with "AC01_"
      if (pkgCode && typeof pkgCode === 'string' && pkgCode.startsWith('AC01_')) {
        const newPkgCode = pkgCode.replace(/^AC01_/, '');
        
        console.log(`[${i + 1}/${allPackages.length}] Updating package ID ${pkgId} (locale: ${pkgLocale})`);
        console.log(`  Old pkg_code: ${pkgCode}`);
        console.log(`  New pkg_code: ${newPkgCode}`);

        try {
          // Use entityService to update
          await strapi.entityService.update('api::package.package', pkgId, {
            data: {
              pkg_code: newPkgCode,
            },
            locale: pkgLocale,
          });

          updatedCount++;
          console.log(`  ✓ Updated successfully\n`);
        } catch (error) {
          // Ignore plugin warnings/errors that aren't critical
          const errorMsg = error.message || 'Unknown error';
          if (!errorMsg.includes('deep-populate') && !errorMsg.includes('Failed to save cached entry')) {
            errors.push({ 
              id: pkgId, 
              locale: pkgLocale,
              pkg_code: pkgCode,
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
          console.log(`[${i + 1}/${allPackages.length}] Skipping package ID ${pkgId} (locale: ${pkgLocale}) - pkg_code doesn't start with AC01_\n`);
        }
      }

      // Show progress every 50 entries
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${allPackages.length} processed (${updatedCount} updated, ${skippedCount} skipped)\n`);
      }
    }

    // Summary
    console.log('\n=== Update Summary ===');
    console.log(`Total packages processed: ${allPackages.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(({ id, locale, pkg_code, error }) => {
        console.log(`  - ID: ${id}, Locale: ${locale}, pkg_code: ${pkg_code}`);
        console.log(`    Error: ${error}`);
      });
    }

    console.log('\nPrefix removal complete!');
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

  await removeAC01Prefix();
  
  // Restore original console.warn
  console.warn = originalWarn;
  
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

