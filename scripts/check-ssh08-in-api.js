'use strict';

/**
 * Check if SSH08 appears in the excursions API response.
 * Usage: node scripts/check-ssh08-in-api.js
 */

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:1337/api/excursions';
// Use large page size to get all 409 excursions (default limit is 300)
const API_URL = BASE_URL + '?populate=*&locale=en&pagination[pageSize]=500';

function fetch(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function findShorexCode(obj, code, path = '') {
  const results = [];
  if (obj === null || obj === undefined) return results;
  if (typeof obj === 'string') {
    if (obj === code) results.push({ path, value: obj });
    return results;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return results;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      results.push(...findShorexCode(item, code, `${path}[${i}]`));
    });
    return results;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (k === 'shorex_code' && v === code) {
      results.push({ path: p, value: v });
    }
    results.push(...findShorexCode(v, code, p));
  }
  return results;
}

async function main() {
  const code = process.argv[2] || 'SSH08';
  console.log(`Fetching API: ${API_URL}`);
  console.log(`Searching for code: ${code}\n`);

  try {
    const data = await fetch(API_URL);
    const str = JSON.stringify(data);
    const found = str.includes(code);

    console.log('API response received.');
    console.log('Contains "' + code + '":', found);

    if (found) {
      const matches = findShorexCode(data, code);
      console.log('Occurrences:', matches.length);
      for (const m of matches.slice(0, 5)) {
        console.log('  -', m.path);
      }

      if (data.data) {
        const total = Array.isArray(data.data) ? data.data.length : 1;
        console.log('\nTotal excursions in response:', total);
        const docs = Array.isArray(data.data) ? data.data : [data.data];
        const withCode = docs.filter((d) => JSON.stringify(d).includes(code));
        console.log('Documents containing ' + code + ':', withCode.length);
        if (withCode.length > 0) {
          const doc = withCode[0];
          console.log('First match - documentId:', doc.documentId || doc.id);
          if (doc.attributes?.page_name) console.log('Page name:', doc.attributes.page_name);
        }
      }
    } else {
      console.log('\nCode', code, 'NOT found in API response.');
      if (data.data) {
        const total = Array.isArray(data.data) ? data.data.length : 1;
        console.log('Total excursions returned:', total);
      }
    }
  } catch (err) {
    console.error('Error:', err.message || err.code || 'Connection failed');
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      console.log('\nStrapi may not be running. Start it with: npm run develop');
    }
    process.exit(1);
  }
}

main();
