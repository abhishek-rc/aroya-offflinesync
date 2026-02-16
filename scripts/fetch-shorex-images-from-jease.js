'use strict';

/**
 * Fetch shorex images from Jease URL and save to jease-data/shorex-images
 * Only downloads images that do NOT already exist in CMS (shorexes folder).
 *
 * Usage:
 *   node scripts/fetch-shorex-images-from-jease.js
 *     - Fetches images for excursions with empty media
 *
 *   node scripts/fetch-shorex-images-from-jease.js --from-xml
 *     - Fetches all codes from XML, but skips those already in CMS
 *
 *   node scripts/fetch-shorex-images-from-jease.js --codes JAS08,AUH91A,DXB04,...
 *     - Fetches only the specified codes (comma-separated)
 *
 * Skips: (1) images already in CMS shorexes folder, (2) images already in local folder
 * URL: https://uat.booking.aroya.com/jease/ary/images/shorexes/{CODE}
 * Output: jease-data/shorex-images/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const JEASE_BASE_URL = 'https://uat.booking.aroya.com/jease/ary/images/shorexes';
const OUTPUT_FOLDER = path.join(__dirname, '..', 'jease-data', 'shorex-images');
const XML_FILE = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/**
 * Fetch image from URL, returns { buffer, contentType } or null
 */
function fetchImage(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        resolve({ buffer, contentType });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Get file extension from content-type
 */
function getExtensionFromContentType(contentType) {
  if (!contentType) return '.jpg';
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}

/**
 * Download image for a shorex code from Jease
 * Tries: code, then pattern (e.g. DOH_11IF), with .jpg, .png, .webp
 */
async function downloadShorexImage(shorexCode) {
  const pattern = convertIDToImagePattern(shorexCode);
  const variants = [shorexCode];
  if (pattern !== shorexCode) variants.push(pattern);

  for (const variant of variants) {
    const urlsToTry = [
      `${JEASE_BASE_URL}/${variant}`,
      `${JEASE_BASE_URL}/${variant}.jpg`,
      `${JEASE_BASE_URL}/${variant}.jpeg`,
      `${JEASE_BASE_URL}/${variant}.png`,
      `${JEASE_BASE_URL}/${variant}.webp`,
    ];

    for (const url of urlsToTry) {
      const result = await fetchImage(url);
      if (result && result.buffer && result.buffer.length > 1000) {
        let ext = getExtensionFromContentType(result.contentType);
        const extMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i);
        if (extMatch) ext = '.' + extMatch[1].toLowerCase();
        return { buffer: result.buffer, ext, savedAs: shorexCode };
      }
    }
  }
  return null;
}

/**
 * Convert shorex ID to image pattern (e.g. AQB01 -> AQB_01, DOH11IF -> DOH_11IF)
 */
function convertIDToImagePattern(shorexId) {
  const match = shorexId.match(/^([A-Z]{3})(\d+)([A-Z]*)$/);
  if (match) {
    return `${match[1]}_${match[2]}${match[3] || ''}`;
  }
  return shorexId;
}

/**
 * Parse --codes JAS08,AUH91A,DXB04 from argv
 */
function getCodesFromArgv() {
  const idx = process.argv.indexOf('--codes');
  if (idx === -1 || !process.argv[idx + 1]) return null;
  return process.argv[idx + 1]
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Check if image exists in CMS (by code or converted pattern)
 */
function existsInCms(code, cmsNames) {
  const codeLower = code.toLowerCase();
  const patternLower = convertIDToImagePattern(code).toLowerCase();
  return cmsNames.has(codeLower) || cmsNames.has(patternLower);
}

/**
 * Get shorex codes from XML file
 */
function getShorexCodesFromXML() {
  const xmlContent = fs.readFileSync(XML_FILE, 'utf-8');
  const ids = new Set();
  const shorexPattern = /<shorex:([A-Z0-9]+)\s+[^>]+>/g;
  let match;
  while ((match = shorexPattern.exec(xmlContent)) !== null) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

/**
 * Get image names that already exist in CMS (shorexes folder)
 */
async function getCmsShorexImageNames() {
  const folder = await strapi.query('plugin::upload.folder').findOne({
    where: { name: 'shorexes', parent: null },
  });
  if (!folder) return new Set();

  const files = await strapi.query('plugin::upload.file').findMany({
    where: { folder: folder.id },
  });
  const names = new Set(files.map((f) => (f.name || '').toLowerCase().trim()).filter(Boolean));
  return names;
}

/**
 * Get shorex codes from CMS that have empty media
 */
async function getShorexCodesWithEmptyMedia() {
  const entries = await strapi.documents('api::excursion.excursion').findMany({
    locale: 'en',
    populate: '*',
  });

  const codesWithEmptyMedia = new Set();

  for (const entry of entries) {
    if (!entry.excursions || !Array.isArray(entry.excursions)) continue;

    for (const excursion of entry.excursions) {
      if (excursion.__component !== 'packages.excursions' || !excursion.Activity) continue;

      const shorexCode = excursion.Activity.shorex_code;
      if (!shorexCode) continue;

      const media = excursion.Activity.media;
      const isEmpty = !media || !Array.isArray(media) || media.length === 0;

      if (isEmpty) {
        codesWithEmptyMedia.add(shorexCode);
      }
    }
  }

  return [...codesWithEmptyMedia].sort();
}

async function main() {
  const useXml = process.argv.includes('--from-xml');
  const codesArg = getCodesFromArgv();

  console.log('=== Fetch Shorex Images from Jease ===\n');

  // Create output folder
  if (!fs.existsSync(OUTPUT_FOLDER)) {
    fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
    console.log(`Created folder: ${OUTPUT_FOLDER}\n`);
  } else {
    console.log(`Output folder: ${OUTPUT_FOLDER}\n`);
  }

  let codesToFetch;
  let app = null;

  if (codesArg && codesArg.length > 0) {
    codesToFetch = codesArg;
    console.log(`Step 1: Using ${codesToFetch.length} codes from --codes argument\n`);
  } else {
    // Initialize Strapi (needed to check which images exist in CMS)
    const { createStrapi, compileStrapi } = require('@strapi/strapi');
    const appContext = await compileStrapi();
    app = await createStrapi(appContext).load();
    app.log.level = 'error';

    console.log('Step 1: Loading image names from CMS (shorexes folder)...');
    const cmsImageNames = await getCmsShorexImageNames();
    console.log(`  Found ${cmsImageNames.size} images already in CMS\n`);

    if (useXml) {
      const allCodes = getShorexCodesFromXML();
      codesToFetch = allCodes.filter((code) => !existsInCms(code, cmsImageNames));
      console.log(`Step 2: Filtered to ${codesToFetch.length} codes not in CMS (skipped ${allCodes.length - codesToFetch.length})\n`);
    } else {
      console.log('Step 2: Finding excursions with empty media...');
      codesToFetch = await getShorexCodesWithEmptyMedia();
      codesToFetch = codesToFetch.filter((code) => !existsInCms(code, cmsImageNames));
      console.log(`  Found ${codesToFetch.length} shorex codes to fetch (excluding those already in CMS)\n`);
    }
  }

  if (codesToFetch.length === 0) {
    console.log('No codes to fetch.');
    if (app) await app.destroy();
    process.exit(0);
    return;
  }

  // Download images
  console.log('Step 3: Downloading images from Jease...\n');
  let downloaded = 0;
  let skippedLocal = 0;
  let failed = 0;
  const failedCodes = [];

  for (let i = 0; i < codesToFetch.length; i++) {
    const code = codesToFetch[i];
    const pattern = convertIDToImagePattern(code);

    // Skip if already exists in local folder (by code or pattern)
    const existingFile = IMAGE_EXTENSIONS.flatMap((ext) => [
      path.join(OUTPUT_FOLDER, `${code}${ext}`),
      pattern !== code ? path.join(OUTPUT_FOLDER, `${pattern}${ext}`) : null,
    ])
      .filter(Boolean)
      .find((p) => fs.existsSync(p));

    if (existingFile) {
      console.log(`  [${i + 1}/${codesToFetch.length}] ⊘ ${code}: Already in folder`);
      skippedLocal++;
      continue;
    }

    const result = await downloadShorexImage(code);

    if (result) {
      const ext = result.ext.startsWith('.') ? result.ext : `.${result.ext}`;
      const filePath = path.join(OUTPUT_FOLDER, `${code}${ext}`);
      fs.writeFileSync(filePath, result.buffer);
      console.log(`  [${i + 1}/${codesToFetch.length}] ✓ ${code}: Downloaded (${(result.buffer.length / 1024).toFixed(1)} KB)`);
      downloaded++;
    } else {
      console.log(`  [${i + 1}/${codesToFetch.length}] ✗ ${code}: Not found`);
      failed++;
      failedCodes.push(code);
    }

    // Small delay to avoid overwhelming the server
    if (i < codesToFetch.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped (already in folder): ${skippedLocal}`);
  console.log(`Failed: ${failed}`);
  console.log(`(Images already in CMS were not downloaded)`);
  if (failedCodes.length > 0 && failedCodes.length <= 30) {
    console.log(`\nFailed codes: ${failedCodes.join(', ')}`);
  } else if (failedCodes.length > 0) {
    console.log(`\nFirst 30 failed codes: ${failedCodes.slice(0, 30).join(', ')}`);
    console.log(`  ... and ${failedCodes.length - 30} more`);
  }
  console.log(`\nImages saved to: ${OUTPUT_FOLDER}`);

  if (app) await app.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
