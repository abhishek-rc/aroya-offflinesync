'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Convert plain text to Markdown format for Strapi richtext Markdown field
 */
function convertToRichText(text) {
  if (!text || !text.trim()) {
    return null;
  }
  return text.trim();
}

/**
 * Generate slug from page name
 */
function generateSlug(pageName) {
  if (!pageName) return '';
  
  // For Arabic text, preserve Arabic characters
  return pageName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/[^\p{L}\p{N}-]/gu, '') // Remove special chars, keep Unicode letters/numbers and dashes
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

/**
 * Check if entry already exists by code
 */
async function entryExists(code) {
  try {
    const allEntries = await strapi.documents('api::dining.dining').findMany({
      locale: 'en',
    });

    // Check if any entry has matching code
    for (const entry of allEntries) {
      if (entry.code === code) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Create dining entry in Strapi with both English and Arabic localizations
 */
async function createDiningEntry(enData, arData) {
  try {
    const code = enData.w4;
    
    // Check if entry already exists
    if (await entryExists(code)) {
      return null; // Return null to indicate skipped
    }

    // Create English dining component data
    const enDiningComponentData = {
      __component: 'activity.dining',
      description: convertToRichText(enData.w5),
      location: convertToRichText(enData.w7),
      open_times: convertToRichText(enData.w9),
    };

    // Remove null fields to avoid validation errors
    if (!enDiningComponentData.description) {
      delete enDiningComponentData.description;
    }
    if (!enDiningComponentData.location) {
      delete enDiningComponentData.location;
    }
    if (!enDiningComponentData.open_times) {
      delete enDiningComponentData.open_times;
    }

    // Create English entry data
    const enEntryData = {
      page_name: enData.w2,
      page_slug: generateSlug(enData.w2),
      code: code,
      components: [enDiningComponentData],
      publishedAt: new Date().toISOString(),
    };

    // Create English entry
    const enEntryCreated = await strapi.documents('api::dining.dining').create({
      data: enEntryData,
      locale: 'en',
    });

    console.log(`  ✓ Created English entry for ${code} (ID: ${enEntryCreated.documentId})`);

    // Create Arabic localization if available
    if (arData) {
      // Create Arabic dining component data
      const arDiningComponentData = {
        __component: 'activity.dining',
        description: convertToRichText(arData.w6),
        location: convertToRichText(arData.w8),
        open_times: convertToRichText(arData.w10),
      };

      // Remove null fields to avoid validation errors
      if (!arDiningComponentData.description) {
        delete arDiningComponentData.description;
      }
      if (!arDiningComponentData.location) {
        delete arDiningComponentData.location;
      }
      if (!arDiningComponentData.open_times) {
        delete arDiningComponentData.open_times;
      }

      // Create Arabic entry data
      const arEntryData = {
        page_name: arData.w3,
        page_slug: generateSlug(arData.w3),
        code: code,
        components: [arDiningComponentData],
      };

      // Update with Arabic locale (creates localization with same documentId)
      await strapi.documents('api::dining.dining').update({
        documentId: enEntryCreated.documentId, // Use the SAME documentId
        data: arEntryData,
        locale: 'ar', // Create Arabic version
      });

      console.log(`  ✓ Created Arabic localization for ${code} (same documentId: ${enEntryCreated.documentId})`);
    }

    return enEntryCreated;
  } catch (error) {
    // Extract simplified error message
    let errorMsg = error.message || 'Unknown error';
    // Truncate long messages
    if (errorMsg.length > 80) {
      errorMsg = errorMsg.substring(0, 80) + '...';
    }
    throw new Error(errorMsg);
  }
}

/**
 * Main import function
 */
async function importDinners(dataFilePath) {
  console.log('Starting dinner import...\n');

  // Load data file
  console.log('Loading data file...');
  const dinnerData = require(dataFilePath);
  const entries = dinnerData.result;
  
  console.log(`Found ${entries.length} dinner entries\n`);

  // Group entries by code to handle duplicates and pair English/Arabic
  const groupedByCode = {};
  
  for (const entry of entries) {
    const code = entry.w4;
    if (!groupedByCode[code]) {
      groupedByCode[code] = [];
    }
    groupedByCode[code].push(entry);
  }

  // Remove duplicates by keeping only unique codes
  const uniqueCodes = Object.keys(groupedByCode);
  console.log(`Found ${uniqueCodes.length} unique dinner codes\n`);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors = [];

  // Process each unique code
  for (let i = 0; i < uniqueCodes.length; i++) {
    const code = uniqueCodes[i];
    const codeEntries = groupedByCode[code];
    
    // Use first occurrence for both EN and AR data
    // Since the data has both w2 (English name) and w3 (Arabic name) in same entry
    const enData = codeEntries[0];
    const arData = codeEntries[0]; // Same entry contains both locales
    
    console.log(`[${i + 1}/${uniqueCodes.length}] Processing ${code} - ${enData.w2}...`);

    try {
      // Create entry with both localizations
      const result = await createDiningEntry(enData, arData);
      if (result === null) {
        console.log(`  ⚠ Skipped (already exists)`);
        skippedCount++;
      } else {
        createdCount++;
      }

      // Small delay to avoid overwhelming the system
      if (i < uniqueCodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      errorCount++;
      let errorMsg = error.message || 'Unknown error';
      // Truncate very long error messages
      if (errorMsg.length > 100) {
        errorMsg = errorMsg.substring(0, 100) + '...';
      }
      errors.push({ code, error: errorMsg });
      console.error(`  ✗ Failed: ${errorMsg}`);
    }

    // Show progress every 10 entries
    if ((i + 1) % 10 === 0 || i === uniqueCodes.length - 1) {
      console.log(`Progress: ${i + 1}/${uniqueCodes.length} processed\n`);
    }
  }

  // Summary
  console.log('\n=== Import Summary ===');
  console.log(`Total unique codes: ${uniqueCodes.length}`);
  console.log(`Created: ${createdCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(({ code, error }) => {
      console.log(`  - ${code}: ${error}`);
    });
  }

  console.log('\nImport complete!');
}

/**
 * Main execution
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  // Get data file path from command line or use default
  const dataFilePath = process.argv[2] || path.join(process.cwd(), 'jease-data', 'dinners', 'dinner.js');

  if (!fs.existsSync(dataFilePath)) {
    console.error(`Error: Data file not found at ${dataFilePath}`);
    console.error('Usage: node scripts/import-dinners.js [data-file-path]');
    process.exit(1);
  }

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await importDinners(dataFilePath);
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
