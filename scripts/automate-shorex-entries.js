'use strict';

const fs = require('fs');
const path = require('path');

const XML_FILE = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');

/**
 * Parse shorex XML file and extract entries
 * Format: <shorex:ID title="..." name="..." locale="...">content</shorex:ID>
 */
function parseShorexXML(xmlFilePath) {
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const entries = [];
  
  // Regex to match shorex entries
  const shorexPattern = /<shorex:([A-Z0-9]+)\s+([^>]+)>([\s\S]*?)<\/shorex:\1>/g;
  
  let match;
  while ((match = shorexPattern.exec(xmlContent)) !== null) {
    const id = match[1];
    const attributes = match[2];
    const content = match[3].trim();
    
    // Parse attributes
    const titleMatch = attributes.match(/title="([^"]+)"/);
    const nameMatch = attributes.match(/name="([^"]+)"/);
    const localeMatch = attributes.match(/locale="([^"]+)"/);
    
    const title = titleMatch ? titleMatch[1] : '';
    const name = nameMatch ? nameMatch[1] : '';
    const locale = localeMatch ? localeMatch[1] : 'en';
    
    entries.push({
      id,
      title,
      name,
      locale,
      description: content,
    });
  }
  
  return entries;
}

/**
 * Group entries by ID and locale
 * If duplicates exist, keeps the first occurrence
 */
function groupEntriesByID(entries) {
  const grouped = {};
  const duplicates = [];
  
  for (const entry of entries) {
    if (!grouped[entry.id]) {
      grouped[entry.id] = {};
    }
    
    // Check if this ID+locale combination already exists
    if (grouped[entry.id][entry.locale]) {
      duplicates.push({ id: entry.id, locale: entry.locale });
      // Keep the first occurrence, skip duplicates
      continue;
    }
    
    grouped[entry.id][entry.locale] = entry;
  }
  
  if (duplicates.length > 0) {
    console.log(`⚠ Warning: Found ${duplicates.length} duplicate entries (same ID+locale)`);
    console.log(`   Keeping first occurrence, skipping duplicates\n`);
  }
  
  return grouped;
}

/**
 * Convert text to rich text format (Markdown)
 * Converts bullet character (•) to Markdown bullet syntax (- )
 */
function convertToRichText(text) {
  if (!text || !text.trim()) {
    return null;
  }

  // Convert bullet character (•) to Markdown bullet syntax (- )
  const lines = text.split('\n');
  const markdownLines = lines.map(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('•')) {
      const indent = line.match(/^\s*/)[0];
      return indent + '- ' + trimmedLine.substring(1).trim();
    }
    return line;
  });

  return markdownLines.join('\n');
}

/**
 * Generate slug from page name
 */
function generateSlug(pageName) {
  if (!pageName) return '';
  
  return pageName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate Arabic slug from page name (preserves Arabic characters)
 */
function generateArabicSlug(pageName) {
  if (!pageName) return '';
  
  return pageName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if entry already exists by shorex_code
 */
async function entryExists(shorexId) {
  try {
    const allEntries = await strapi.documents('api::excursion.excursion').findMany({
      locale: 'en',
      populate: '*', // Required for dynamic zones - without this, excursions/Activity may be empty
    });

    for (const entry of allEntries) {
      if (entry.excursions && Array.isArray(entry.excursions)) {
        for (const excursion of entry.excursions) {
          if (excursion.__component === 'packages.excursions' && excursion.Activity) {
            if (excursion.Activity.shorex_code === shorexId) {
              return true;
            }
          }
        }
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Create excursion entry in Strapi with both English and Arabic localizations
 */
async function createExcursionEntry(shorexId, enEntry, arEntry) {
  try {
    // Check if entry already exists
    if (await entryExists(shorexId)) {
      return null; // Return null to indicate skipped
    }

    // Create Activity component data for English
    const activityData = {
      name: convertToRichText(enEntry.name) || enEntry.name,
      short_description: convertToRichText(enEntry.title) || enEntry.title,
      long_description: convertToRichText(enEntry.description),
      media: [], // Empty media array as requested
      shorex_code: shorexId,
    };
    
    // Remove fields if null to avoid validation errors
    if (!activityData.long_description) {
      delete activityData.long_description;
    }
    if (!activityData.short_description) {
      delete activityData.short_description;
    }
    if (!activityData.name) {
      delete activityData.name;
    }

    // Create Excursions component data
    const excursionsComponentData = {
      __component: 'packages.excursions',
      Activity: activityData,
    };

    // Create entry data for English locale
    const entryData = {
      page_name: enEntry.name,
      page_slug: generateSlug(enEntry.name),
      excursions: [excursionsComponentData],
      publishedAt: new Date().toISOString(),
    };

    // Create English entry
    const enEntryCreated = await strapi.documents('api::excursion.excursion').create({
      data: entryData,
      locale: 'en',
    });

    console.log(`  ✓ Created English entry for ${shorexId} (ID: ${enEntryCreated.documentId})`);

    // Create Arabic entry as localization if available
    if (arEntry) {
      // Create Arabic Activity component data
      const arActivityData = {
        name: convertToRichText(arEntry.name) || arEntry.name,
        short_description: convertToRichText(arEntry.title) || arEntry.title,
        long_description: convertToRichText(arEntry.description),
        media: [], // Empty media array as requested
        shorex_code: shorexId,
      };
      
      // Remove fields if null to avoid validation errors
      if (!arActivityData.long_description) {
        delete arActivityData.long_description;
      }
      if (!arActivityData.short_description) {
        delete arActivityData.short_description;
      }
      if (!arActivityData.name) {
        delete arActivityData.name;
      }

      const arExcursionsComponentData = {
        __component: 'packages.excursions',
        Activity: arActivityData,
      };

      // Generate Arabic slug
      const arSlug = generateArabicSlug(arEntry.name) || generateSlug(arEntry.name);
      
      const arUpdateData = {
        page_name: arEntry.name,
        page_slug: arSlug,
        excursions: [arExcursionsComponentData],
      };
      
      // Update with Arabic locale (creates localization with same documentId)
      await strapi.documents('api::excursion.excursion').update({
        documentId: enEntryCreated.documentId,
        data: arUpdateData,
        locale: 'ar',
      });
      
      console.log(`  ✓ Created Arabic localization for ${shorexId} (same documentId: ${enEntryCreated.documentId})`);
    }

    return enEntryCreated;
  } catch (error) {
    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.length > 80) {
      errorMsg = errorMsg.substring(0, 80) + '...';
    }
    throw new Error(`Failed to create entry ${shorexId}: ${errorMsg}`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Shorex Entry Automation ===\n');
  console.log('Parsing XML file...');
  
  // Parse XML
  const entries = parseShorexXML(XML_FILE);
  console.log(`Found ${entries.length} total entries in XML`);
  
  // Count by locale
  const enCount = entries.filter(e => e.locale === 'en').length;
  const arCount = entries.filter(e => e.locale === 'ar').length;
  console.log(`  English entries: ${enCount}`);
  console.log(`  Arabic entries: ${arCount}\n`);
  
  // Group by ID and locale (handles duplicates)
  const grouped = groupEntriesByID(entries);
  const shorexIds = Object.keys(grouped).sort();
  
  console.log(`Found ${shorexIds.length} unique shorex IDs`);
  
  // Count how many have both locales
  let bothLocales = 0;
  let onlyEn = 0;
  let onlyAr = 0;
  shorexIds.forEach(id => {
    const locales = Object.keys(grouped[id]);
    if (locales.includes('en') && locales.includes('ar')) {
      bothLocales++;
    } else if (locales.includes('en')) {
      onlyEn++;
    } else if (locales.includes('ar')) {
      onlyAr++;
    }
  });
  console.log(`  IDs with both EN and AR: ${bothLocales}`);
  console.log(`  IDs with only EN: ${onlyEn}`);
  console.log(`  IDs with only AR: ${onlyAr}\n`);
  
  // Initialize Strapi
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  
  console.log('Starting import...\n');
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  const errorList = [];
  
  // Process each shorex ID
  for (const shorexId of shorexIds) {
    const locales = grouped[shorexId];
    const enEntry = locales.en;
    const arEntry = locales.ar;
    
    if (!enEntry) {
      console.log(`⚠ Skipping ${shorexId}: No English entry found`);
      skipped++;
      continue;
    }
    
    try {
      const result = await createExcursionEntry(shorexId, enEntry, arEntry);
      if (result === null) {
        console.log(`⊘ Skipped ${shorexId}: Already exists`);
        skipped++;
      } else {
        created++;
      }
    } catch (error) {
      console.error(`✗ Error creating ${shorexId}: ${error.message}`);
      errors++;
      errorList.push({ shorexId, error: error.message });
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  
  if (errorList.length > 0) {
    console.log('\nErrors:');
    errorList.forEach(({ shorexId, error }) => {
      console.log(`  ${shorexId}: ${error}`);
    });
  }
  
  await app.destroy();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
