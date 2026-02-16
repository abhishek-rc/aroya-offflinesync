/**
 * Delete all files from Alibaba Cloud OSS folder
 * 
 * Usage: 
 *   node scripts/delete-oss-files.js [oss-folder]
 * 
 * Examples:
 *   node scripts/delete-oss-files.js uploads-uat
 *   node scripts/delete-oss-files.js uploads
 * 
 * Requires environment variables:
 * - OSS_ACCESS_KEY_ID
 * - OSS_ACCESS_KEY_SECRET
 * - OSS_REGION
 * - OSS_BUCKET
 */

const OSS = require('ali-oss');
require('dotenv').config();

// Get command line arguments
const args = process.argv.slice(2);
const OSS_FOLDER = args[0];

if (!OSS_FOLDER) {
  console.error('Error: OSS folder name is required');
  console.error('Usage: node scripts/delete-oss-files.js [oss-folder]');
  console.error('Example: node scripts/delete-oss-files.js uploads-uat');
  process.exit(1);
}

// Configuration
const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION,
  bucket: process.env.OSS_BUCKET,
  uploadPath: OSS_FOLDER.endsWith('/') ? OSS_FOLDER : OSS_FOLDER + '/',
};

// Validate configuration
function validateConfig() {
  const required = ['accessKeyId', 'accessKeySecret', 'region', 'bucket'];
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Please ensure your .env file contains:');
    missing.forEach(key => console.error(`  - OSS_${key.toUpperCase().replace(/([A-Z])/g, '_$1')}`));
    process.exit(1);
  }
}

// Create OSS client
function createClient() {
  return new OSS({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    bucket: config.bucket,
  });
}

// List all files in OSS bucket
async function listAllFiles(client, prefix = '') {
  const files = [];
  let marker = null;
  
  console.log(`Listing files with prefix: ${prefix || '(root)'}`);
  
  do {
    const result = await client.list({
      prefix: prefix,
      marker: marker,
      'max-keys': 1000,
    });
    
    if (result.objects) {
      // Filter out directories (objects ending with /)
      const fileObjects = result.objects.filter(obj => !obj.name.endsWith('/'));
      files.push(...fileObjects);
    }
    
    marker = result.nextMarker;
  } while (marker);
  
  return files;
}

// Delete a single file
async function deleteFile(client, ossPath) {
  try {
    await client.delete(ossPath);
    return true;
  } catch (error) {
    console.error(`  Failed to delete ${ossPath}: ${error.message}`);
    return false;
  }
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('OSS Files Deletion');
  console.log('='.repeat(60));
  
  // Validate configuration
  validateConfig();
  
  console.log('\nConfiguration:');
  console.log(`  Region: ${config.region}`);
  console.log(`  Bucket: ${config.bucket}`);
  console.log(`  Folder: ${config.uploadPath}`);
  console.log(`\n⚠️  WARNING: This will DELETE ALL FILES in the "${config.uploadPath}" folder!`);
  
  // Create client
  const client = createClient();
  
  // List all files
  console.log('\nFetching file list from OSS...');
  const files = await listAllFiles(client, config.uploadPath);
  
  if (files.length === 0) {
    console.log('\nNo files found in OSS folder. Nothing to delete.');
    return;
  }
  
  console.log(`\nFound ${files.length} file(s) to delete.`);
  console.log('\nStarting deletion...');
  
  // Delete files
  let deleted = 0;
  let failed = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Progress indicator
    process.stdout.write(`\r[${i + 1}/${files.length}] Deleting: ${file.name.substring(0, 50).padEnd(50)}`);
    
    const success = await deleteFile(client, file.name);
    if (success) {
      deleted++;
    } else {
      failed++;
    }
  }
  
  // Summary
  console.log('\n');
  console.log('='.repeat(60));
  console.log('Deletion Summary');
  console.log('='.repeat(60));
  console.log(`  Total files: ${files.length}`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Failed: ${failed}`);
}

// Run
main().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
