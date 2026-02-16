/**
 * Upload files to OSS uploads-uat folder
 * 
 * Strategy:
 * 1. Upload ALL files from data/uploads-uat-latest
 * 2. Upload only NEW files from data/uploads (files not in uploads-uat-latest)
 * 
 * Usage: node scripts/upload-to-oss.js
 */

const OSS = require('ali-oss');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION,
  bucket: process.env.OSS_BUCKET,
};

const UPLOADS_UAT_LATEST = path.join(__dirname, '..', 'data', 'uploads-uat-latest');
const UPLOADS = path.join(__dirname, '..', 'data', 'uploads');
const OSS_FOLDER = 'uploads-uat';

// Validate configuration
function validateConfig() {
  const required = ['accessKeyId', 'accessKeySecret', 'region', 'bucket'];
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
  
  if (!fs.existsSync(UPLOADS_UAT_LATEST)) {
    console.error(`Error: ${UPLOADS_UAT_LATEST} does not exist`);
    process.exit(1);
  }
  
  if (!fs.existsSync(UPLOADS)) {
    console.error(`Error: ${UPLOADS} does not exist`);
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

// Get all files recursively
function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, fullPath);
      files.push({
        fullPath,
        relativePath: relativePath.replace(/\\/g, '/'), // Convert to forward slashes
        fileName: path.basename(fullPath),
      });
    }
  }
  
  return files;
}

// Upload a single file
async function uploadFile(client, localPath, ossPath) {
  try {
    await client.put(ossPath, localPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('Upload Files to OSS uploads-uat Folder');
  console.log('='.repeat(60));
  console.log('');
  
  // Validate
  validateConfig();
  
  console.log('Configuration:');
  console.log(`  Region: ${config.region}`);
  console.log(`  Bucket: ${config.bucket}`);
  console.log(`  OSS Folder: ${OSS_FOLDER}/`);
  console.log('');
  
  // Create client
  const client = createClient();
  
  // Get all files from both folders
  console.log('Scanning local folders...');
  const uatLatestFiles = getAllFiles(UPLOADS_UAT_LATEST);
  const uploadsFiles = getAllFiles(UPLOADS);
  
  console.log(`  uploads-uat-latest: ${uatLatestFiles.length} files`);
  console.log(`  uploads: ${uploadsFiles.length} files`);
  console.log('');
  
  // Create a set of filenames from uploads-uat-latest for quick lookup
  const uatLatestFileNames = new Set(uatLatestFiles.map(f => f.fileName));
  
  // Filter uploads to only include new files
  const newUploadsFiles = uploadsFiles.filter(f => !uatLatestFileNames.has(f.fileName));
  
  console.log(`  New files in uploads (not in uploads-uat-latest): ${newUploadsFiles.length} files`);
  console.log('');
  
  // Combine all files to upload
  const allFilesToUpload = [
    ...uatLatestFiles.map(f => ({
      localPath: f.fullPath,
      ossPath: `${OSS_FOLDER}/${f.fileName}`,
      source: 'uploads-uat-latest',
    })),
    ...newUploadsFiles.map(f => ({
      localPath: f.fullPath,
      ossPath: `${OSS_FOLDER}/${f.fileName}`,
      source: 'uploads',
    })),
  ];
  
  console.log(`Total files to upload: ${allFilesToUpload.length}`);
  console.log('');
  console.log('Starting upload...');
  console.log('');
  
  // Upload files
  let uploaded = 0;
  let failed = 0;
  const failedFiles = [];
  
  for (let i = 0; i < allFilesToUpload.length; i++) {
    const file = allFilesToUpload[i];
    
    process.stdout.write(`\r[${i + 1}/${allFilesToUpload.length}] Uploading: ${file.ossPath.substring(0, 50).padEnd(50)}`);
    
    const result = await uploadFile(client, file.localPath, file.ossPath);
    
    if (result.success) {
      uploaded++;
    } else {
      failed++;
      failedFiles.push({ file: file.ossPath, error: result.error });
    }
  }
  
  console.log('\n');
  console.log('='.repeat(60));
  console.log('Upload Summary');
  console.log('='.repeat(60));
  console.log(`  Total files: ${allFilesToUpload.length}`);
  console.log(`  Uploaded successfully: ${uploaded}`);
  console.log(`  Failed: ${failed}`);
  console.log('');
  
  if (failedFiles.length > 0) {
    console.log('Failed files:');
    failedFiles.forEach(f => console.log(`  - ${f.file}: ${f.error}`));
  }
}

// Run
main().catch(error => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
