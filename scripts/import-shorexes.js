'use strict';

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

/**
 * Parse shorex XML file and extract entries
 * Format: <shorex:ID title="..." name="..." locale="...">content</shorex:ID>
 */
function parseShorexXML(xmlFilePath) {
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const entries = [];
  
  // Regex to match shorex entries, ignoring comments
  // Pattern: <shorex:ID attributes>content</shorex:ID>
  // Use non-greedy match with s flag to handle multiline content
  const shorexPattern = /<shorex:([A-Z0-9]+)\s+([^>]+)>([\s\S]*?)<\/shorex:\1>/g;
  
  let match;
  let matchCount = 0;
  while ((match = shorexPattern.exec(xmlContent)) !== null) {
    matchCount++;
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
      title,      // Will go to short_description field
      name,       // Will go to name field
      locale,
      description: content, // Will go to long_description field
    });
  }
  
  console.log(`Parsed ${matchCount} shorex entries from XML`);
  return entries;
}

/**
 * Group entries by ID and locale
 */
function groupEntriesByID(entries) {
  const grouped = {};
  
  for (const entry of entries) {
    if (!grouped[entry.id]) {
      grouped[entry.id] = {};
    }
    grouped[entry.id][entry.locale] = entry;
  }
  
  return grouped;
}

/**
 * Convert shorex ID to image filename pattern
 * Examples: JED01 -> JED_01, JED06 -> JED_06, JED06A -> JED_06A
 */
function convertIDToImagePattern(shorexId) {
  // Match pattern: 3 letters + numbers + optional letter
  const match = shorexId.match(/^([A-Z]{3})(\d+)([A-Z]?)$/);
  if (match) {
    const prefix = match[1];
    const number = match[2];
    const suffix = match[3] || '';
    return `${prefix}_${number}${suffix}`;
  }
  return shorexId;
}

/**
 * Find and upload image file by shorex ID from local folder
 */
async function findImageByShorexID(shorexId) {
  const imagePattern = convertIDToImagePattern(shorexId);
  const imagesFolder = path.join(process.cwd(), 'jease-data', 'shorexes-images');
  
  if (!fs.existsSync(imagesFolder)) {
    return null;
  }
  
  // Try both patterns: converted (YNB_07) and original (YNB07)
  const patternsToTry = [imagePattern, shorexId];
  
  // First, check if file already exists in Strapi
  for (const pattern of patternsToTry) {
    const existingFile = await strapi.query('plugin::upload.file').findOne({
      where: {
        name: pattern,
      },
    });
    
    if (existingFile) {
      return existingFile;
    }
  }
  
  // Look for image file in local folder
  const files = fs.readdirSync(imagesFolder);
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  
  // Find matching file (case-insensitive) - try multiple patterns
  let matchingFile = null;
  
  // Try patterns in order: original ID, converted pattern, and variations
  const allPatterns = [
    shorexId,                    // YNB07
    imagePattern,                // YNB_07
    shorexId.replace(/(\d+)/, '_$1'), // YNB_07 (alternative conversion)
  ];
  
  for (const pattern of allPatterns) {
    matchingFile = files.find(file => {
      const fileName = path.parse(file).name;
      // Remove hash suffix if present (e.g., JED_01_a6f2aaaee0 -> JED_01)
      const baseName = fileName.replace(/_[a-f0-9]+$/i, '');
      const ext = path.extname(file).toLowerCase();
      
      // Check if base name matches pattern (case-insensitive)
      const matches = baseName.toLowerCase() === pattern.toLowerCase() && 
                     imageExtensions.includes(ext);
      
      // Also check if file name starts with pattern (for cases like YNB07_xxx.jpg)
      const startsWith = fileName.toLowerCase().startsWith(pattern.toLowerCase()) &&
                         imageExtensions.includes(ext);
      
      return matches || startsWith;
    });
    
    if (matchingFile) {
      break;
    }
  }
  
  if (!matchingFile) {
    return null;
  }
  
  // Upload the file to Strapi
  try {
    const filePath = path.join(imagesFolder, matchingFile);
    const fileStats = fs.statSync(filePath);
    const ext = path.extname(matchingFile);
    const mimeType = mime.lookup(ext) || 'image/jpeg';
    
    const fileData = {
      filepath: filePath,
      originalFileName: matchingFile,
      size: fileStats.size,
      mimetype: mimeType,
    };
    
    // Use the original shorex ID as the file name in Strapi
    const fileNameWithoutExt = shorexId;
    
    const result = await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        files: fileData,
        data: {
          fileInfo: {
            alternativeText: fileNameWithoutExt,
            caption: fileNameWithoutExt,
            name: fileNameWithoutExt,
          },
        },
      });
    
    return result[0];
  } catch (error) {
    console.log(`  ⚠ Warning: Could not upload image ${matchingFile}: ${error.message}`);
    return null;
  }
}

/**
 * Convert plain text to Markdown format for Strapi richtext Markdown field
 * Converts bullet points (•) to Markdown bullet syntax (- ) so they render properly
 */
function convertToRichText(text) {
  if (!text || !text.trim()) {
    return null;
  }

  // Convert bullet character (•) to Markdown bullet syntax (- )
  // This ensures bullet points render correctly in Strapi's Markdown editor
  const lines = text.split('\n');
  const markdownLines = lines.map(line => {
    // If line starts with bullet character (•), convert to Markdown bullet
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('•')) {
      // Replace • with - and preserve indentation
      const indent = line.match(/^\s*/)[0]; // Get leading whitespace
      return indent + '- ' + trimmedLine.substring(1).trim();
    }
    // Keep other lines as-is
    return line;
  });

  return markdownLines.join('\n');
}

/**
 * Create or get folder in Strapi media library
 */
async function createOrGetFolder(folderName) {
  const existingFolder = await strapi.query('plugin::upload.folder').findOne({
    where: {
      name: folderName,
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

  const folder = await strapi.query('plugin::upload.folder').create({
    data: {
      name: folderName,
      path: `/${folderName}`,
      pathId: nextPathId,
    },
  });

  return folder;
}

/**
 * Check if entry already exists by shorex_code
 */
async function entryExists(shorexId) {
  try {
    // Query all excursions and check if any has matching shorex_code
    const allEntries = await strapi.documents('api::excursion.excursion').findMany({
      locale: 'en',
    });

    // Since we can't filter by component field directly, we need to check each entry
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
    // If query fails, assume it doesn't exist
    return false;
  }
}

/**
 * Create excursion entry in Strapi
 */
async function createExcursionEntry(shorexId, enEntry, arEntry, imageFile) {
  try {
    // Check if entry already exists
    if (await entryExists(shorexId)) {
      return null; // Return null to indicate skipped (don't log here, log in main loop)
    }

    // Prepare media array - Strapi expects file IDs
    const media = imageFile ? [imageFile.id] : [];

    // Create Activity component data
    // Map: name attribute -> name field, title attribute -> short_description, content -> long_description
    const activityData = {
      name: convertToRichText(enEntry.name) || enEntry.name, // name attribute as richtext markdown
      short_description: convertToRichText(enEntry.title) || enEntry.title, // title attribute as richtext markdown
      long_description: convertToRichText(enEntry.description), // content between tags as richtext markdown
      media,
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
      page_slug: enEntry.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
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
      // Map: name attribute -> name field, title attribute -> short_description, content -> long_description
      const arActivityData = {
        name: convertToRichText(arEntry.name) || arEntry.name, // name attribute as richtext markdown
        short_description: convertToRichText(arEntry.title) || arEntry.title, // title attribute as richtext markdown
        long_description: convertToRichText(arEntry.description), // content between tags as richtext markdown
        media, // Same image for both locales
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

      // Generate Arabic slug: preserve Arabic characters, convert spaces to dashes
      // Remove only special characters that aren't valid in URLs, but keep Arabic/English letters and numbers
      const arSlug = arEntry.name
        .trim()
        .replace(/\s+/g, '-') // Replace spaces with dashes
        .replace(/[^\p{L}\p{N}-]/gu, '') // Remove special chars, keep Unicode letters/numbers and dashes
        .replace(/-+/g, '-') // Replace multiple dashes with single dash
        .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
      
      const arEntryData = {
        page_name: arEntry.name,
        page_slug: arSlug || arEntry.name.toLowerCase().replace(/\s+/g, '-'), // Fallback if slug is empty
        excursions: [arExcursionsComponentData],
        publishedAt: new Date().toISOString(),
      };

      // In Strapi v5, localizations share the same documentId - they're the same document with different locales
      // When creating from UI, Strapi uses PUT with the same documentId and different locale
      // We need to create the Arabic entry with the SAME documentId as the English entry
      // IMPORTANT: For components in dynamic zones with i18n, we need to ensure the component data
      // is properly structured for the Arabic locale
      
      // Use PUT (update) method with the English entry's documentId and Arabic locale
      // This creates a localization that shares the same documentId
      // IMPORTANT: When updating with a different locale, we need to ensure the component data
      // is properly structured. The dynamic zone is localized, so each locale maintains its own component data.
      // We should NOT include publishedAt in the update as it might cause issues
      const arUpdateData = {
        page_name: arEntry.name,
        page_slug: arSlug || arEntry.name.toLowerCase().replace(/\s+/g, '-'),
        excursions: [arExcursionsComponentData],
      };
      
      const arUpdateResult = await strapi.documents('api::excursion.excursion').update({
        documentId: enEntryCreated.documentId, // Use the SAME documentId
        data: arUpdateData,
        locale: 'ar', // Create Arabic version
      });
      
      // Verify the update worked and log success
      console.log(`  ✓ Created Arabic localization for ${shorexId} (same documentId: ${enEntryCreated.documentId})`);
    }

    return enEntryCreated;
  } catch (error) {
    // Extract simplified error message
    let errorMsg = error.message || 'Unknown error';
    // Remove verbose details
    if (errorMsg.includes('must be a')) {
      const fieldMatch = errorMsg.match(/(\w+)\[.*?\]\.(\w+)/);
      if (fieldMatch) {
        errorMsg = `${fieldMatch[2]} format error`;
      } else {
        errorMsg = 'Data format error';
      }
    }
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
async function importShorexes(xmlFilePath) {
  console.log('Starting shorex import...\n');

  // Parse XML file
  console.log('Parsing XML file...');
  const entries = parseShorexXML(xmlFilePath);
  console.log(`Found ${entries.length} shorex entries\n`);

  // Group entries by ID
  const groupedEntries = groupEntriesByID(entries);
  const uniqueIds = Object.keys(groupedEntries);
  console.log(`Found ${uniqueIds.length} unique shorex IDs\n`);

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors = [];

  // Process each unique ID
  for (let i = 0; i < uniqueIds.length; i++) {
    const shorexId = uniqueIds[i];
    const entryGroup = groupedEntries[shorexId];
    
    console.log(`[${i + 1}/${uniqueIds.length}] Processing ${shorexId}...`);

    const enEntry = entryGroup.en;
    const arEntry = entryGroup.ar;

    if (!enEntry) {
      console.log(`  ⚠ No English entry found for ${shorexId}, skipping...`);
      skippedCount++;
      continue;
    }

    try {
      // Find matching image
      const imageFile = await findImageByShorexID(shorexId);
      if (imageFile) {
        console.log(`  ✓ Found image: ${imageFile.name}`);
      } else {
        console.log(`  ⚠ No image found for ${shorexId}`);
      }

      // Create entry
      const result = await createExcursionEntry(shorexId, enEntry, arEntry, imageFile);
      if (result === null) {
        console.log(`  ⚠ Skipped (already exists)`);
        skippedCount++;
      } else {
        createdCount++;
      }

      // Small delay to avoid overwhelming the system
      if (i < uniqueIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      errorCount++;
      // Simplify error message - extract main error without full details
      let errorMsg = error.message || 'Unknown error';
      // Remove verbose JSON details from error messages
      if (errorMsg.includes('must be a')) {
        errorMsg = errorMsg.split('must be a')[0] + 'format error';
      }
      // Truncate very long error messages
      if (errorMsg.length > 100) {
        errorMsg = errorMsg.substring(0, 100) + '...';
      }
      errors.push({ shorexId, error: errorMsg });
      console.error(`  ✗ Failed: ${errorMsg}`);
    }

    // Show progress every 10 entries
    if ((i + 1) % 10 === 0 || i === uniqueIds.length - 1) {
      console.log(`Progress: ${i + 1}/${uniqueIds.length} processed\n`);
    }
  }

  // Summary
  console.log('\n=== Import Summary ===');
  console.log(`Total unique IDs: ${uniqueIds.length}`);
  console.log(`Created: ${createdCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(({ shorexId, error }) => {
      console.log(`  - ${shorexId}: ${error}`);
    });
  }

  console.log('\nImport complete!');
}

/**
 * Main execution
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  // Get XML file path from command line or use default
  const xmlFilePath = process.argv[2] || path.join(process.cwd(), 'jease-data', 'dumps', 'shorex-description.xml');

  if (!fs.existsSync(xmlFilePath)) {
    console.error(`Error: XML file not found at ${xmlFilePath}`);
    console.error('Usage: node scripts/import-shorexes.js [xml-file-path]');
    process.exit(1);
  }

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await importShorexes(xmlFilePath);
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

