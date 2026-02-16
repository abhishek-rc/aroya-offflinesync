'use strict';

/**
 * Check if a shorex code exists in excursion entries (CMS).
 * Usage: node scripts/check-code-in-excursions.js SSH08
 */

require('dotenv').config();
const pg = require('pg');

async function main() {
  const code = process.argv[2] || 'SSH08';

  const client = new pg.Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const res = await client.query(
    `SELECT id, shorex_code FROM components_packages_activities 
     WHERE shorex_code = $1`,
    [code]
  );

  console.log(`Code "${code}" in excursion entries (components_packages_activities):`);
  console.log('Found:', res.rows.length, 'activity record(s)');
  if (res.rows.length > 0) {
    console.log('Activity IDs:', res.rows.map((r) => r.id).join(', '));

    // Find which excursion documents (pages) contain this code
    const docRes = await client.query(`
      SELECT DISTINCT e.document_id, e.locale, e.page_name, e.page_slug
      FROM excursions e
      JOIN excursions_cmps ec ON e.id = ec.entity_id AND ec.component_type = 'packages.excursions'
      JOIN components_packages_excursions_cmps pec ON ec.cmp_id = pec.entity_id
      JOIN components_packages_activities a ON pec.cmp_id = a.id AND a.shorex_code = $1
      ORDER BY e.document_id, e.locale
    `, [code]);
    console.log('\nExcursion documents (pages) containing SSH08:');
    for (const row of docRes.rows) {
      console.log(`  - ${row.document_id} (${row.locale}): ${row.page_name || row.page_slug || 'n/a'}`);
    }
  } else {
    console.log('Not found in CMS excursion entries.');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
