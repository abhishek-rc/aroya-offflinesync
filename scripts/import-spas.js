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
    const allEntries = await strapi.documents('api::spa.spa').findMany({
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
 * Create spa entry in Strapi with both English and Arabic localizations
 * 
 * Field Mapping:
 * - page_name: w2 (English), w3 (Arabic)
 * - page_slug: generated from page_name with hyphens
 * - code: w6 (same for both EN and AR)
 * - description: w4 (English), w5 (Arabic)
 * - treatment_type: w7 (English), w8 (Arabic)
 * - duration: w9 (English), w10 (Arabic)
 */
async function createSpaEntry(enData, arData) {
  try {
    const code = enData.w6;
    
    // Check if entry already exists
    if (await entryExists(code)) {
      return null; // Return null to indicate skipped
    }

    // Create English spa component data
    const enSpaComponentData = {
      __component: 'activity.spa-and-wellness',
      description: convertToRichText(enData.w4),
      treatment_type: enData.w7 || null,
      duration: enData.w9 || null,
    };

    // Remove null fields to avoid validation errors
    if (!enSpaComponentData.description) {
      delete enSpaComponentData.description;
    }
    if (!enSpaComponentData.treatment_type) {
      delete enSpaComponentData.treatment_type;
    }
    if (!enSpaComponentData.duration) {
      delete enSpaComponentData.duration;
    }

    // Create English entry data
    const enEntryData = {
      page_name: enData.w2,
      page_slug: generateSlug(enData.w2),
      code: code,
      components: [enSpaComponentData],
      publishedAt: new Date().toISOString(),
    };

    // Create English entry
    const enEntryCreated = await strapi.documents('api::spa.spa').create({
      data: enEntryData,
      locale: 'en',
    });

    console.log(`  ✓ Created English entry for ${code} (ID: ${enEntryCreated.documentId})`);

    // Create Arabic localization if available
    if (arData) {
      // Create Arabic spa component data
      const arSpaComponentData = {
        __component: 'activity.spa-and-wellness',
        description: convertToRichText(arData.w5),
        treatment_type: arData.w8 || null,
        duration: arData.w10 || arData.w9 || null, // Fallback to w9 if w10 is null
      };

      // Remove null fields to avoid validation errors
      if (!arSpaComponentData.description) {
        delete arSpaComponentData.description;
      }
      if (!arSpaComponentData.treatment_type) {
        delete arSpaComponentData.treatment_type;
      }
      if (!arSpaComponentData.duration) {
        delete arSpaComponentData.duration;
      }

      // Create Arabic entry data
      const arEntryData = {
        page_name: arData.w3,
        page_slug: generateSlug(arData.w3),
        code: code,
        components: [arSpaComponentData],
      };

      // Update with Arabic locale (creates localization with same documentId)
      await strapi.documents('api::spa.spa').update({
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
async function importSpas(dataFilePath) {
  console.log('Starting spa import...\n');

  // Load data file - handle both module.exports and export default
  console.log('Loading data file...');
  let spaData;
  
  // Read file content and extract the data
  const fileContent = fs.readFileSync(dataFilePath, 'utf-8');
  
  // Check if it's ES module syntax (export default) or CommonJS (module.exports)
  if (fileContent.includes('export default')) {
    // ES module - parse manually
    const jsonMatch = fileContent.match(/export\s+default\s+(\{[\s\S]*\})/);
    if (jsonMatch) {
      // Use eval to parse the object (since it's valid JS object literal)
      spaData = eval('(' + jsonMatch[1] + ')');
    }
  } else {
    // CommonJS - use require
    spaData = require(dataFilePath);
  }
  
  const entries = spaData.result;
  
  console.log(`Found ${entries.length} spa entries\n`);

  // Group entries by code to handle duplicates
  const groupedByCode = {};
  
  for (const entry of entries) {
    const code = entry.w6;
    if (!code) {
      console.log(`  ⚠ Skipping entry without code: ${entry.w2}`);
      continue;
    }
    if (!groupedByCode[code]) {
      groupedByCode[code] = [];
    }
    groupedByCode[code].push(entry);
  }

  // Remove duplicates by keeping only unique codes
  const uniqueCodes = Object.keys(groupedByCode);
  console.log(`Found ${uniqueCodes.length} unique spa codes\n`);

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
      const result = await createSpaEntry(enData, arData);
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

    // Show progress every 20 entries
    if ((i + 1) % 20 === 0 || i === uniqueCodes.length - 1) {
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
  const dataFilePath = process.argv[2] || path.join(process.cwd(), 'jease-data', 'spas', 'spas.js');

  if (!fs.existsSync(dataFilePath)) {
    console.error(`Error: Data file not found at ${dataFilePath}`);
    console.error('Usage: node scripts/import-spas.js [data-file-path]');
    process.exit(1);
  }

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await importSpas(dataFilePath);
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
