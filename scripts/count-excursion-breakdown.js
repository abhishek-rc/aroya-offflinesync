'use strict';

/**
 * Breakdown: excursion documents vs activities with/without media
 */

require('dotenv').config();
const pg = require('pg');

async function main() {
  const client = new pg.Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
  });
  await client.connect();

  const docCount = await client.query(
    "SELECT COUNT(DISTINCT document_id) as c FROM excursions WHERE locale = 'en'"
  );
  console.log('Excursion documents (EN):', docCount.rows[0].c);

  const withMedia = await client.query(
    "SELECT DISTINCT related_id FROM files_related_mph WHERE related_type = 'packages.activity'"
  );
  const activitiesWithMedia = new Set(withMedia.rows.map((r) => r.related_id));

  const allActivities = await client.query(
    "SELECT id, shorex_code FROM components_packages_activities WHERE shorex_code IS NOT NULL"
  );

  const codesWithMedia = new Set();
  const codesWithoutMedia = new Set();
  for (const r of allActivities.rows) {
    if (activitiesWithMedia.has(r.id)) codesWithMedia.add(r.shorex_code);
    else codesWithoutMedia.add(r.shorex_code);
  }

  console.log('Unique codes WITH media linked:', codesWithMedia.size);
  console.log('Unique codes WITHOUT media:', codesWithoutMedia.size);
  console.log('Codes without media:', [...codesWithoutMedia].sort().join(', '));

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
