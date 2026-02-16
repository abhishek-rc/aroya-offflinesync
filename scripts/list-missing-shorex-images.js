'use strict';

/**
 * List excursion shorex codes that have NO matching image in the shorexes folder.
 *
 * Usage:
 *   node scripts/list-missing-shorex-images.js --from-xml   (fast; uses XML + local shorex-images folder)
 *   node scripts/list-missing-shorex-images.js --cms        (uses XML codes + Strapi CMS shorexes folder via DB)
 *   node scripts/list-missing-shorex-images.js              (full Strapi boot; uses CMS excursions + shorexes)
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const FROM_XML = process.argv.includes('--from-xml');
const FROM_CMS_DB = process.argv.includes('--cms');

function convertIDToImagePattern(shorexId) {
  const match = shorexId.match(/^([A-Z]{3})(\d+)([A-Z]*)$/);
  if (match) return match[1] + '_' + match[2] + (match[3] || '');
  return shorexId;
}

function findImageForCode(code, imageMap) {
  const codeLower = code.toLowerCase();
  const patternLower = convertIDToImagePattern(code).toLowerCase();
  let img = imageMap.get(codeLower) || imageMap.get(patternLower);
  if (img) return img;
  for (const [name, candidate] of imageMap) {
    const nameNoExt = name.replace(/\.[^.]+$/, '').toLowerCase();
    if (
      nameNoExt === codeLower ||
      nameNoExt === patternLower ||
      nameNoExt.startsWith(codeLower + '_') ||
      nameNoExt.startsWith(codeLower + '-') ||
      nameNoExt.startsWith(patternLower + '_') ||
      nameNoExt.startsWith(patternLower + '-')
    )
      return candidate;
  }
  return null;
}

/** Extract unique shorex codes from shorex-description.xml */
function getCodesFromXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const codes = new Set();
  const re = /<shorex:([A-Z0-9]+)\s/g;
  let m;
  while ((m = re.exec(xml)) !== null) codes.add(m[1]);
  return codes;
}

/** Build image map from local folder (filename -> true) */
function getImageMapFromFolder(folderPath) {
  const map = new Map();
  if (!fs.existsSync(folderPath)) return map;
  for (const f of fs.readdirSync(folderPath)) {
    const name = (f || '').trim().toLowerCase();
    if (name && !map.has(name)) map.set(name, true);
  }
  return map;
}

async function mainFromXml() {
  const xmlPath = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');
  const shorexImagesPath = path.join(__dirname, '..', 'jease-data', 'shorex-images');

  if (!fs.existsSync(xmlPath)) {
    console.error('XML not found:', xmlPath);
    process.exit(1);
  }

  const codes = getCodesFromXml(xmlPath);
  const imageMap = getImageMapFromFolder(shorexImagesPath);

  const missing = [];
  for (const code of codes) {
    if (!findImageForCode(code, imageMap)) missing.push(code);
  }

  console.log('=== Missing Images (from XML excursion codes) ===\n');
  console.log('Source: shorex-description.xml');
  console.log('Image folder: jease-data/shorex-images');
  console.log('');
  console.log('Excursion codes (total):', codes.size);
  console.log('Images in shorex-images folder:', imageMap.size);
  console.log('Codes WITH image:', codes.size - missing.length);
  console.log('Codes WITHOUT image:', missing.length);
  console.log('');
  console.log('Missing codes (alphabetical):');
  missing.sort().forEach((c, i) => {
    process.stdout.write(c + (i % 10 === 9 ? '\n' : ', '));
  });
  if (missing.length % 10 !== 0) console.log('');

  const outFile = path.join(__dirname, '..', 'missing-shorex-images.txt');
  fs.writeFileSync(outFile, missing.join('\n'), 'utf-8');
  console.log('\nSaved to:', outFile);
}

/** Query Strapi DB directly for shorexes folder images (no Strapi boot) */
async function mainFromCmsDb() {
  const pg = require('pg');
  const xmlPath = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');

  if (!fs.existsSync(xmlPath)) {
    console.error('XML not found:', xmlPath);
    process.exit(1);
  }

  const codes = getCodesFromXml(xmlPath);

  const client = new pg.Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  let imageNames = [];
  try {
    const folderRes = await client.query(
      `SELECT id FROM upload_folders WHERE LOWER(name) = 'shorexes' LIMIT 1`
    );
    if (folderRes.rows.length === 0) {
      console.error('Shorexes folder not found in Strapi CMS.');
      await client.end();
      process.exit(1);
    }
    const folderId = folderRes.rows[0].id;

    const filesRes = await client.query(
      `SELECT f.name FROM files f
       JOIN files_folder_lnk fl ON f.id = fl.file_id
       WHERE fl.folder_id = $1`,
      [folderId]
    );
    imageNames = filesRes.rows.map((r) => (r.name || '').trim()).filter(Boolean);
  } catch (err) {
    console.error('DB error:', err.message);
    await client.end();
    process.exit(1);
  }
  await client.end();

  const imageMap = new Map();
  for (const name of imageNames) {
    const key = name.toLowerCase();
    if (!imageMap.has(key)) imageMap.set(key, true);
  }

  const missing = [];
  for (const code of codes) {
    if (!findImageForCode(code, imageMap)) missing.push(code);
  }

  console.log('=== Missing Images (Strapi CMS shorexes folder) ===\n');
  console.log('Source: shorex-description.xml (excursion codes)');
  console.log('Image folder: Strapi Media Library "shorexes"');
  console.log('');
  console.log('Excursion codes (total):', codes.size);
  console.log('Images in shorexes folder:', imageMap.size);
  console.log('Codes WITH image:', codes.size - missing.length);
  console.log('Codes WITHOUT image:', missing.length);
  console.log('');
  console.log('Missing codes (alphabetical):');
  missing.sort().forEach((c, i) => {
    process.stdout.write(c + (i % 10 === 9 ? '\n' : ', '));
  });
  if (missing.length % 10 !== 0) console.log('');

  const outFile = path.join(__dirname, '..', 'missing-shorex-images.txt');
  fs.writeFileSync(outFile, missing.join('\n'), 'utf-8');
  console.log('\nSaved to:', outFile);
}

async function main() {
  if (FROM_XML) {
    await mainFromXml();
    process.exit(0);
    return;
  }
  if (FROM_CMS_DB) {
    await mainFromCmsDb();
    process.exit(0);
    return;
  }

  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const ctx = await compileStrapi();
  const app = await createStrapi(ctx).load();
  app.log.level = 'error';

  const folder =
    (await strapi.query('plugin::upload.folder').findOne({ where: { name: 'shorexes', parent: null } })) ||
    (await strapi.query('plugin::upload.folder').findMany()).find((f) => f.name.toLowerCase() === 'shorexes');

  if (!folder) {
    console.log('Shorexes folder not found');
    await app.destroy();
    process.exit(1);
  }

  const images = await strapi.query('plugin::upload.file').findMany({ where: { folder: folder.id } });
  const imageMap = new Map();
  for (const img of images) {
    const name = (img.name || '').trim().toLowerCase();
    if (name && !imageMap.has(name)) imageMap.set(name, img);
  }

  const entries = await strapi.documents('api::excursion.excursion').findMany({
    locale: 'en',
    populate: { excursions: { on: { 'packages.excursions': { populate: ['Activity'] } } } },
  });

  const codes = new Set();
  for (const e of entries) {
    if (e.excursions && Array.isArray(e.excursions)) {
      for (const x of e.excursions) {
        if (x.__component === 'packages.excursions' && x.Activity?.shorex_code) codes.add(x.Activity.shorex_code);
      }
    }
  }

  const missing = [];
  for (const code of codes) {
    if (!findImageForCode(code, imageMap)) missing.push(code);
  }

  await app.destroy();

  console.log('=== Missing Images in shorexes folder ===\n');
  console.log('Excursion codes (total):', codes.size);
  console.log('Images in shorexes folder:', images.length);
  console.log('Codes WITH image:', codes.size - missing.length);
  console.log('Codes WITHOUT image:', missing.length);
  console.log('');
  console.log('Missing codes (alphabetical):');
  missing.sort().forEach((c, i) => {
    process.stdout.write(c + (i % 10 === 9 ? '\n' : ', '));
  });
  if (missing.length % 10 !== 0) console.log('');

  const outFile = path.join(__dirname, '..', 'missing-shorex-images.txt');
  fs.writeFileSync(outFile, missing.join('\n'), 'utf-8');
  console.log('\nSaved to:', outFile);

  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
