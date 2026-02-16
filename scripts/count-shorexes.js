'use strict';

const fs = require('fs');
const path = require('path');

const XML_FILE = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');

function parseShorexXML(xmlFilePath) {
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const ids = new Set();
  const shorexPattern = /<shorex:([A-Z0-9]+)\s+([^>]+)>([\s\S]*?)<\/shorex:\1>/g;
  let match;
  while ((match = shorexPattern.exec(xmlContent)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

async function countCMS() {
  const shorexCodes = new Set();

  // excursion (Booking Journey) - shorex_code in packages.excursions > Activity
  const excursionEntries = await strapi.documents('api::excursion.excursion').findMany({
    locale: 'en',
  });
  for (const entry of excursionEntries) {
    if (entry.excursions && Array.isArray(entry.excursions)) {
      for (const excursion of entry.excursions) {
        if (excursion.__component === 'packages.excursions' && excursion.Activity?.shorex_code) {
          shorexCodes.add(excursion.Activity.shorex_code);
        }
      }
    }
  }

  return shorexCodes;
}

async function main() {
  console.log('=== Shorex Count Report ===\n');

  // 1. Count XML entries
  const xmlIds = parseShorexXML(XML_FILE);
  console.log(`XML (shorex-description.xml):`);
  console.log(`  Total unique shorex IDs: ${xmlIds.size}`);

  // 2. Count CMS entries (requires Strapi)
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  const cmsCodes = await countCMS();
  console.log(`\nCMS (Strapi excursion content):`);
  console.log(`  Total shorex codes in CMS: ${cmsCodes.size}`);

  // 3. Missing (in XML but not in CMS)
  const missing = [...xmlIds].filter(id => !cmsCodes.has(id)).sort();
  console.log(`\nMissing (in XML, not in CMS): ${missing.length}`);
  
  // Save all missing codes to a file
  const missingFile = path.join(__dirname, '..', 'missing-shorex-codes.txt');
  fs.writeFileSync(missingFile, missing.join('\n'), 'utf-8');
  console.log(`  Full list saved to: ${missingFile}`);
  
  // Display all codes (grouped for readability)
  if (missing.length > 0) {
    console.log(`\n  All missing codes (${missing.length} total):`);
    // Display in groups of 10 for readability
    for (let i = 0; i < missing.length; i += 10) {
      const group = missing.slice(i, i + 10);
      console.log(`    ${group.join(', ')}`);
    }
  }

  // 4. Extra (in CMS but not in XML - possibly old/removed)
  const extra = [...cmsCodes].filter(code => !xmlIds.has(code));
  console.log(`\nExtra (in CMS, not in XML): ${extra.length}`);
  if (extra.length > 0 && extra.length <= 30) {
    console.log(`  Codes: ${extra.sort().join(', ')}`);
  }

  await app.destroy();
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
