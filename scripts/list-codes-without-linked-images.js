'use strict';

/**
 * List excursion codes that do NOT have an image linked to Activity.media.
 * Uses direct DB query - no Strapi boot.
 *
 * Output: codes where Activity has no media linked (from files_related_mph).
 *
 * Usage: node scripts/list-codes-without-linked-images.js
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

  const withMedia = await client.query(
    `SELECT DISTINCT related_id FROM files_related_mph WHERE related_type = 'packages.activity'`
  );
  const activitiesWithMedia = new Set(withMedia.rows.map((r) => r.related_id));

  const allActivities = await client.query(
    `SELECT id, shorex_code FROM components_packages_activities WHERE shorex_code IS NOT NULL AND shorex_code != ''`
  );

  const codesWithoutMedia = new Set();
  for (const r of allActivities.rows) {
    if (!activitiesWithMedia.has(r.id)) codesWithoutMedia.add(r.shorex_code);
  }

  const missing = [...codesWithoutMedia].sort();
  await client.end();

  console.log('=== Codes WITHOUT image linked to excursion (Activity.media empty) ===\n');
  console.log('Total unique codes without media:', missing.length);
  console.log('');
  console.log('Codes:', missing.join(', '));

  const outFile = path.join(__dirname, '..', 'codes-without-linked-images.txt');
  fs.writeFileSync(outFile, missing.join('\n'), 'utf-8');
  console.log('\nSaved to:', outFile);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
