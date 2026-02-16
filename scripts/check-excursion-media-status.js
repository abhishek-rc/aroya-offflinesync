'use strict';

/**
 * Check if all excursion entries (Activities) have media files linked.
 * No Strapi boot - direct DB query.
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

  // Activities with media (from files_related_mph)
  const withMediaRes = await client.query(
    `SELECT related_id FROM files_related_mph WHERE related_type = 'packages.activity'`
  );
  const activityIdsWithMedia = new Set(withMediaRes.rows.map((r) => r.related_id));

  // All activities with shorex_code
  const allRes = await client.query(
    `SELECT id, shorex_code FROM components_packages_activities 
     WHERE shorex_code IS NOT NULL AND shorex_code != '' 
     ORDER BY shorex_code`
  );

  const withMedia = [];
  const withoutMedia = [];

  for (const row of allRes.rows) {
    const item = { id: row.id, code: row.shorex_code };
    if (activityIdsWithMedia.has(row.id)) {
      withMedia.push(item);
    } else {
      withoutMedia.push(item);
    }
  }

  // Unique codes (activities can repeat across documents)
  const codesWithMedia = [...new Set(withMedia.map((r) => r.code))].sort();
  const codesWithoutMedia = [...new Set(withoutMedia.map((r) => r.code))].sort();

  console.log('=== Excursion Media Status ===\n');
  console.log('Total activities (with shorex_code):', allRes.rows.length);
  console.log('Activities WITH media linked:', withMedia.length);
  console.log('Activities WITHOUT media:', withoutMedia.length);
  console.log('');
  console.log('Unique codes WITH media:', codesWithMedia.length);
  console.log('Unique codes WITHOUT media:', codesWithoutMedia.length);
  console.log('');

  if (withoutMedia.length > 0) {
    console.log('=== Codes WITHOUT media ===\n');
    console.log(codesWithoutMedia.join(', '));
    console.log('\n');

    const outFile = path.join(__dirname, '..', 'codes-without-linked-images.txt');
    fs.writeFileSync(outFile, codesWithoutMedia.join('\n'), 'utf-8');
    console.log('Saved to:', outFile);
  } else {
    console.log('All excursion entries have media linked.');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
