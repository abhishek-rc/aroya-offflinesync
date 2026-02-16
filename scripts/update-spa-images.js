'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Script to link spa images from Media Library to spa entries
 * 
 * Images are stored in "spas" folder in Strapi Media Library
 * Image filenames contain the treatment code (e.g., "1002428.jpg" or "1002428_1.jpg")
 * This script matches images by code and updates the activity_media field in both en and ar locales
 */

/**
 * Get the "spas" folder from Media Library
 */
async function getSpasFolder() {
  const folder = await strapi.query('plugin::upload.folder').findOne({
    where: {
      name: 'spas',
    },
  });

  if (!folder) {
    // Try case-insensitive search
    const allFolders = await strapi.query('plugin::upload.folder').findMany();
    const spasFolder = allFolders.find(f => f.name.toLowerCase() === 'spas');
    return spasFolder || null;
  }

  return folder;
}

/**
 * Get all images from the spas folder
 */
async function getSpasImages(folderId) {
  const images = await strapi.query('plugin::upload.file').findMany({
    where: {
      folder: folderId,
    },
  });

  return images;
}

/**
 * Extract treatment code from image filename
 * Handles formats like: "1002428.jpg", "1002428_1.jpg", "1002428-hero.jpg"
 */
function extractCodeFromFilename(filename) {
  if (!filename) return null;
  
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  
  // Extract the code (first numeric sequence)
  const match = nameWithoutExt.match(/^(\d+)/);
  return match ? match[1] : null;
}

/**
 * Group images by treatment code
 */
function groupImagesByCode(images) {
  const grouped = {};

  for (const image of images) {
    const code = extractCodeFromFilename(image.name);
    if (code) {
      if (!grouped[code]) {
        grouped[code] = [];
      }
      grouped[code].push(image);
    } else {
      console.log(`  ⚠ Could not extract code from: ${image.name}`);
    }
  }

  return grouped;
}

/**
 * Get all spa entries with their components
 * Note: For dynamic zones, we must use populate: '*' (Strapi v5 limitation)
 */
async function getAllSpaEntries(locale) {
  const entries = await strapi.documents('api::spa.spa').findMany({
    locale: locale,
    populate: '*', // Use '*' for dynamic zones - nested populate not supported
  });

  return entries;
}

/**
 * Update spa entry with images
 */
async function updateSpaWithImages(documentId, locale, imageIds, existingComponents) {
  try {
    // Prepare components data with updated activity_media
    const updatedComponents = existingComponents.map(component => {
      if (component.__component === 'activity.spa-and-wellness') {
        return {
          __component: 'activity.spa-and-wellness',
          description: component.description,
          treatment_type: component.treatment_type,
          duration: component.duration,
          activity_media: imageIds, // Array of image IDs
        };
      }
      return component;
    });

    // Update the entry
    await strapi.documents('api::spa.spa').update({
      documentId: documentId,
      locale: locale,
      data: {
        components: updatedComponents,
      },
    });

    return true;
  } catch (error) {
    console.error(`  ✗ Error updating ${documentId} (${locale}):`, error.message);
    return false;
  }
}

/**
 * Main import function
 */
async function updateSpaImages() {
  console.log('Starting spa images update...\n');

  // Step 1: Get spas folder
  console.log('Step 1: Finding "spas" folder in Media Library...');
  const spasFolder = await getSpasFolder();

  if (!spasFolder) {
    console.error('Error: "spas" folder not found in Media Library');
    console.log('Please create a folder named "spas" and upload the spa images there.');
    return;
  }
  console.log(`  ✓ Found folder: ${spasFolder.name} (ID: ${spasFolder.id})\n`);

  // Step 2: Get all images from spas folder
  console.log('Step 2: Fetching images from spas folder...');
  const images = await getSpasImages(spasFolder.id);
  console.log(`  ✓ Found ${images.length} images\n`);

  if (images.length === 0) {
    console.log('No images found in spas folder. Please upload images first.');
    return;
  }

  // Step 3: Group images by treatment code
  console.log('Step 3: Grouping images by treatment code...');
  const imagesByCode = groupImagesByCode(images);
  const uniqueCodes = Object.keys(imagesByCode);
  console.log(`  ✓ Found images for ${uniqueCodes.length} unique treatment codes\n`);

  // Step 4: Get all spa entries for English
  console.log('Step 4: Fetching spa entries...');
  const enEntries = await getAllSpaEntries('en');
  console.log(`  ✓ Found ${enEntries.length} English spa entries\n`);

  // Step 5: Match and update entries
  console.log('Step 5: Updating spa entries with images...\n');

  let updatedEnCount = 0;
  let updatedArCount = 0;
  let skippedCount = 0;
  let noImagesCount = 0;
  const errors = [];

  for (let i = 0; i < enEntries.length; i++) {
    const entry = enEntries[i];
    const code = entry.code;

    if (!code) {
      console.log(`  ⚠ Entry ${entry.documentId} has no code, skipping...`);
      skippedCount++;
      continue;
    }

    const matchingImages = imagesByCode[code];

    if (!matchingImages || matchingImages.length === 0) {
      // No images for this code
      noImagesCount++;
      continue;
    }

    console.log(`[${i + 1}/${enEntries.length}] Processing ${code} - ${entry.page_name}...`);
    console.log(`  Found ${matchingImages.length} image(s)`);

    // Get image IDs
    const imageIds = matchingImages.map(img => img.id);

    // Update English entry
    const enSuccess = await updateSpaWithImages(
      entry.documentId,
      'en',
      imageIds,
      entry.components || []
    );

    if (enSuccess) {
      console.log(`  ✓ Updated English entry`);
      updatedEnCount++;
    } else {
      errors.push({ code, locale: 'en', error: 'Update failed' });
    }

    // Update Arabic entry (same documentId, different locale)
    try {
      // Fetch Arabic entry to get its components
      const arEntry = await strapi.documents('api::spa.spa').findOne({
        documentId: entry.documentId,
        locale: 'ar',
        populate: '*', // Use '*' for dynamic zones - nested populate not supported
      });

      if (arEntry) {
        const arSuccess = await updateSpaWithImages(
          entry.documentId,
          'ar',
          imageIds,
          arEntry.components || []
        );

        if (arSuccess) {
          console.log(`  ✓ Updated Arabic entry`);
          updatedArCount++;
        } else {
          errors.push({ code, locale: 'ar', error: 'Update failed' });
        }
      } else {
        console.log(`  ⚠ No Arabic localization found for ${code}`);
      }
    } catch (error) {
      console.log(`  ⚠ Error fetching Arabic entry: ${error.message}`);
      errors.push({ code, locale: 'ar', error: error.message });
    }

    // Small delay to avoid overwhelming the system
    if (i < enEntries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Show progress every 20 entries
    if ((i + 1) % 20 === 0) {
      console.log(`\nProgress: ${i + 1}/${enEntries.length} processed\n`);
    }
  }

  // Summary
  console.log('\n=== Update Summary ===');
  console.log(`Total spa entries: ${enEntries.length}`);
  console.log(`English entries updated: ${updatedEnCount}`);
  console.log(`Arabic entries updated: ${updatedArCount}`);
  console.log(`Skipped (no code): ${skippedCount}`);
  console.log(`No matching images: ${noImagesCount}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(({ code, locale, error }) => {
      console.log(`  - ${code} (${locale}): ${error}`);
    });
  }

  // Show codes with images but no matching spa entry
  const entryCodes = new Set(enEntries.map(e => e.code).filter(Boolean));
  const unmatchedImageCodes = uniqueCodes.filter(code => !entryCodes.has(code));
  
  if (unmatchedImageCodes.length > 0) {
    console.log(`\n⚠ ${unmatchedImageCodes.length} image code(s) have no matching spa entry:`);
    unmatchedImageCodes.slice(0, 10).forEach(code => {
      console.log(`  - ${code} (${imagesByCode[code].length} image(s))`);
    });
    if (unmatchedImageCodes.length > 10) {
      console.log(`  ... and ${unmatchedImageCodes.length - 10} more`);
    }
  }

  console.log('\nUpdate complete!');
}

/**
 * Main execution
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await updateSpaImages();
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
