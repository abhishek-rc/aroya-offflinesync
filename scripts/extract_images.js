#!/usr/bin/env node
/**
* Script to extract images from Jease CMS XML export file.
* Extracts base64-encoded images and saves them as files.
*/

const fs = require('fs');
const path = require('path');

function extractImagesFromXml(xmlFilePath, outputDir) {

    if (!outputDir) {
        console.error('Output directory is required');
        return;
    }

    // Resolve paths relative to project root (parent of scripts folder)
    const projectRoot = path.resolve(__dirname, '..');
    const resolvedXmlPath = path.isAbsolute(xmlFilePath) 
        ? xmlFilePath 
        : path.join(projectRoot, xmlFilePath);

    const resolvedOutputDir = path.isAbsolute(outputDir)
        ? outputDir
        : path.join(projectRoot, outputDir);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(resolvedOutputDir)) {
        fs.mkdirSync(resolvedOutputDir, { recursive: true });
    }

    console.log(`Reading XML file: ${resolvedXmlPath}`);
    console.log(`Output directory: ${resolvedOutputDir}`);

    // Read XML file
    let xmlContent;
    try {
        xmlContent = fs.readFileSync(resolvedXmlPath, 'utf8');
    } catch (error) {
        console.error(`Error reading XML file: ${error.message}`);
        return;
    }

    // Find all Image elements using regex
    // Pattern: <jease.cms.domain.Image>...</jease.cms.domain.Image>
    const imagePattern = /<jease\.cms\.domain\.Image>([\s\S]*?)<\/jease\.cms\.domain\.Image>/g;
    const images = [];
    let match;

    while ((match = imagePattern.exec(xmlContent)) !== null) {
        const imageContent = match[1];
        images.push(imageContent);
    }

    console.log(`Found ${images.length} image elements`);

    let savedCount = 0;
    let skippedCount = 0;

    images.forEach((imageContent, idx) => {
        try {
            // Extract ID
            const idMatch = imageContent.match(/<id>([^<]*)<\/id>/);
            const imageId = idMatch ? idMatch[1].trim() : null;

            // Extract name
            const nameMatch = imageContent.match(/<name>([^<]*)<\/name>/);
            const imageName = nameMatch ? nameMatch[1].trim() : null;

            // Extract content type
            const contentTypeMatch = imageContent.match(/<contentType>([^<]*)<\/contentType>/);
            const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : null;

            // Extract data (base64 encoded) - handle multiline data
            // Jease CMS stores data in <blob> tag
            let dataMatch = imageContent.match(/<blob>([\s\S]*?)<\/blob>/);
            if (!dataMatch) {
                // Try <data> tag as fallback
                dataMatch = imageContent.match(/<data>([\s\S]*?)<\/data>/);
            }
            if (!dataMatch) {
                // Try without closing tag (self-closing or different format)
                dataMatch = imageContent.match(/<blob>([\s\S]*)/);
            }
            const imageDataBase64 = dataMatch ? dataMatch[1].trim() : null;

            if (!imageDataBase64) {
                console.log(`  [${idx + 1}] Skipping - no data found`);
                skippedCount++;
                return;
            }

            // Decode base64 data
            let imageBuffer;
            try {
                imageBuffer = Buffer.from(imageDataBase64, 'base64');
            } catch (error) {
                console.log(`  [${idx + 1}] Error decoding base64: ${error.message}`);
                skippedCount++;
                return;
            }

            // Determine file extension from content type
            let extension = '.jpg'; // default
            if (contentType) {
                const ct = contentType.toLowerCase();
                if (ct.includes('jpeg') || ct.includes('jpg')) {
                    extension = '.jpg';
                } else if (ct.includes('png')) {
                    extension = '.png';
                } else if (ct.includes('gif')) {
                    extension = '.gif';
                } else if (ct.includes('webp')) {
                    extension = '.webp';
                } else if (ct.includes('svg')) {
                    extension = '.svg';
                }
            }

            // Determine filename
            let filename;
            if (imageId) {
                filename = `${imageId}${extension}`;
            } else if (imageName) {
                // Sanitize filename
                filename = imageName.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_');
                filename = `${filename}${extension}`;
            } else {
                filename = `image_${String(idx + 1).padStart(4, '0')}${extension}`;
            }

            // Save image
            let filePath = path.join(resolvedOutputDir, filename);

            // Handle duplicate filenames
            let counter = 1;
            const originalFilename = filename;
            while (fs.existsSync(filePath)) {
                const namePart = originalFilename.replace(/\.[^/.]+$/, '');
                const extPart = path.extname(originalFilename);
                filename = `${namePart}_${counter}${extPart}`;
                filePath = path.join(resolvedOutputDir, filename);
                counter++;
            }

            fs.writeFileSync(filePath, imageBuffer);
            console.log(`  [${idx + 1}] Saved: ${filename} (${imageBuffer.length} bytes)`);
            savedCount++;

        } catch (error) {
            console.log(`  [${idx + 1}] Error processing image: ${error.message}`);
            skippedCount++;
        }
    });

    console.log(`\nExtraction complete!`);
    console.log(`  Saved: ${savedCount} images`);
    console.log(`  Skipped: ${skippedCount} images`);
    console.log(`  Output directory: ${resolvedOutputDir}`);
}

// Main execution
const xmlFile = process.argv[2];
const outputDir = process.argv[3];

// Check if XML file exists (resolve relative to project root)
const projectRoot = path.resolve(__dirname, '..');
const resolvedXmlPath = path.isAbsolute(xmlFile) 
    ? xmlFile 
    : path.join(projectRoot, xmlFile);

if (!fs.existsSync(resolvedXmlPath)) {
    console.error(`Error: XML file '${resolvedXmlPath}' not found!`);
    console.error(`Usage: node scripts/extract_images.js <xml-file> <output-dir>`);
    console.error(`Example: node scripts/extract_images.js shorexes.xml shorexes`);
    process.exit(1);
}

extractImagesFromXml(xmlFile, outputDir);

 