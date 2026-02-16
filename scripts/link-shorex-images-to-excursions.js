'use strict';

/**
 * Link images from "shorexes" Media Library folder to Booking Journey excursion entries.
 * Target: api::excursion.excursion (Booking Journey - Excursions)
 * Matches by shorex_code (e.g., AQB01) - searches for image with that name in shorexes folder.
 * Updates both en and ar locales. Only updates entries where Activity.media is empty.
 *
 * Usage: node scripts/link-shorex-images-to-excursions.js
 */

function convertIDToImagePattern(shorexId) {
  const match = shorexId.match(/^([A-Z]{3})(\d+)([A-Z]?)$/);
  if (match) {
    return `${match[1]}_${match[2]}${match[3] || ''}`;
  }
  return shorexId;
}

async function getShorexesFolder() {
  const folder = await strapi.query('plugin::upload.folder').findOne({
    where: { name: 'shorexes', parent: null },
  });
  if (!folder) {
    const all = await strapi.query('plugin::upload.folder').findMany();
    return all.find((f) => f.name.toLowerCase() === 'shorexes') || null;
  }
  return folder;
}

async function getShorexesImages(folderId) {
  return strapi.query('plugin::upload.file').findMany({
    where: { folder: folderId },
  });
}

function buildImageMapByCode(images) {
  const map = new Map();
  for (const img of images) {
    const name = (img.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, img);
  }
  return map;
}

/**
 * Match image by shorex code. Handles:
 * - Exact: AQB01, AQB_01
 * - With hash suffix: AQB01_abc123, AQB01-xyz789, AQB_01_abc123
 */
function findImageForCode(code, imageMap) {
  const codeLower = code.toLowerCase();
  const patternLower = convertIDToImagePattern(code).toLowerCase();

  // 1. Exact match
  let img = imageMap.get(codeLower) || imageMap.get(patternLower);
  if (img) return img;

  // 2. Name starts with code or pattern (handles hash suffix like AQB01_abc123)
  for (const [name, candidate] of imageMap) {
    const nameNoExt = name.replace(/\.[^.]+$/, '').toLowerCase();
    if (
      nameNoExt === codeLower ||
      nameNoExt === patternLower ||
      nameNoExt.startsWith(codeLower + '_') ||
      nameNoExt.startsWith(codeLower + '-') ||
      nameNoExt.startsWith(patternLower + '_') ||
      nameNoExt.startsWith(patternLower + '-')
    ) {
      return candidate;
    }
  }
  return null;
}

async function getExcursionEntries(locale) {
  return strapi.documents('api::excursion.excursion').findMany({
    locale,
    populate: {
      excursions: {
        on: {
          'packages.excursions': {
            populate: {
              Activity: {
                populate: ['media'],
              },
            },
          },
        },
      },
    },
  });
}

async function main() {
  console.log('=== Link Shorex Images to Excursions ===\n');

  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  console.log('Step 1: Loading shorexes folder...');
  const folder = await getShorexesFolder();
  if (!folder) {
    console.error('Error: "shorexes" folder not found in Media Library');
    await app.destroy();
    process.exit(1);
  }
  console.log(`  ✓ Found: ${folder.name}\n`);

  console.log('Step 2: Loading images...');
  const images = await getShorexesImages(folder.id);
  const imageMap = buildImageMapByCode(images);
  console.log(`  ✓ Found ${images.length} images\n`);

  if (images.length === 0) {
    console.log('No images in shorexes folder. Nothing to link.');
    await app.destroy();
    process.exit(0);
    return;
  }

  console.log('Step 3: Finding excursions with empty media...');
  const enEntries = await getExcursionEntries('en');
  const debug = process.argv.includes('--debug');

  if (debug && enEntries.length > 0) {
    const sample = enEntries[0];
    const firstExcursion = sample.excursions?.[0];
    console.log('  [DEBUG] Sample entry structure:');
    console.log('  - documentId:', sample.documentId);
    console.log('  - excursions count:', sample.excursions?.length ?? 0);
    if (firstExcursion) {
      console.log('  - first excursion __component:', firstExcursion.__component);
      console.log('  - first excursion has Activity:', !!firstExcursion.Activity);
      if (firstExcursion.Activity) {
        console.log('  - first excursion Activity.shorex_code:', firstExcursion.Activity.shorex_code);
        console.log('  - first excursion Activity.media:', JSON.stringify(firstExcursion.Activity.media));
        console.log('  - first excursion Activity.media type:', typeof firstExcursion.Activity.media);
      }
    }
    console.log('');
  }

  let totalExcursions = 0;
  let withActivity = 0;
  let withEmptyMedia = 0;
  let withMatchingImage = 0;
  const codesWithoutImage = new Set();

  const toUpdate = [];
  for (const entry of enEntries) {
    if (!entry.excursions || !Array.isArray(entry.excursions)) continue;

    let hasUpdates = false;
    const updatedExcursions = entry.excursions.map((excursion) => {
      if (excursion.__component !== 'packages.excursions') return excursion;

      totalExcursions++;

      const activity = excursion.Activity;
      if (!activity) {
        if (debug) console.log('  Debug: excursion has no Activity');
        return excursion;
      }
      withActivity++;

      const code = activity.shorex_code;
      if (!code) return excursion;

      const media = activity.media;
      const isEmpty = media == null || (Array.isArray(media) && media.length === 0);
      if (!isEmpty) return excursion;

      withEmptyMedia++;

      const image = findImageForCode(code, imageMap);
      if (!image) {
        codesWithoutImage.add(code);
        if (debug) console.log(`  Debug: no image for code ${code}`);
        return excursion;
      }
      withMatchingImage++;

      hasUpdates = true;
      return {
        ...excursion,
        Activity: { ...excursion.Activity, media: [image.id] },
      };
    });

    if (hasUpdates) {
      toUpdate.push({
        documentId: entry.documentId,
        codes: entry.excursions
          .filter((e) => e.__component === 'packages.excursions' && e.Activity?.shorex_code)
          .map((e) => e.Activity.shorex_code)
          .filter((c) => findImageForCode(c, imageMap))
          .join(', '),
        enExcursions: updatedExcursions,
      });
    }
  }

  console.log(`  Total entries: ${enEntries.length}`);
  console.log(`  Excursions with Activity: ${withActivity}`);
  console.log(`  With empty media: ${withEmptyMedia}`);
  console.log(`  With matching image in shorexes: ${withMatchingImage}`);
  console.log(`  To update: ${toUpdate.length}\n`);

  if (codesWithoutImage.size > 0) {
    const missing = [...codesWithoutImage].sort();
    console.log('=== Codes WITHOUT image in shorexes folder ===\n');
    console.log(missing.join(', '));
    console.log('\n');
  }

  if (toUpdate.length === 0) {
    if (withEmptyMedia > 0 && withMatchingImage === 0) {
      console.log('Excursions with empty media found, but no matching images in shorexes folder.');
      console.log('Check that image names in shorexes folder match shorex_code (e.g. AQB01.jpg)');
    } else if (withEmptyMedia === 0) {
      console.log('No excursions with empty media found.');
    }
    await app.destroy();
    process.exit(0);
    return;
  }

  console.log('Step 4: Updating entries (en + ar)...\n');

  let updatedEn = 0;
  let updatedAr = 0;
  let errors = 0;

  for (let i = 0; i < toUpdate.length; i++) {
    const { documentId, codes, enExcursions } = toUpdate[i];

    try {
      await strapi.documents('api::excursion.excursion').update({
        documentId,
        locale: 'en',
        data: { excursions: enExcursions },
      });
      updatedEn++;
      console.log(`  [${i + 1}/${toUpdate.length}] ✓ ${codes}: Updated EN`);

      const arEntry = await strapi.documents('api::excursion.excursion').findOne({
        documentId,
        locale: 'ar',
        populate: '*',
      });

      if (arEntry && arEntry.excursions) {
        const arExcursions = arEntry.excursions.map((exc) => {
          if (exc.__component !== 'packages.excursions' || !exc.Activity) return exc;
          const code = exc.Activity.shorex_code;
          const media = exc.Activity.media;
          const isEmpty = !media || !Array.isArray(media) || media.length === 0;
          if (!isEmpty || !code) return exc;

          const image = findImageForCode(code, imageMap);
          if (!image) return exc;

          return {
            ...exc,
            Activity: { ...exc.Activity, media: [image.id] },
          };
        });
        await strapi.documents('api::excursion.excursion').update({
          documentId,
          locale: 'ar',
          data: { excursions: arExcursions },
        });
        updatedAr++;
        console.log(`  [${i + 1}/${toUpdate.length}] ✓ ${codes}: Updated AR`);
      }

      if (i < toUpdate.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.error(`  [${i + 1}/${toUpdate.length}] ✗ ${codes}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Updated EN: ${updatedEn}`);
  console.log(`Updated AR: ${updatedAr}`);
  console.log(`Errors: ${errors}`);

  await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
