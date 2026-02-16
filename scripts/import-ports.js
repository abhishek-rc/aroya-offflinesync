'use strict';

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

/**
 * Parse HTML file and extract port/destination details
 */
function parsePortHTML(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
  const $ = cheerio.load(htmlContent);

  // Extract page name from title tag
  let pageName = '';
  const titleTag = $('title').text().trim();
  if (titleTag) {
    const titleMatch = titleTag.match(/^([^|]+)/);
    if (titleMatch) {
      pageName = titleMatch[1].trim();
    }
  }

  // Extract meta description
  const metaDescription = $('meta[name="description"]').attr('content') || '';

  // Extract hero banner data
  const heroIntro = $('.destination-intro');
  const heroTitle = heroIntro.find('h1').first().text().trim();
  
  // Extract background images from inline style
  const heroStyle = heroIntro.attr('style') || '';
  const desktopImageMatch = heroStyle.match(/--destination-intro-image:\s*url\(['"]?([^'")\s]+)['"]?\)/);
  const mobileImageMatch = heroStyle.match(/--destination-intro-mobile-image:\s*url\(['"]?([^'")\s]+)['"]?\)/);
  
  const desktopImage = desktopImageMatch ? desktopImageMatch[1] : null;
  const mobileImage = mobileImageMatch ? mobileImageMatch[1] : null;

  // Extract CTA button
  const ctaButton = heroIntro.find('.destination-intro__link').first();
  const ctaText = ctaButton.text().trim();
  const ctaUrl = ctaButton.attr('href') || '#';

  // Extract content sections (Image & Text sections)
  const contentSections = [];
  
  $('.destination-content').each((index, element) => {
    const $section = $(element);
    const title = $section.find('.section-header__title h2').first().text().trim();
    
    // Extract description - handle both paragraph and list formats
    let description = '';
    const descDiv = $section.find('.destination-content__text');
    
    // Check for list items
    const listItems = descDiv.find('li');
    if (listItems.length > 0) {
      const items = [];
      listItems.each((i, li) => {
        // Get direct text or nested paragraph text
        let itemText = $(li).find('p').first().text().trim();
        if (!itemText) {
          itemText = $(li).text().trim();
        }
        // Skip if it's just a container for nested lists
        if (itemText && !$(li).children('ul').length) {
          items.push(itemText);
        }
      });
      description = items.filter(item => item).join('\n');
    } else {
      description = descDiv.find('p').first().text().trim();
    }

    // Extract image
    const img = $section.find('.destination-content__img').first();
    const imageSrc = img.attr('src') || '';
    const imageSrcset = img.attr('srcset') || '';

    // Determine image position based on class
    const hasImgLeft = $section.hasClass('destination-content--img-left');
    const imagePosition = hasImgLeft ? 'left' : 'right';

    if (title) {
      contentSections.push({
        title,
        description,
        imageSrc,
        imageSrcset,
        imagePosition,
      });
    }
  });

  // Extract tips section
  const tipsSection = $('.destination-tips');
  const tipsTitle = tipsSection.find('.destination-tips__items-title').first().text().trim();
  
  const tipItems = [];
  tipsSection.find('.destination-tips__item').each((index, element) => {
    const $tip = $(element);
    const tipText = $tip.find('.destination-tips__item-body p').map((i, p) => $(p).text().trim()).get().filter(t => t).join(' ');
    if (tipText) {
      tipItems.push(tipText);
    }
  });

  // Extract climate card
  const climateCard = tipsSection.find('.destination-tips__card');
  const climateTitle = climateCard.find('.destination-tips__card-title').first().text().trim();
  const climateDescription = climateCard.find('.destination-tips__card-body p').first().text().trim();

  // Extract activities/entertainment info section
  const infoSection = $('.destination-info');
  const infoTitle = infoSection.find('.destination-info__content-title').first().text().trim();
  const infoDescription = infoSection.find('.desination-info__content-body p').first().text().trim();

  // Extract gallery images
  const gallerySection = $('.gallery');
  const galleryTitle = gallerySection.find('.section-header__title h2').first().text().trim();
  
  const galleryImages = [];
  gallerySection.find('.gallery-slider .gallery-slide img').each((index, element) => {
    const $img = $(element);
    const src = $img.attr('src') || '';
    const srcset = $img.attr('srcset') || '';
    const alt = $img.attr('alt') || '';
    if (src) {
      galleryImages.push({ src, srcset, alt });
    }
  });

  console.log(`  Parsed port: ${pageName}`);
  console.log(`    - ${contentSections.length} content sections`);
  console.log(`    - ${tipItems.length} tips`);
  console.log(`    - ${galleryImages.length} gallery images`);

  // Collect all image URLs for reference
  const imageUrls = [];
  if (desktopImage) imageUrls.push({ type: 'hero-desktop', url: desktopImage });
  if (mobileImage) imageUrls.push({ type: 'hero-mobile', url: mobileImage });
  contentSections.forEach((section, i) => {
    if (section.imageSrc) {
      imageUrls.push({ type: `content-${i}`, url: section.imageSrc });
    }
  });
  galleryImages.forEach((img, i) => {
    imageUrls.push({ type: `gallery-${i}`, url: img.src });
  });

  return {
    pageName,
    metaDescription,
    hero: {
      title: heroTitle,
      desktopImage,
      mobileImage,
      ctaText,
      ctaUrl,
    },
    contentSections,
    tips: {
      title: tipsTitle,
      items: tipItems,
    },
    climate: {
      title: climateTitle,
      description: climateDescription,
    },
    activities: {
      title: infoTitle,
      description: infoDescription,
    },
    gallery: {
      title: galleryTitle,
      images: galleryImages,
    },
    imageUrls, // Store all image URLs for reference
  };
}

/**
 * Convert plain text to Markdown format for Strapi richtext
 */
function convertToRichText(text) {
  if (!text || !text.trim()) {
    return '';
  }

  // Convert bullet character to Markdown bullet syntax
  const lines = text.split('\n');
  const markdownLines = lines.map(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('•')) {
      const indent = line.match(/^\s*/)[0];
      return indent + '- ' + trimmedLine.substring(1).trim();
    }
    return line;
  });

  return markdownLines.join('\n').trim();
}

/**
 * Generate URL-friendly slug from title
 * Supports both English and Arabic characters
 */
function generateSlug(title, locale = 'en') {
  if (locale === 'ar') {
    return title
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  } else {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

/**
 * Check if port-detail entry already exists by page_slug
 */
async function entryExists(pageSlug) {
  try {
    const existingEntries = await strapi.documents('api::port-detail.port-detail').findMany({
      locale: 'en',
    });

    for (const entry of existingEntries) {
      if (entry.page_slug === pageSlug) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Build hero banner component from parsed data
 */
function buildHeroBanner(hero, locale) {
  // Build heading as blocks format for Strapi
  const heading = hero.title ? [
    {
      type: 'heading',
      level: 1,
      children: [{ type: 'text', text: hero.title }],
    },
  ] : [];

  return {
    __component: 'shared.hero-banner',
    hero_banner: [
      {
        heading: heading,
        textAlign: locale === 'ar' ? 'right' : 'left',
        cta_button: hero.ctaText ? [
          {
            text: hero.ctaText,
            link_url: hero.ctaUrl || '#',
          },
        ] : [],
        // Note: Images would need to be uploaded separately or referenced by ID
      },
    ],
  };
}

/**
 * Build Image & Text section component
 */
function buildImageTextSection(section, index) {
  return {
    __component: 'shared.image-and-text-section',
    title: convertToRichText(section.title),
    description: convertToRichText(section.description),
    image_position: section.imagePosition || 'right',
    content_alignment: 'start',
    has_description_1: false,
    has_description_2: false,
    has_description_3: false,
    has_cta: false,
    // Note: Media would need to be uploaded separately
  };
}

/**
 * Build Important Points component for tips
 */
function buildImportantPoints(tips, climate) {
  const points = [];

  // Add tips as points
  tips.items.forEach((tip) => {
    points.push({
      point_description: convertToRichText(tip),
    });
  });

  // Build the component
  return {
    __component: 'destinations.important-points',
    title: convertToRichText(tips.title),
    points: points,
  };
}

/**
 * Build Rich Text component for climate/activities
 */
function buildRichTextSection(title, description) {
  return {
    __component: 'shared.rich-text',
    title: title || 'Section',
    content: convertToRichText(description || ''),
  };
}

/**
 * Build Image & Text section for climate (with card styling hint in title)
 */
function buildClimateSection(climate) {
  if (!climate.title && !climate.description) {
    return null;
  }
  
  return {
    __component: 'shared.image-and-text-section',
    title: convertToRichText(`🌤️ ${climate.title}`),
    description: convertToRichText(climate.description),
    image_position: 'right',
    content_alignment: 'start',
    has_description_1: false,
    has_description_2: false,
    has_description_3: false,
    has_cta: false,
  };
}

/**
 * Build Image & Text section for activities/entertainment
 */
function buildActivitiesSection(activities) {
  if (!activities.title && !activities.description) {
    return null;
  }
  
  return {
    __component: 'shared.image-and-text-section',
    title: convertToRichText(`🎭 ${activities.title}`),
    description: convertToRichText(activities.description),
    image_position: 'left',
    content_alignment: 'start',
    has_description_1: false,
    has_description_2: false,
    has_description_3: false,
    has_cta: false,
  };
}

/**
 * Build Gallery component
 */
function buildGallery(gallery) {
  const mediaItems = gallery.images.map((img, index) => ({
    has_title: false,
    has_category: false,
    has_logo: false,
    need_alignment: false,
    has_short_content: false,
    has_content: false,
    has_cta: false,
    // Note: Image would need to be uploaded separately
  }));

  return {
    __component: 'shared.gallery-item',
    has_tabs: false,
    media: mediaItems.slice(0, 1), // At least one item to make it valid
  };
}

/**
 * Create port-detail entry in Strapi
 */
async function createPortDetailEntry(portData, locale = 'en', documentId = null) {
  try {
    const pageSlug = generateSlug(portData.pageName, locale);
    
    // For English entries, check if already exists
    if (locale === 'en') {
      if (await entryExists(pageSlug)) {
        console.log(`  ⏭ Skipped ${portData.pageName} (already exists)`);
        return null;
      }
    }

    // Build components array
    const components = [];

    // 1. Add Hero Banner
    components.push(buildHeroBanner(portData.hero, locale));

    // 2. Add Content Sections (Image & Text)
    portData.contentSections.forEach((section, index) => {
      components.push(buildImageTextSection(section, index));
    });

    // 3. Add Important Points (Tips)
    if (portData.tips.items.length > 0) {
      components.push(buildImportantPoints(portData.tips, portData.climate));
    }

    // 4. Add Climate Section (as Image & Text section with climate styling)
    const climateSection = buildClimateSection(portData.climate);
    if (climateSection) {
      components.push(climateSection);
    }

    // 5. Add Activities Section
    const activitiesSection = buildActivitiesSection(portData.activities);
    if (activitiesSection) {
      components.push(activitiesSection);
    }

    // 6. Add Gallery (placeholder - images need separate upload)
    if (portData.gallery.images.length > 0) {
      components.push(buildGallery(portData.gallery));
    }

    // Build entry data
    const entryData = {
      page_name: portData.pageName,
      page_slug: pageSlug,
      components: components,
      has_transportation: false,
      publishedAt: new Date().toISOString(),
    };

    // Create or update entry based on locale
    let createdEntry;
    if (locale === 'en') {
      createdEntry = await strapi.documents('api::port-detail.port-detail').create({
        data: entryData,
        locale: 'en',
      });
      console.log(`  ✓ Created ${locale.toUpperCase()} entry: ${portData.pageName} (slug: ${pageSlug}, ID: ${createdEntry.documentId})`);
    } else if (locale === 'ar' && documentId) {
      delete entryData.publishedAt;
      
      createdEntry = await strapi.documents('api::port-detail.port-detail').update({
        documentId: documentId,
        data: entryData,
        locale: 'ar',
      });
      console.log(`  ✓ Created ${locale.toUpperCase()} localization: ${portData.pageName} (documentId: ${documentId})`);
    } else {
      throw new Error(`Invalid locale or missing documentId: locale=${locale}, documentId=${documentId}`);
    }

    return createdEntry;
  } catch (error) {
    console.error(`  ✗ Error creating entry for ${portData.pageName}:`, error.message);
    if (error.details) {
      console.error('    Details:', JSON.stringify(error.details, null, 2));
    }
    throw error;
  }
}

/**
 * Group HTML files by base name
 */
function groupFilesByBaseName(files) {
  const grouped = {};
  
  for (const file of files) {
    const match = file.match(/^(.+?)-(en|ar)\.html$/);
    
    if (match) {
      const baseName = match[1];
      const locale = match[2];
      
      if (!grouped[baseName]) {
        grouped[baseName] = {};
      }
      grouped[baseName][locale] = file;
    } else {
      const baseName = file.replace(/\.html$/, '');
      if (!grouped[baseName]) {
        grouped[baseName] = {};
      }
      grouped[baseName]['en'] = file;
    }
  }
  
  return grouped;
}

/**
 * Export parsed data to JSON for reference
 */
function exportDataToJson(allData, outputPath) {
  try {
    fs.writeJsonSync(outputPath, allData, { spaces: 2 });
    console.log(`\n✓ Exported parsed data to: ${outputPath}`);
  } catch (error) {
    console.error(`✗ Failed to export data: ${error.message}`);
  }
}

/**
 * Main import function
 */
async function importPorts(options = { dryRun: false }) {
  const portsDir = path.join(process.cwd(), 'jease-data', 'ports');

  if (!fs.existsSync(portsDir)) {
    console.error(`Error: Ports directory not found at ${portsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(portsDir).filter(file => file.endsWith('.html'));
  
  if (files.length === 0) {
    console.log('No HTML files found in ports directory.');
    return;
  }

  const groupedFiles = groupFilesByBaseName(files);
  const baseNames = Object.keys(groupedFiles);

  console.log(`Found ${files.length} HTML file(s) grouped into ${baseNames.length} port(s) to process.`);
  if (options.dryRun) {
    console.log('DRY RUN MODE: No entries will be created.\n');
  } else {
    console.log('');
  }
  
  // Store all parsed data for export
  const allParsedData = [];

  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errors = [];

  for (let i = 0; i < baseNames.length; i++) {
    const baseName = baseNames[i];
    const fileGroup = groupedFiles[baseName];
    
    console.log(`\n[${i + 1}/${baseNames.length}] Processing: ${baseName}`);
    console.log('─'.repeat(50));

    try {
      let documentId = null;
      const parsedEntry = { baseName, en: null, ar: null };

      // Process English file first
      if (fileGroup.en) {
        const enFilePath = path.join(portsDir, fileGroup.en);
        console.log(`  Processing English: ${fileGroup.en}`);
        
        const portData = parsePortHTML(enFilePath);
        parsedEntry.en = portData;
        
        if (!portData.pageName) {
          console.log(`  ⚠ No page name found in ${fileGroup.en}, skipping...`);
          totalSkipped++;
          allParsedData.push(parsedEntry);
          continue;
        }

        if (options.dryRun) {
          console.log(`  [DRY RUN] Would create English entry: ${portData.pageName}`);
          console.log(`    Hero: ${portData.hero.title}`);
          console.log(`    Content Sections: ${portData.contentSections.length}`);
          console.log(`    Tips: ${portData.tips.items.length}`);
          console.log(`    Gallery Images: ${portData.gallery.images.length}`);
          console.log(`    Image URLs: ${portData.imageUrls.length}`);
          totalSuccess++;
        } else {
          console.log(`  Creating English entry...`);
          const enEntry = await createPortDetailEntry(portData, 'en');
          
          if (enEntry === null) {
            totalSkipped++;
            allParsedData.push(parsedEntry);
            continue;
          } else {
            documentId = enEntry.documentId;
            totalSuccess++;
          }
        }
      } else {
        console.log(`  ⚠ No English file found for ${baseName}, skipping...`);
        totalSkipped++;
        allParsedData.push(parsedEntry);
        continue;
      }

      // Process Arabic file as localization
      if (fileGroup.ar) {
        const arFilePath = path.join(portsDir, fileGroup.ar);
        console.log(`  Processing Arabic: ${fileGroup.ar}`);
        
        const portData = parsePortHTML(arFilePath);
        parsedEntry.ar = portData;
        
        if (portData.pageName) {
          if (options.dryRun) {
            console.log(`  [DRY RUN] Would create Arabic localization: ${portData.pageName}`);
          } else if (documentId) {
            console.log(`  Creating Arabic localization...`);
            const arEntry = await createPortDetailEntry(portData, 'ar', documentId);
            
            if (arEntry) {
              console.log(`  ✓ Arabic localization created successfully`);
            }
          }
        } else {
          console.log(`  ⚠ No page name found in ${fileGroup.ar}`);
        }
      }

      allParsedData.push(parsedEntry);

    } catch (error) {
      console.error(`  ✗ Failed to import ${baseName}:`, error.message);
      errors.push({ base: baseName, error: error.message });
      totalErrors++;
    }
  }

  // Export parsed data to JSON for reference
  const outputPath = path.join(process.cwd(), 'jease-data', 'ports', 'parsed-data.json');
  exportDataToJson(allParsedData, outputPath);

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`=== Import Summary ===`);
  console.log(`Total ports processed: ${baseNames.length}`);
  console.log(`Total files processed: ${files.length}`);
  console.log(`✓ Successfully created: ${totalSuccess}`);
  console.log(`⏭ Skipped (already exists): ${totalSkipped}`);
  console.log(`✗ Errors: ${totalErrors}`);
  
  if (errors.length > 0) {
    console.log(`\nErrors details:`);
    errors.forEach(({ base, error }) => {
      console.log(`  - ${base}: ${error}`);
    });
  }
}

/**
 * Main execution
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const parseOnly = args.includes('--parse-only') || args.includes('-p');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Port Details Import Script
===========================

Usage: node scripts/import-ports.js [options]

Options:
  --dry-run, -d     Preview what would be imported without creating entries
  --parse-only, -p  Only parse HTML files and export JSON (no Strapi needed)
  --help, -h        Show this help message

Examples:
  node scripts/import-ports.js --dry-run     Preview import
  node scripts/import-ports.js --parse-only  Parse and export JSON only
  node scripts/import-ports.js               Full import to Strapi
`);
    process.exit(0);
  }

  console.log('='.repeat(50));
  console.log('Port Details Import Script');
  console.log('='.repeat(50));
  
  if (parseOnly) {
    // Parse-only mode doesn't need Strapi
    console.log('\nMode: Parse Only (no Strapi connection)\n');
    
    // Create a mock strapi object for entryExists check
    global.strapi = {
      documents: () => ({
        findMany: async () => [],
        create: async (data) => ({ documentId: 'mock-id', ...data.data }),
        update: async (data) => ({ documentId: data.documentId, ...data.data }),
      }),
    };
    
    await importPorts({ dryRun: true });
    process.exit(0);
  }
  
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  console.log('\nCompiling Strapi...');
  const appContext = await compileStrapi();
  
  console.log('Creating Strapi instance...');
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';
  global.strapi = app;

  try {
    await importPorts({ dryRun });
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  parsePortHTML,
  convertToRichText,
  generateSlug,
  createPortDetailEntry,
  importPorts,
};

