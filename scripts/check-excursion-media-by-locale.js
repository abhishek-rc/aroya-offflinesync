'use strict';

/**
 * Check if all 409 excursion documents have media for BOTH locales (en and ar).
 * Uses direct DB query - no Strapi boot.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pg = require('pg');

async function main() {
  const client = new pg.Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  // Activities with media
  const withMediaRes = await client.query(
    `SELECT related_id FROM files_related_mph 
     WHERE related_type = 'packages.activity'`
  );
  const activityIdsWithMedia = new Set(withMediaRes.rows.map((r) => r.related_id));

  // Get structure: excursions -> excursions_cmps -> components_packages_excursions
  // components_packages_excursions_cmps -> components_packages_activities
  const exCols = await client.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'excursions'`
  );
  const hasEntityId = exCols.rows.some((c) => c.column_name === 'id');
  const pkCol = hasEntityId ? 'id' : 'document_id';

  // excursions: id, document_id, locale - each row = one document in one locale
  const exRes = await client.query(
    `SELECT id, document_id, locale FROM excursions ORDER BY document_id, locale`
  );

  // excursions_cmps: entity_id = excursions.id (or document_id?), cmp_id = component id
  const exCmpsRes = await client.query(
    `SELECT entity_id, cmp_id, component_type FROM excursions_cmps LIMIT 5`
  );
  console.log('excursions_cmps sample:', exCmpsRes.rows);

  // Check: entity_id in excursions_cmps - does it match excursions.id?
  const firstEx = exRes.rows[0];
  const cmpsForFirst = await client.query(
    `SELECT ec.entity_id, ec.cmp_id, ec.component_type 
     FROM excursions_cmps ec 
     WHERE ec.entity_id = $1`,
    [firstEx?.id]
  );
  console.log('For first excursion (id=' + firstEx?.id + '):', cmpsForFirst.rows);

  // components_packages_excursions_cmps: entity_id = packages_excursions.id, cmp_id = activity.id
  if (cmpsForFirst.rows.length > 0) {
    const exCmpId = cmpsForFirst.rows[0].cmp_id;
    const actCmps = await client.query(
      `SELECT entity_id, cmp_id FROM components_packages_excursions_cmps 
       WHERE entity_id = $1`,
      [exCmpId]
    );
    console.log('Activity for first excursion cmp:', actCmps.rows);
    if (actCmps.rows.length > 0) {
      const actId = actCmps.rows[0].cmp_id;
      const hasMedia = activityIdsWithMedia.has(actId);
      console.log('Activity id', actId, 'has media:', hasMedia);
    }
  }

  // Now: for each (document_id, locale), find all activities and check media
  const docLocales = {};
  for (const row of exRes.rows) {
    const key = row.document_id;
    if (!docLocales[key]) docLocales[key] = { en: null, ar: null };
    docLocales[key][row.locale] = row.id;
  }

  const docsWithoutMediaEn = new Set();
  const docsWithoutMediaAr = new Set();
  const docsMissingAr = new Set();
  const codesWithoutMediaEn = new Set();
  const codesWithoutMediaAr = new Set();

  for (const [docId, locales] of Object.entries(docLocales)) {
    if (!locales.ar) docsMissingAr.add(docId);

    for (const [loc, exId] of Object.entries(locales)) {
      if (!exId) continue;
      const exCmps = await client.query(
        `SELECT cmp_id FROM excursions_cmps WHERE entity_id = $1`,
        [exId]
      );
      for (const ec of exCmps.rows) {
        const actCmps = await client.query(
          `SELECT cmp_id FROM components_packages_excursions_cmps 
           WHERE entity_id = $1`,
          [ec.cmp_id]
        );
        for (const ac of actCmps.rows) {
          const actRow = await client.query(
            `SELECT shorex_code FROM components_packages_activities WHERE id = $1`,
            [ac.cmp_id]
          );
          const code = actRow.rows[0]?.shorex_code;
          if (!activityIdsWithMedia.has(ac.cmp_id)) {
            if (loc === 'en') {
              docsWithoutMediaEn.add(docId);
              if (code) codesWithoutMediaEn.add(code);
            } else {
              docsWithoutMediaAr.add(docId);
              if (code) codesWithoutMediaAr.add(code);
            }
          }
        }
      }
    }
  }

  const docsWithEn = Object.entries(docLocales).filter(([, l]) => l.en).length;
  const docsWithAr = Object.entries(docLocales).filter(([, l]) => l.ar).length;

  console.log('\n=== Excursion Media Status (Both Locales) ===\n');
  console.log('Total documents (EN):', docsWithEn);
  console.log('Total documents (AR):', docsWithAr);
  console.log('Documents EN only (no AR):', docsMissingAr.size, docsMissingAr.size ? '- doc IDs: ' + [...docsMissingAr].slice(0, 5).join(', ') : '');
  console.log('');
  console.log('Documents WITHOUT media (EN):', docsWithoutMediaEn.size);
  console.log('Documents WITHOUT media (AR):', docsWithoutMediaAr.size);
  console.log('');
  console.log('Codes without media (EN):', [...codesWithoutMediaEn].sort().join(', ') || 'none');
  console.log('Codes without media (AR):', [...codesWithoutMediaAr].sort().join(', ') || 'none');
  console.log('');

  const allWithMediaEn = docsWithEn - docsWithoutMediaEn.size;
  const allWithMediaAr = docsWithAr - docsWithoutMediaAr.size;
  console.log('Documents WITH media for ALL activities (EN):', allWithMediaEn);
  console.log('Documents WITH media for ALL activities (AR):', allWithMediaAr);

  const outFile = path.join(__dirname, '..', 'excursion-media-by-locale.txt');
  fs.writeFileSync(outFile, [
    'Excursion Media Status by Locale',
    '================================',
    'EN: ' + allWithMediaEn + '/' + docsWithEn + ' documents have media for all activities',
    'AR: ' + allWithMediaAr + '/' + docsWithAr + ' documents have media for all activities',
    'Documents missing media (EN): ' + docsWithoutMediaEn.size,
    'Documents missing media (AR): ' + docsWithoutMediaAr.size,
    'Codes without media (EN): ' + [...codesWithoutMediaEn].sort().join(', '),
    'Codes without media (AR): ' + [...codesWithoutMediaAr].sort().join(', '),
    'Documents with EN only (no AR): ' + docsMissingAr.size,
  ].join('\n'), 'utf-8');
  console.log('\nSaved to:', outFile);

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
