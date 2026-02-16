/**
 * Download all media files from Alibaba Cloud OSS
 * 
 * Usage: 
 *   node scripts/download-oss-files.js [oss-folder] [local-folder] [base-dir]
 * 
 * Examples:
 *   node scripts/download-oss-files.js uploads uploads
 *   node scripts/download-oss-files.js uploads-uat uploads-uat
 *   node scripts/download-oss-files.js uploads-uat uploads-uat jease-data
 * 
 * Requires environment variables:
 * - OSS_ACCESS_KEY_ID
 * - OSS_ACCESS_KEY_SECRET
 * - OSS_REGION
 * - OSS_BUCKET
 */

const OSS = require('ali-oss');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Get command line arguments
const args = process.argv.slice(2);
const OSS_FOLDER = args[0] || 'uploads';  // Default: uploads
const LOCAL_FOLDER = args[1] || OSS_FOLDER;  // Default: same as OSS folder
const BASE_DIR = args[2] || 'data';  // Default: data (use jease-data for jease-data/uploads-uat)

// Configuration
const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION,
  bucket: process.env.OSS_BUCKET,
  uploadPath: OSS_FOLDER.endsWith('/') ? OSS_FOLDER : OSS_FOLDER + '/',  // Add trailing slash to match exact folder
};

// Target directory for downloads
const TARGET_DIR = path.join(__dirname, '..', BASE_DIR, LOCAL_FOLDER);

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

// Download a single file
async function downloadFile(client, ossPath, localPath) {
  try {
    // Ensure directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Download file
    await client.get(ossPath, localPath);
    return true;
  } catch (error) {
    console.error(`  Failed to download ${ossPath}: ${error.message}`);
    return false;
  }
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('OSS Media Files Downloader');
  console.log('='.repeat(60));
  
  // Validate configuration
  validateConfig();
  
  console.log('\nConfiguration:');
  console.log(`  Region: ${config.region}`);
  console.log(`  Bucket: ${config.bucket}`);
  console.log(`  Upload Path: ${config.uploadPath}`);
  console.log(`  Target Directory: ${TARGET_DIR}`);
  
  // Create client
  const client = createClient();
  
  // Create target directory if it doesn't exist
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`\nCreated target directory: ${TARGET_DIR}`);
  }
  
  // List all files
  console.log('\nFetching file list from OSS...');
  const files = await listAllFiles(client, config.uploadPath);
  
  if (files.length === 0) {
    console.log('\nNo files found in OSS bucket.');
    return;
  }
  
  console.log(`\nFound ${files.length} file(s) to download.`);
  
  // Download files
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Calculate local path (preserve folder structure relative to uploadPath)
    const relativePath = file.name.startsWith(config.uploadPath + '/')
      ? file.name.slice(config.uploadPath.length + 1)
      : file.name;
    const localPath = path.join(TARGET_DIR, relativePath);
    
    // Skip if file already exists with same size
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      if (stats.size === file.size) {
        skipped++;
        continue;
      }
    }
    
    // Progress indicator
    process.stdout.write(`\r[${i + 1}/${files.length}] Downloading: ${relativePath.substring(0, 50).padEnd(50)}`);
    
    const success = await downloadFile(client, file.name, localPath);
    if (success) {
      downloaded++;
    } else {
      failed++;
    }
  }
  
  // Summary
  console.log('\n');
  console.log('='.repeat(60));
  console.log('Download Summary');
  console.log('='.repeat(60));
  console.log(`  Total files: ${files.length}`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Skipped (already exists): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\nFiles saved to: ${TARGET_DIR}`);
}

// Run
main().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
