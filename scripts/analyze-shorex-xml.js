'use strict';

const fs = require('fs');
const path = require('path');

const XML_FILE = path.join(__dirname, '..', 'jease-data', 'dumps', 'shorex-description.xml');

/**
 * Parse shorex XML file and extract entries
 */
function parseShorexXML(xmlFilePath) {
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const entries = [];
  
  // Regex to match shorex entries
  const shorexPattern = /<shorex:([A-Z0-9]+)\s+([^>]+)>([\s\S]*?)<\/shorex:\1>/g;
  
  let match;
  while ((match = shorexPattern.exec(xmlContent)) !== null) {
    const id = match[1];
    const attributes = match[2];
    const content = match[3].trim();
    
    // Parse attributes
    const titleMatch = attributes.match(/title="([^"]+)"/);
    const nameMatch = attributes.match(/name="([^"]+)"/);
    const localeMatch = attributes.match(/locale="([^"]+)"/);
    
    const title = titleMatch ? titleMatch[1] : '';
    const name = nameMatch ? nameMatch[1] : '';
    const locale = localeMatch ? localeMatch[1] : 'en';
    
    entries.push({
      id,
      title,
      name,
      locale,
      description: content,
    });
  }
  
  return entries;
}

/**
 * Group entries by ID and locale
 */
function groupEntriesByID(entries) {
  const grouped = {};
  
  for (const entry of entries) {
    if (!grouped[entry.id]) {
      grouped[entry.id] = {};
    }
    grouped[entry.id][entry.locale] = entry;
  }
  
  return grouped;
}

/**
 * Main analysis
 */
function main() {
  console.log('=== Shorex XML Analysis ===\n');
  
  // Parse XML
  const entries = parseShorexXML(XML_FILE);
  console.log(`Total entries found: ${entries.length}\n`);
  
  // Count by locale
  const localeCounts = {};
  entries.forEach(entry => {
    localeCounts[entry.locale] = (localeCounts[entry.locale] || 0) + 1;
  });
  
  console.log('Entries by locale:');
  Object.keys(localeCounts).sort().forEach(locale => {
    console.log(`  ${locale}: ${localeCounts[locale]}`);
  });
  console.log();
  
  // Group by ID
  const grouped = groupEntriesByID(entries);
  const shorexIds = Object.keys(grouped).sort();
  
  console.log(`Unique shorex IDs: ${shorexIds.length}\n`);
  
  // Analyze locale distribution per ID
  let bothLocales = 0;
  let onlyEn = 0;
  let onlyAr = 0;
  let other = 0;
  
  const onlyEnIds = [];
  const onlyArIds = [];
  const bothIds = [];
  
  shorexIds.forEach(id => {
    const locales = Object.keys(grouped[id]);
    if (locales.includes('en') && locales.includes('ar')) {
      bothLocales++;
      bothIds.push(id);
    } else if (locales.includes('en') && !locales.includes('ar')) {
      onlyEn++;
      onlyEnIds.push(id);
    } else if (locales.includes('ar') && !locales.includes('en')) {
      onlyAr++;
      onlyArIds.push(id);
    } else {
      other++;
    }
  });
  
  console.log('Locale distribution per ID:');
  console.log(`  IDs with both EN and AR: ${bothLocales}`);
  console.log(`  IDs with only EN: ${onlyEn}`);
  console.log(`  IDs with only AR: ${onlyAr}`);
  console.log(`  IDs with other locales: ${other}`);
  console.log();
  
  // Check for duplicate ID+locale combinations
  const idLocaleMap = {};
  const duplicates = [];
  
  entries.forEach(entry => {
    const key = `${entry.id}:${entry.locale}`;
    if (idLocaleMap[key]) {
      duplicates.push({ id: entry.id, locale: entry.locale, count: idLocaleMap[key] + 1 });
      idLocaleMap[key]++;
    } else {
      idLocaleMap[key] = 1;
    }
  });
  
  console.log(`Duplicate ID+locale combinations: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.log('\nFirst 20 duplicates:');
    duplicates.slice(0, 20).forEach(dup => {
      console.log(`  ${dup.id} (${dup.locale}): appears ${dup.count} times`);
    });
  }
  console.log();
  
  // Verify math
  const expectedTotal = bothLocales * 2 + onlyEn + onlyAr + other;
  console.log(`Verification:`);
  console.log(`  Expected total entries (if no duplicates): ${expectedTotal} (${bothLocales} × 2 + ${onlyEn} + ${onlyAr} + ${other})`);
  console.log(`  Actual total entries: ${entries.length}`);
  console.log(`  Difference: ${entries.length - expectedTotal} extra entries (likely duplicates)`);
  console.log();
  
  if (onlyEnIds.length > 0) {
    console.log(`\nIDs with only English (${onlyEnIds.length}):`);
    onlyEnIds.slice(0, 20).forEach(id => console.log(`  ${id}`));
    if (onlyEnIds.length > 20) {
      console.log(`  ... and ${onlyEnIds.length - 20} more`);
    }
  }
  
  if (onlyArIds.length > 0) {
    console.log(`\nIDs with only Arabic (${onlyArIds.length}):`);
    onlyArIds.slice(0, 20).forEach(id => console.log(`  ${id}`));
    if (onlyArIds.length > 20) {
      console.log(`  ... and ${onlyArIds.length - 20} more`);
    }
  }
}

main();
