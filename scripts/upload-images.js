'use strict';

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats['size'];
  return fileSizeInBytes;
}

function getFileData(filePath, fileName) {
  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split('.').pop();
  const mimeType = mime.lookup(ext || '') || '';

  return {
    filepath: filePath,
    originalFileName: fileName,
    size,
    mimetype: mimeType,
  };
}

async function createOrGetFolder(folderName) {
  // Check if folder already exists
  const existingFolder = await strapi.query('plugin::upload.folder').findOne({
    where: {
      name: folderName,
      parent: null, // Root level folder
    },
  });

  if (existingFolder) {
    console.log(`  ✓ Folder "${folderName}" already exists`);
    return existingFolder;
  }

  // Create new folder
  // Get the highest pathId to create a new one
  const folders = await strapi.query('plugin::upload.folder').findMany({
    orderBy: { pathId: 'desc' },
    limit: 1,
  });

  const nextPathId = folders.length > 0 ? folders[0].pathId + 1 : 1;

  const folder = await strapi.query('plugin::upload.folder').create({
    data: {
      name: folderName,
      path: `/${folderName}`,
      pathId: nextPathId,
    },
  });

  console.log(`  ✓ Created folder "${folderName}"`);
  return folder;
}

async function uploadFile(file, name, folder = null) {
  let uploadedFile;
  
  try {
    // Upload the file first
    const result = await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        files: file,
        data: {
          fileInfo: {
            alternativeText: name,
            caption: name,
            name,
          },
        },
      });
    
    uploadedFile = result[0];
  } catch (error) {
    // If it's just a cleanup error, check if file was uploaded
    if (error.message && error.message.includes('EPERM') && error.message.includes('unlink')) {
      // Wait a bit for the file to be saved
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to find the uploaded file
      const foundFile = await strapi.query('plugin::upload.file').findOne({
        where: { name },
        orderBy: { createdAt: 'desc' },
      });
      
      if (foundFile) {
        uploadedFile = foundFile;
      } else {
        throw error; // Re-throw if file wasn't found
      }
    } else {
      throw error; // Re-throw non-cleanup errors
    }
  }

  // If folder is provided, assign the file to that folder
  if (folder && uploadedFile) {
    try {
      await strapi.query('plugin::upload.file').update({
        where: { id: uploadedFile.id },
        data: {
          folder: folder.id,
          folderPath: folder.path,
        },
      });
      
      // Reload the file with folder relation
      return [await strapi.query('plugin::upload.file').findOne({
        where: { id: uploadedFile.id },
        populate: ['folder'],
      })];
    } catch (error) {
      // If folder assignment fails, still return the uploaded file
      console.log(`  ⚠ Warning: Could not assign ${name} to folder (file uploaded)`);
      return [uploadedFile];
    }
  }

  return [uploadedFile];
}

async function checkFileExistsBeforeUpload(fileName, folder, sourceDir) {
  // Check if the file already exists in Strapi (in the same folder)
  const fileWhereName = await strapi.query('plugin::upload.file').findOne({
    where: {
      name: fileName.replace(/\..*$/, ''),
      folder: folder ? folder.id : null,
    },
  });

  if (fileWhereName) {
    // File exists, return it
    console.log(`  ✓ ${fileName} already exists, skipping...`);
    return { file: fileWhereName, uploaded: false };
  } else {
    // File doesn't exist, upload it
    // Resolve path relative to project root
    const filePath = path.join(sourceDir, fileName);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`  ✗ ${fileName} not found in ${sourceDir}, skipping...`);
      return null;
    }

    const fileData = getFileData(filePath, fileName);
    const fileNameNoExtension = fileName.split('.').shift();
    
    // Retry logic for Windows permission errors
    let retries = 2; // Reduced retries since cleanup errors are common on Windows
    let lastError = null;
    
    while (retries > 0) {
      try {
        const [file] = await uploadFile(fileData, fileNameNoExtension, folder);
        
        // Longer delay for DB sync and Windows file system
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const verifyFile = await strapi.query('plugin::upload.file').findOne({
          where: {
            name: fileNameNoExtension,
            folder: folder ? folder.id : null,
          },
        });
        
        if (verifyFile) {
          console.log(`  ✓ Uploaded: ${fileName}`);
          return { file: verifyFile, uploaded: true };
        }
      } catch (error) {
        lastError = error;
        // Check if it's a permission error (cleanup failure, not upload failure)
        if (error.message && error.message.includes('EPERM') && error.message.includes('unlink')) {
          // This is likely a cleanup error, wait longer and check if file was actually uploaded
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait longer for Windows
          
          const verifyFile = await strapi.query('plugin::upload.file').findOne({
            where: {
              name: fileNameNoExtension,
              folder: folder ? folder.id : null,
            },
          });
          
          if (verifyFile) {
            // File was uploaded successfully, just cleanup failed - treat as success
            console.log(`  ✓ Uploaded: ${fileName} (cleanup error ignored)`);
            return { file: verifyFile, uploaded: true };
          }
          
          // If file doesn't exist, it might still be processing - wait more
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const verifyFile2 = await strapi.query('plugin::upload.file').findOne({
            where: {
              name: fileNameNoExtension,
              folder: folder ? folder.id : null,
            },
          });
          
          if (verifyFile2) {
            console.log(`  ✓ Uploaded: ${fileName} (cleanup error ignored)`);
            return { file: verifyFile2, uploaded: true };
          }
        }
        
        retries--;
        if (retries > 0) {
          console.log(`  ⚠ Retrying ${fileName}... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      }
    }
    
    // Final check - sometimes files upload despite errors
    if (lastError && lastError.message && lastError.message.includes('EPERM')) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const finalCheck = await strapi.query('plugin::upload.file').findOne({
        where: {
          name: fileNameNoExtension,
          folder: folder ? folder.id : null,
        },
      });
      
      if (finalCheck) {
        console.log(`  ✓ Uploaded: ${fileName} (verified after error)`);
        return { file: finalCheck, uploaded: true };
      }
    }
    
    // If we get here, upload failed
    throw lastError || new Error('Upload failed after retries');
  }
}

async function uploadImages(folderName, sourceDir) {
  console.log(`Starting upload of images from ${sourceDir} to Strapi...\n`);

  // First, create or get the folder in Strapi
  console.log(`Creating "${folderName}" folder in Strapi Media Library...`);
  const folder = await createOrGetFolder(folderName);
  console.log('');

  const sourceDirectory = path.isAbsolute(sourceDir) ? sourceDir : path.join(process.cwd(), sourceDir);
  
  // Check if source folder exists
  if (!fs.existsSync(sourceDirectory)) {
    console.error(`Error: source folder not found at ${sourceDirectory}`);
    return;
  }

  // Read all files from source folder
  const files = fs.readdirSync(sourceDirectory);
  
  // Filter only image files
  const imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
  });

  console.log(`Found ${imageFiles.length} images to upload\n`);

  let uploadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const failedFiles = [];

  // Upload files one by one (to avoid overwhelming the system)
  // Add small delay between uploads to help Windows release file locks
  for (let i = 0; i < imageFiles.length; i++) {
    const fileName = imageFiles[i];
    try {
      const result = await checkFileExistsBeforeUpload(fileName, folder, sourceDirectory);
      if (result) {
        if (result.uploaded) {
          // New upload
          uploadedCount++;
        } else {
          // Already exists
          skippedCount++;
        }
      } else {
        errorCount++;
      }
      
      // Longer delay between uploads to help Windows release file locks
      if (i < imageFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      }
      
      // Show progress
      if ((i + 1) % 10 === 0 || i === imageFiles.length - 1) {
        console.log(`Progress: ${i + 1}/${imageFiles.length} files processed\n`);
      }
    } catch (error) {
      // Check if it's just a cleanup error (file might still be uploaded)
      if (error.message && error.message.includes('EPERM') && error.message.includes('unlink')) {
        // Verify if file was actually uploaded despite the error
        const fileNameNoExtension = fileName.replace(/\..*$/, '');
        const verifyFile = await strapi.query('plugin::upload.file').findOne({
          where: {
            name: fileNameNoExtension,
            folder: folder ? folder.id : null,
          },
        });
        
        if (verifyFile) {
          console.log(`  ⚠ ${fileName} uploaded successfully (cleanup error ignored)`);
          uploadedCount++;
        } else {
          console.error(`  ✗ Error uploading ${fileName}:`, error.message);
          errorCount++;
          failedFiles.push(fileName);
        }
      } else {
        console.error(`  ✗ Error uploading ${fileName}:`, error.message);
        errorCount++;
        failedFiles.push(fileName);
      }
    }
  }

  console.log('\n=== Upload Summary ===');
  console.log(`Total images: ${imageFiles.length}`);
  console.log(`Uploaded: ${uploadedCount}`);
  console.log(`Skipped (already exists): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  
  if (failedFiles.length > 0) {
    console.log(`\nFailed files (${failedFiles.length}):`);
    failedFiles.forEach(file => console.log(`  - ${file}`));
    console.log('\nNote: Some errors may be Windows cleanup issues. Check Strapi Media Library to verify.');
  }
  
  console.log('\nUpload complete!');
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  // Get parameters from command line arguments
  // Usage: node upload-images.js <folderName> <sourceDir>
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node upload-images.js <folderName> <sourceDir>');
    console.error('Example: node upload-images.js products ./products/images');
    process.exit(1);
  }

  const folderName = args[0];
  const sourceDir = args[1];

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await uploadImages(folderName, sourceDir);
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

