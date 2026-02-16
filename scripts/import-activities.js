'use strict';

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

/**
 * Parse HTML file and extract activity entries and page name
 * Each activity is in a .swiper-slide.shorex-popup__item section
 */
function parseActivitiesHTML(htmlFilePath) {
  const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
  const $ = cheerio.load(htmlContent);
  const activities = [];
  
  // Extract page name from title tag or meta tags
  let pageName = 'Jeddah'; // Default
  const titleTag = $('title').text().trim();
  if (titleTag) {
    // Extract name from title (e.g., "Jeddah | AROYA Cruises" -> "Jeddah")
    const titleMatch = titleTag.match(/^([^|]+)/);
    if (titleMatch) {
      pageName = titleMatch[1].trim();
    }
  }

  // Find all activity card slides first (to get short descriptions and "Learn more" button text)
  const cardSlides = [];
  $('.shorex_item-slide.js-trigger-button').each((index, element) => {
    const $card = $(element);
    const cardTitle = $card.find('h3').first().text().trim();
    const cardShortDesc = $card.find('.shorex_item-slide__body_description').first().text().trim();
    
    // Extract "Learn more" button text from card slide
    // Try multiple selectors to find the button
    let learnMoreText = 'Learn more'; // Default fallback
    let cardButton = $card.find('button.shorex_item-slide__link.main-btn').first();
    if (cardButton.length === 0) {
      cardButton = $card.find('button.main-btn.main-btn--light-blue').first();
    }
    if (cardButton.length === 0) {
      cardButton = $card.find('.shorex_item-slide__link.main-btn').first();
    }
    if (cardButton.length === 0) {
      cardButton = $card.find('.main-btn.main-btn--light-blue').first();
    }
    
    if (cardButton.length > 0) {
      // Get the text content, handling whitespace and newlines
      const btnText = cardButton.text().trim().replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
      // Only use if it's not "Book Now" or empty
      if (btnText && 
          btnText.toLowerCase() !== 'book now' && 
          btnText.toLowerCase() !== 'احجز الآن' &&
          btnText.length > 0) {
        learnMoreText = btnText;
      }
    }
    
    if (cardTitle) {
      cardSlides.push({
        title: cardTitle,
        short_description: cardShortDesc || null,
        learn_more_text: learnMoreText
      });
    }
  });

  // Find all activity popup items
  $('.swiper-slide.shorex-popup__item').each((index, element) => {
    const $activity = $(element);
    
    // Extract title
    const title = $activity.find('.shorex-popup__item-content-header p').first().text().trim() ||
                  $activity.find('.shorex-popup__item-mobile-header p').first().text().trim() ||
                  $activity.find('h3').first().text().trim();
    
    if (!title) {
      return; // Skip if no title found
    }

    // Find matching card slide to get short description
    const matchingCard = cardSlides.find(card => card.title === title);

    // Extract duration - get the full text including prefix (e.g., "Duration 4" or "لمدة 4")
    const durationElement = $activity.find('.shorex_item-slide__body_details-duration span').last();
    const durationText = durationElement.text().trim().replace(/\s+/g, ' '); // Normalize whitespace
    
    // Extract number from text (handles "Duration\n4", "لمدة\n4", "Duration 4", "لمدة 4", or "4" formats)
    const durationMatch = durationText.match(/(\d+(?:\.\d+)?)/);
    const duration = durationMatch ? durationMatch[1] : null;
    
    // Extract the prefix text (everything before the number)
    let durationPrefix = durationText.replace(/\d+(?:\.\d+)?.*$/, '').trim();
    
    // If no prefix found, try to detect from the text content
    if (!durationPrefix && duration) {
      // Check if text contains Arabic characters
      const hasArabic = /[\u0600-\u06FF]/.test(durationText);
      durationPrefix = hasArabic ? 'لمدة' : 'Duration';
    }
    
    // Build duration string with proper format
    const durationString = duration && durationPrefix ? `${durationPrefix} ${duration}` : (duration ? `Duration ${duration}` : null);

    // Extract level
    const level = $activity.find('.shorex_item-slide__body_details-level span').last().text().trim() || null;

    // Extract short description from matching card slide
    const shortDescription = matchingCard ? matchingCard.short_description : null;

    // Extract long description (combine description + includes list)
    // This is the detailed description from the popup detail view
    let longDescription = '';
    
    // Main description paragraph from popup detail
    const mainDesc = $activity.find('.shorex_item-slide__body_description_text').first().text().trim();
    if (mainDesc) {
      longDescription += mainDesc + '\n\n';
    }

    // "Includes the following" section
    const includesSection = $activity.find('.shorex_item-slide__body_description_list-check').first();
    const includesTitle = includesSection.find('span').first().text().trim();
    const includesList = includesSection.find('ul.with-checkmarks li');
    
    if (includesList.length > 0) {
      if (includesTitle && includesTitle.toLowerCase().includes('includes')) {
        longDescription += `**${includesTitle}**\n\n`;
      }
      includesList.each((i, li) => {
        const itemText = $(li).find('.shorex_item-slide__body_description_list-check-text').text().trim();
        if (itemText) {
          longDescription += `- ${itemText}\n`;
        }
      });
    }

    // Extract important info section
    const importantInfoSection = $activity.find('.shorex_item-slide__body_description_important-advices');
    const hasImportantInfo = importantInfoSection.length > 0;
    
    let impHeading = null;
    let essentialsTitle = null;
    const essentialPoints = [];

    if (hasImportantInfo) {
      // Extract heading
      impHeading = importantInfoSection.find('.advice-section-headline span').last().text().trim() || null;
      
      // Extract essentials
      const essentialsSection = importantInfoSection.find('.advice-section-foldable').first();
      essentialsTitle = essentialsSection.find('.advice-section-foldable-headline span').first().text().trim() || null;
      
      // Extract essential points (text only, no images)
      essentialsSection.find('.aligned-icon-text').each((i, item) => {
        let pointText = $(item).find('span').text().trim();
        
        // Fix common HTML entity issues: add space after & if missing
        // e.g., "Cash &Credit Card" -> "Cash & Credit Card"
        pointText = pointText.replace(/&([A-Za-z])/g, '& $1');
        
        // Also fix other common spacing issues with HTML entities
        pointText = pointText.replace(/\s+/g, ' '); // Normalize multiple spaces to single space
        
        if (pointText) {
          essentialPoints.push({
            image: [], // Skip images for now
            point_description: pointText
          });
        }
      });
    }

    // Extract CTA button (try multiple selectors)
    let ctaButton = $activity.find('.main-btn.main-btn--light-blue').first();
    if (ctaButton.length === 0) {
      ctaButton = $activity.find('.shorex_item-slide__link.main-btn').first();
    }
    if (ctaButton.length === 0) {
      ctaButton = $activity.find('a.main-btn').first();
    }
    const ctaText = ctaButton.length > 0 ? ctaButton.text().trim().replace(/\s+/g, ' ') : null;
    const ctaUrl = ctaButton.length > 0 ? (ctaButton.attr('href') || '#') : null;
    
    // Extract "Learn more" button text from matching card slide (for proper localization)
    const learnMoreText = matchingCard && matchingCard.learn_more_text ? matchingCard.learn_more_text : 'Learn more';

    activities.push({
      title,
      duration: durationString,
      level,
      short_description: shortDescription,
      long_description: longDescription.trim() || null,
      has_important_info: hasImportantInfo,
      imp_heading: impHeading,
      essentials_title: essentialsTitle,
      essential_points: essentialPoints,
      cta_text: ctaText,
      cta_url: ctaUrl,
      learn_more_text: learnMoreText, // Store the localized "Learn more" text
    });
  });

  console.log(`Parsed ${activities.length} activities from HTML`);
  return { activities, pageName };
}

/**
 * Convert plain text to Markdown format for Strapi richtext Markdown field
 */
function convertToRichText(text) {
  if (!text || !text.trim()) {
    return null;
  }

  // Convert bullet character (•) to Markdown bullet syntax (- )
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
    // For Arabic: preserve Arabic characters, convert spaces to dashes
    return title
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/[^\p{L}\p{N}-]/gu, '') // Remove special chars, keep Unicode letters/numbers and dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  } else {
    // For English: standard slug generation
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  }
}

/**
 * Find folder by path (supports nested folders like "Experiences/Mediterranean")
 */
async function findFolderByPath(folderPath) {
  const pathParts = folderPath.split('/').filter(part => part.trim());
  
  if (pathParts.length === 0) {
    return null;
  }

  let currentFolder = null;
  
  for (let i = 0; i < pathParts.length; i++) {
    const folderName = pathParts[i].trim();
    
    const folder = await strapi.query('plugin::upload.folder').findOne({
      where: {
        name: folderName,
        parent: currentFolder ? currentFolder.id : null,
      },
    });
    
    if (!folder) {
      return null; // Folder not found
    }
    
    currentFolder = folder;
  }
  
  return currentFolder;
}

/**
 * Load all images from Media Library folder path
 * Returns a map of filename (without extension) to file object
 */
async function loadImagesFromFolder(folderPath) {
  try {
    const folder = await findFolderByPath(folderPath);
    
    if (!folder) {
      console.log(`  ⚠ Warning: Folder "${folderPath}" not found in Media Library`);
      return new Map();
    }
    
    // Get all files in this folder
    const files = await strapi.query('plugin::upload.file').findMany({
      where: {
        folder: folder.id,
      },
    });
    
    // Create a map: filename (without extension) -> file object
    const imageMap = new Map();
    
    for (const file of files) {
      // Get filename without extension - try multiple fields
      let fileNameWithoutExt = '';
      if (file.name) {
        // Remove extension if present
        fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      } else if (file.hash) {
        fileNameWithoutExt = file.hash;
      } else if (file.url) {
        // Extract filename from URL
        const urlParts = file.url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      }
      
      if (fileNameWithoutExt) {
        // Store with lowercase key for case-insensitive matching
        imageMap.set(fileNameWithoutExt.toLowerCase(), file);
        // Also store with original case for exact matches
        if (fileNameWithoutExt.toLowerCase() !== fileNameWithoutExt) {
          imageMap.set(fileNameWithoutExt, file);
        }
      }
    }
    
    console.log(`  ✓ Loaded ${imageMap.size} images from "${folderPath}"`);
    return imageMap;
  } catch (error) {
    console.error(`  ✗ Error loading images from "${folderPath}":`, error.message);
    return new Map();
  }
}

/**
 * Map point description text to image filename
 * This function tries to match the point description to known image filenames
 */
function mapPointDescriptionToImage(pointDescription, imageMap) {
  if (!pointDescription || !imageMap || imageMap.size === 0) {
    return null;
  }
  
  const descLower = pointDescription.toLowerCase().trim();
  
  // Create a mapping of keywords to image filename patterns
  // Order matters - more specific matches should come first
  // Includes both English and Arabic keywords
  const keywordMappings = [
    // Cash & Credit Card - requires "cash" AND ("credit" OR "card")
    { 
      keywords: ['cash', 'credit', 'card', 'payment', 'money', 'نقود', 'بطاقة', 'ائتمانية', 'الائتمانية', 'والبطاقة'], 
      pattern: 'ac_addon_icons_website_cash-or-credit',
      requireAll: ['cash', 'نقود'], // Must have "cash" or "نقود"
      requireAny: ['credit', 'card', 'payment', 'بطاقة', 'ائتمانية', 'الائتمانية', 'والبطاقة'] // And at least one of these
    },
    // Passport & ID - requires "passport" AND "id"
    { 
      keywords: ['passport', 'id', 'identification', 'document', 'جواز', 'السفر', 'هوية', 'الهوية'], 
      pattern: 'ac_addon_icons_website_passport-id',
      requireAll: ['passport', 'جواز', 'السفر'], // Must have passport or جواز or السفر
      requireAny: ['id', 'identification', 'هوية', 'الهوية'] // And at least one of these
    },
    // Water Shoes - specific phrase
    { keywords: ['water shoes', 'water shoe', 'aquatic shoes', 'أحذية', 'مائية'], pattern: 'ac_addon_icons_website_water-shoes' },
    // Beach Toys - specific phrase
    { keywords: ['beach toys', 'beach', 'bucket', 'shovel', 'ألعاب', 'الشاطئ'], pattern: 'ac_addon_icons_website_beach-toys' },
    // Tanning Oil - specific phrase
    { keywords: ['tanning oil', 'tanning', 'زيت', 'التسمير'], pattern: 'ac_addon_icons_website_tanning-oil' },
    // Extra Clothes - specific phrase
    { keywords: ['extra clothes', 'extra clothing', 'spare clothes', 'ملابس إضافية', 'ملابس', 'إضافية'], pattern: 'ac_addon_icons_website_extra-clothes' },
    // Weather Appropriate Clothes - specific phrase
    { keywords: ['weather appropriate', 'weather', 'appropriate clothes', 'ملابس', 'مناسبة', 'للطقس'], pattern: 'ac_addon_icons_website_weather-appropriate-clothes' },
    // Respectful Attire - specific phrase
    { keywords: ['respectful attire', 'respectful', 'modest', 'ملابس', 'محتشمة'], pattern: 'ac_addon_icons_website_respectful-attire' },
    // Comfortable Shoes - specific phrase
    { keywords: ['comfortable shoes', 'walking shoes', 'sneakers', 'أحذية', 'مريحة'], pattern: 'ac_addon_icons_website_comfortable-shoes' },
    // Casual Wear - specific phrase
    { keywords: ['casual wear', 'casual clothing', 'ملابس مريحة', 'ملابس', 'مريحة'], pattern: 'ac_addon_icons_website_casual-wear' },
    // Phone Case - specific phrase
    { keywords: ['phone case', 'mobile case', 'غطاء', 'الهاتف'], pattern: 'ac_addon_icons_website_phone-case' },
    // Sunscreen - specific phrase
    { keywords: ['sunscreen', 'sun screen', 'spf', 'sun protection', 'واقي', 'الشمس'], pattern: 'ac_addon_icons_website_sun-screen' },
    // Sunglasses - specific phrase
    { keywords: ['sunglasses', 'sun glasses', 'نظارات شمسية', 'نظارات', 'شمسية'], pattern: 'ac_addon_icons_website_sun-glasses' },
    // Sunscreen - specific phrase
    { keywords: ['sunscreen', 'sun screen', 'spf', 'sun protection', 'واقي الشمس', 'واقي', 'الشمس'], pattern: 'ac_addon_icons_website_sun-screen' },
    // Swimwear - specific phrase
    { keywords: ['swimwear', 'swim wear', 'bathing suit', 'swimsuit', 'ملابس سباحة', 'ملابس', 'سباحة'], pattern: 'ac_addon_icons_website_swimwear' },
    // Camera - single word, but specific
    { keywords: ['camera', 'photo', 'photography', 'كاميرا'], pattern: 'ac_addon_icons_website_camera' },
    // Hat - single word, but specific
    { keywords: ['hat', 'cap', 'sun hat', 'قبعة'], pattern: 'ac_addon_icons_website_hat' },
  ];
  
  // Try to find a match based on keywords
  for (const mapping of keywordMappings) {
    let matches = false;
    
    // If requireAll is specified, check that all required keywords are present
    if (mapping.requireAll && mapping.requireAll.length > 0) {
      // For requireAll, check if ANY of the required keywords match (OR logic, not AND)
      // This allows matching either English or Arabic
      const hasAllRequired = mapping.requireAll.some(keyword => descLower.includes(keyword));
      if (!hasAllRequired) {
        continue; // Skip this mapping if no required keywords are present
      }
      
      // If requireAny is specified, check that at least one is present
      if (mapping.requireAny && mapping.requireAny.length > 0) {
        const hasAny = mapping.requireAny.some(keyword => descLower.includes(keyword));
        if (!hasAny) {
          continue; // Skip if none of the optional keywords are present
        }
        matches = true;
      } else {
        matches = true;
      }
    } else {
      // Standard matching: check if any keyword matches
      matches = mapping.keywords.some(keyword => descLower.includes(keyword));
    }
    
    if (matches) {
      const image = imageMap.get(mapping.pattern);
      if (image) {
        return image;
      }
    }
  }
  
  // Fallback: try to match by removing special characters and spaces from description
  const normalizedDesc = descLower
    .replace(/[&]/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  // Try exact match first
  let image = imageMap.get(normalizedDesc);
  if (image) {
    return image;
  }
  
  // Try with prefix
  const withPrefix = `ac_addon_icons_website_${normalizedDesc}`;
  image = imageMap.get(withPrefix);
  if (image) {
    return image;
  }
  
  // Try partial matches
  for (const [fileName, file] of imageMap.entries()) {
    if (fileName.includes(normalizedDesc) || normalizedDesc.includes(fileName)) {
      return file;
    }
  }
  
  return null;
}

/**
 * Cache for images loaded from Media Library
 */
let imagesCache = null;

/**
 * Get images from Media Library folder (cached)
 */
async function getEssentialsImages() {
  if (imagesCache === null) {
    imagesCache = await loadImagesFromFolder('Experiences/Mediterranean');
  }
  return imagesCache;
}

/**
 * Find the important_to_know.svg logo image
 */
async function getImportantLogo() {
  const imageMap = await getEssentialsImages();
  const logo = imageMap.get('important_to_know');
  if (logo) {
    return logo.id;
  }
  return null;
}

/**
 * Check if destination activity entry already exists by page_slug
 */
async function entryExists(pageSlug) {
  try {
    const existingEntries = await strapi.documents('api::destination-activity.destination-activity').findMany({
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
 * Create destination activity entry in Strapi
 */
async function createDestinationActivityEntry(activity) {
  try {
    const pageSlug = generateSlug(activity.title);
    
    // Check if entry already exists
    if (await entryExists(pageSlug)) {
      console.log(`  ⏭ Skipped ${activity.title} (already exists)`);
      return null;
    }

    // Build card details component
    // Ensure richtext fields are always strings (never null)
    const cardDetails = {
      title: (convertToRichText(activity.title) || activity.title || '').toString(),
      duration: activity.duration || null,
      level: activity.level || null,
      short_description: (convertToRichText(activity.short_description) || activity.short_description || '').toString(),
      long_description: (convertToRichText(activity.long_description) || '').toString(),
      has_important_info: activity.has_important_info || false,
    };

    // Add conditional fields if important info exists
    if (activity.has_important_info) {
      // Add important logo
      const logoId = await getImportantLogo();
      if (logoId) {
        cardDetails.imp_logo = [logoId];
      }
      
      if (activity.imp_heading) {
        cardDetails.imp_heading = activity.imp_heading;
      }
      
      // Build essentials component if we have points
      if (activity.essential_points && activity.essential_points.length > 0) {
        // Load images from Media Library
        const imageMap = await getEssentialsImages();
        
        const essentialPoints = activity.essential_points.map(point => {
          const pointData = {
            point_description: (convertToRichText(point.point_description) || point.point_description || '').toString()
          };
          
          // Try to find matching image
          const matchedImage = mapPointDescriptionToImage(point.point_description, imageMap);
          if (matchedImage) {
            pointData.image = [matchedImage.id];
          }
          
          return pointData;
        });
        
        if (essentialPoints.length > 0) {
          cardDetails.essentials = [{
            title: (convertToRichText(activity.essentials_title) || activity.essentials_title || '').toString(),
            points: essentialPoints
          }];
        }
      }
    }

    // Remove null/undefined fields to avoid validation errors (but keep richtext fields even if empty)
    // Richtext fields should always be strings, so we check for null/undefined specifically
    if (cardDetails.long_description === null || cardDetails.long_description === undefined) {
      delete cardDetails.long_description;
    }
    if (cardDetails.short_description === null || cardDetails.short_description === undefined) {
      delete cardDetails.short_description;
    }
    if (cardDetails.title === null || cardDetails.title === undefined) {
      delete cardDetails.title;
    }
    if (!cardDetails.duration) {
      delete cardDetails.duration;
    }
    if (!cardDetails.level) {
      delete cardDetails.level;
    }

    // Build destination feature card component
    const destinationFeatureCard = {
      __component: 'destinations.destination-feature-card',
      title: (convertToRichText(activity.title) || activity.title || '').toString(),
      card_details: [cardDetails],
    };

    // Add CTA button if available (only if both text and URL exist)
    if (activity.cta_text && activity.cta_url && activity.cta_url !== '#') {
      destinationFeatureCard.cta = [{
        text: activity.cta_text,
        link_url: activity.cta_url,
        // Omit color fields - they're optional
      }];
    }

    // Build entry data
    const entryData = {
      page_name: activity.title,
      page_slug: pageSlug,
      components: [destinationFeatureCard],
      publishedAt: new Date().toISOString(),
    };

    // Debug: Log the entry data structure (first 500 chars)
    console.log(`  Debug: Entry data structure:`, JSON.stringify(entryData, null, 2).substring(0, 500));

    // Create English entry
    const createdEntry = await strapi.documents('api::destination-activity.destination-activity').create({
      data: entryData,
      locale: 'en',
    });

    console.log(`  ✓ Created entry: ${activity.title} (slug: ${pageSlug}, ID: ${createdEntry.documentId})`);
    return createdEntry;
  } catch (error) {
    console.error(`  ✗ Error creating entry for ${activity.title}:`, error.message);
    console.error(`  Error stack:`, error.stack);
    if (error.details) {
      console.error('    Details:', JSON.stringify(error.details, null, 2));
    }
    // Log the entry data that failed
    try {
      const pageSlug = generateSlug(activity.title);
      console.error(`  Failed entry data (first 1000 chars):`, JSON.stringify({
        page_name: activity.title,
        page_slug: pageSlug,
        // ... truncated for logging
      }, null, 2).substring(0, 1000));
    } catch (e) {
      // Ignore logging errors
    }
    throw error;
  }
}

/**
 * Create a single destination activity entry with all activities as card_details
 * @param {Array} activities - Array of activity objects
 * @param {String} pageName - Page name for the entry
 * @param {String} locale - Locale code ('en' or 'ar')
 * @param {String} documentId - Optional documentId for creating localization
 */
async function createDestinationActivityWithAllCards(activities, pageName = 'Jeddah', locale = 'en', documentId = null) {
  try {
    const pageSlug = generateSlug(pageName, locale);
    
    // For English entries, check if already exists
    if (locale === 'en') {
      if (await entryExists(pageSlug)) {
        console.log(`  ⏭ Skipped ${pageName} (already exists)`);
        return null;
      }
    }

    // Load images from Media Library once for all activities
    const imageMap = await getEssentialsImages();
    
    // Load important logo once for all activities
    const logoId = await getImportantLogo();

    // Build all card_details from activities
    const cardDetailsArray = activities.map((activity) => {
      // Build card details component for each activity
      const cardDetails = {
        title: (convertToRichText(activity.title) || activity.title || '').toString(),
        duration: activity.duration || null,
        level: activity.level || null,
        short_description: (convertToRichText(activity.short_description) || activity.short_description || '').toString(),
        long_description: (convertToRichText(activity.long_description) || '').toString(),
        has_important_info: activity.has_important_info || false,
      };

      // Add conditional fields if important info exists
      if (activity.has_important_info) {
        // Add important logo
        if (logoId) {
          cardDetails.imp_logo = [logoId];
        }
        
        if (activity.imp_heading) {
          cardDetails.imp_heading = activity.imp_heading;
        }
        
        // Build essentials component if we have points
        if (activity.essential_points && activity.essential_points.length > 0) {
          const essentialPoints = activity.essential_points.map(point => {
            const pointData = {
              point_description: (convertToRichText(point.point_description) || point.point_description || '').toString()
            };
            
            // Try to find matching image
            const matchedImage = mapPointDescriptionToImage(point.point_description, imageMap);
            if (matchedImage) {
              pointData.image = [matchedImage.id];
            }
            
            return pointData;
          });
          
          if (essentialPoints.length > 0) {
            cardDetails.essentials = [{
              title: (convertToRichText(activity.essentials_title) || activity.essentials_title || '').toString(),
              points: essentialPoints
            }];
          }
        }
      }

      // Remove null/undefined fields to avoid validation errors (but keep richtext fields even if empty)
      if (cardDetails.long_description === null || cardDetails.long_description === undefined) {
        delete cardDetails.long_description;
      }
      if (cardDetails.short_description === null || cardDetails.short_description === undefined) {
        delete cardDetails.short_description;
      }
      if (cardDetails.title === null || cardDetails.title === undefined) {
        delete cardDetails.title;
      }
      if (!cardDetails.duration) {
        delete cardDetails.duration;
      }
      if (!cardDetails.level) {
        delete cardDetails.level;
      }

      // Add CTAs - always add "Learn more" and "Book Now" if available
      cardDetails.cta = [];
      
      // Add "Learn more" CTA (use localized text from activity)
      const learnMoreText = activity.learn_more_text || 'Learn more';
      cardDetails.cta.push({
        text: learnMoreText,
        link_url: '#',
      });
      
      // Add "Book Now" CTA if available
      if (activity.cta_text && activity.cta_url && activity.cta_url !== '#') {
        const truncatedText = activity.cta_text.length > 255
          ? activity.cta_text.substring(0, 255)
          : activity.cta_text;
        
        cardDetails.cta.push({
          text: truncatedText,
          link_url: '#',
        });
      }

      return cardDetails;
    });

    // Build destination feature card component with all card_details
    const destinationFeatureCard = {
      __component: 'destinations.destination-feature-card',
      title: (convertToRichText(pageName) || pageName || '').toString(),
      card_details: cardDetailsArray,
    };

    // Collect all CTAs from activities (if any should be at the top level)
    // For now, CTAs are in card_details, so we don't need top-level CTA
    
    // Note: CTAs are added within each card_details entry, not at the top level

    // Build entry data
    const entryData = {
      page_name: pageName,
      page_slug: pageSlug,
      components: [destinationFeatureCard],
      publishedAt: new Date().toISOString(),
    };


    // Create or update entry based on locale
    let createdEntry;
    if (locale === 'en') {
      // Create English entry
      createdEntry = await strapi.documents('api::destination-activity.destination-activity').create({
        data: entryData,
        locale: 'en',
      });
      console.log(`  ✓ Created ${locale.toUpperCase()} entry: ${pageName} (slug: ${pageSlug}, ID: ${createdEntry.documentId}) with ${cardDetailsArray.length} activities`);
    } else if (locale === 'ar' && documentId) {
      // Create Arabic localization using the same documentId
      // Remove publishedAt for update
      delete entryData.publishedAt;
      
      createdEntry = await strapi.documents('api::destination-activity.destination-activity').update({
        documentId: documentId,
        data: entryData,
        locale: 'ar',
      });
      console.log(`  ✓ Created ${locale.toUpperCase()} localization: ${pageName} (same documentId: ${documentId}) with ${cardDetailsArray.length} activities`);
    } else {
      throw new Error(`Invalid locale or missing documentId for localization: locale=${locale}, documentId=${documentId}`);
    }

    return createdEntry;
  } catch (error) {
    console.error(`  ✗ Error creating entry for ${pageName}:`, error.message);
    console.error(`  Error stack:`, error.stack);
    if (error.details) {
      console.error('    Details:', JSON.stringify(error.details, null, 2));
    }
    throw error;
  }
}

/**
 * Group HTML files by base name (e.g., jeddah1-en.html and jeddah1-ar.html -> jeddah1)
 */
function groupFilesByBaseName(files) {
  const grouped = {};
  
  for (const file of files) {
    // Extract base name and locale from filename pattern: name-locale.html
    // Examples: jeddah1-en.html -> { base: 'jeddah1', locale: 'en' }
    //           jeddah1-ar.html -> { base: 'jeddah1', locale: 'ar' }
    const match = file.match(/^(.+?)-(en|ar)\.html$/);
    
    if (match) {
      const baseName = match[1];
      const locale = match[2];
      
      if (!grouped[baseName]) {
        grouped[baseName] = {};
      }
      grouped[baseName][locale] = file;
    } else {
      // Handle files without locale suffix (legacy support)
      const baseName = file.replace(/\.html$/, '');
      if (!grouped[baseName]) {
        grouped[baseName] = {};
      }
      grouped[baseName]['en'] = file; // Default to English
    }
  }
  
  return grouped;
}

/**
 * Main import function - processes all HTML files in the activities directory
 */
async function importActivities() {
  const activitiesDir = path.join(process.cwd(), 'jease-data', 'activities');

  if (!fs.existsSync(activitiesDir)) {
    console.error(`Error: Activities directory not found at ${activitiesDir}`);
    process.exit(1);
  }

  // Find all HTML files in the activities directory
  const files = fs.readdirSync(activitiesDir).filter(file => file.endsWith('.html'));
  
  if (files.length === 0) {
    console.log('No HTML files found in activities directory.');
    return;
  }

  // Group files by base name (e.g., jeddah1-en.html + jeddah1-ar.html -> jeddah1)
  const groupedFiles = groupFilesByBaseName(files);
  const baseNames = Object.keys(groupedFiles);

  console.log(`Found ${files.length} HTML file(s) grouped into ${baseNames.length} destination(s) to process.\n`);

  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const errors = [];

  // Process each base name (destination)
  for (let i = 0; i < baseNames.length; i++) {
    const baseName = baseNames[i];
    const fileGroup = groupedFiles[baseName];
    
    console.log(`\n[${i + 1}/${baseNames.length}] Processing: ${baseName}`);
    console.log('─'.repeat(50));

    try {
      let enEntry = null;
      let arEntry = null;
      let documentId = null;

      // Process English file first
      if (fileGroup.en) {
        const enFilePath = path.join(activitiesDir, fileGroup.en);
        console.log(`  Processing English: ${fileGroup.en}`);
        
        const { activities, pageName } = parseActivitiesHTML(enFilePath);
        
        if (activities.length === 0) {
          console.log(`  ⚠ No activities found in ${fileGroup.en}, skipping...`);
          totalSkipped++;
          continue;
        }

        console.log(`  Found ${activities.length} activities for "${pageName}"`);
        console.log(`  Creating English entry...`);

        enEntry = await createDestinationActivityWithAllCards(activities, pageName, 'en');
        
        if (enEntry === null) {
          console.log(`  ⏭ English entry already exists, skipping...`);
          totalSkipped++;
          continue; // Skip Arabic if English already exists
        } else {
          documentId = enEntry.documentId;
          totalSuccess++;
        }
      } else {
        console.log(`  ⚠ No English file found for ${baseName}, skipping...`);
        totalSkipped++;
        continue;
      }

      // Process Arabic file as localization
      if (fileGroup.ar && documentId) {
        const arFilePath = path.join(activitiesDir, fileGroup.ar);
        console.log(`  Processing Arabic: ${fileGroup.ar}`);
        
        const { activities, pageName } = parseActivitiesHTML(arFilePath);
        
        if (activities.length > 0) {
          console.log(`  Found ${activities.length} activities for "${pageName}"`);
          console.log(`  Creating Arabic localization...`);

          arEntry = await createDestinationActivityWithAllCards(activities, pageName, 'ar', documentId);
          
          if (arEntry) {
            console.log(`  ✓ Arabic localization created successfully`);
          }
        } else {
          console.log(`  ⚠ No activities found in ${fileGroup.ar}`);
        }
      } else if (fileGroup.ar && !documentId) {
        console.log(`  ⚠ Arabic file found but no English entry created, skipping Arabic...`);
      }

    } catch (error) {
      console.error(`  ✗ Failed to import ${baseName}:`, error.message);
      errors.push({ base: baseName, error: error.message });
      totalErrors++;
    }
  }

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`=== Import Summary ===`);
  console.log(`Total destinations processed: ${baseNames.length}`);
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
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  console.log('Compiling Strapi...');
  const appContext = await compileStrapi();
  
  console.log('Creating Strapi instance...');
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  // Set global strapi instance
  global.strapi = app;

  try {
    await importActivities();
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
  parseActivitiesHTML,
  convertToRichText,
  generateSlug,
  createDestinationActivityEntry,
  importActivities,
};

