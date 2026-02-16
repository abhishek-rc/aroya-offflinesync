'use strict';

/**
 * Script to copy title field to card_title field in card-details component
 * 
 * Run with: node ./scripts/copy-title-to-card-title.js
 */

/**
 * Extract plain text from richtext field
 * Handles different formats: array of blocks, string (markdown/HTML), or JSON
 */
function extractPlainText(richtext) {
  if (!richtext) return '';
  
  // If it's already a string, return it (might be markdown or HTML)
  if (typeof richtext === 'string') {
    // Remove markdown/HTML tags and return plain text
    return richtext
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove markdown links, keep text
      .replace(/#+\s*/g, '') // Remove markdown headers
      .replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold markdown
      .replace(/\*([^\*]+)\*/g, '$1') // Remove italic markdown
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // If it's an array (blocks structure)
  if (Array.isArray(richtext)) {
    const stack = [...richtext];
    const parts = [];

    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;

      if (typeof node.text === 'string') {
        parts.push(node.text);
      }

      if (Array.isArray(node.children)) {
        stack.push(...node.children);
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  
  // If it's an object, try to extract text
  if (typeof richtext === 'object') {
    // Try to find text property
    if (richtext.text) {
      return String(richtext.text).trim();
    }
    // Try to stringify and extract
    return JSON.stringify(richtext).replace(/[{}"]/g, '').trim();
  }
  
  return String(richtext).trim();
}

/**
 * Copy title to card_title in card-details components
 */
async function copyTitleToCardTitle() {
  console.log('Starting title to card_title copy...\n');
  console.log('Copying: title (richtext) -> card_title (string) in card-details component\n');

  try {
    const locales = ['en', 'ar'];
    let allActivities = [];
    
    // Get all destination activities
    for (const locale of locales) {
      try {
        const activities = await strapi.entityService.findMany('api::destination-activity.destination-activity', {
          locale: locale,
          populate: {
            components: {
              on: {
                'destinations.destination-feature-card': {
                  populate: {
                    card_details: true,
                  },
                },
              },
            },
          },
          limit: 10000,
        });
        
        if (activities && activities.length > 0) {
          activities.forEach(activity => {
            activity.locale = locale;
          });
          allActivities = allActivities.concat(activities);
        }
      } catch (err) {
        console.log(`No activities found for locale: ${locale}`);
      }
    }

    console.log(`Found ${allActivities.length} destination activities (across all locales)\n`);
    
    if (allActivities.length === 0) {
      console.log('No destination activities found in the database.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let totalCardsUpdated = 0;
    const errors = [];

    // Process each activity
    for (let i = 0; i < allActivities.length; i++) {
      const activity = allActivities[i];
      const activityId = activity.id;
      const activityLocale = activity.locale || 'en';
      const components = activity.components || [];

      // Find destination-feature-card components
      const featureCards = components.filter(comp => comp.__component === 'destinations.destination-feature-card');
      
      if (featureCards.length === 0) {
        skippedCount++;
        continue;
      }

      let needsUpdate = false;
      const updatedComponents = components.map((comp) => {
        if (comp.__component === 'destinations.destination-feature-card' && comp.card_details) {
          // Update card_details array
          const updatedCardDetails = comp.card_details.map((cardDetail) => {
            // Check if card_title is empty/null and title exists
            if ((!cardDetail.card_title || cardDetail.card_title.trim() === '') && cardDetail.title) {
              const plainText = extractPlainText(cardDetail.title);
              if (plainText) {
                needsUpdate = true;
                return {
                  ...cardDetail,
                  card_title: plainText,
                };
              }
            }
            return cardDetail;
          });

          return {
            ...comp,
            card_details: updatedCardDetails,
          };
        }
        return comp;
      });

      if (needsUpdate) {
        // Count how many cards were updated
        const cardsUpdated = featureCards.reduce((count, card) => {
          return count + (card.card_details || []).filter(cd => 
            (!cd.card_title || cd.card_title.trim() === '') && cd.title
          ).length;
        }, 0);
        
        totalCardsUpdated += cardsUpdated;
        
        console.log(`[${i + 1}/${allActivities.length}] Updating activity ID ${activityId} (locale: ${activityLocale})`);
        console.log(`  Found ${cardsUpdated} card detail(s) to update`);

        try {
          await strapi.entityService.update('api::destination-activity.destination-activity', activityId, {
            data: {
              components: updatedComponents,
            },
            locale: activityLocale,
          });

          updatedCount++;
          console.log(`  ✓ Updated successfully\n`);
        } catch (error) {
          const errorMsg = error.message || 'Unknown error';
          if (!errorMsg.includes('deep-populate') && !errorMsg.includes('Failed to save cached entry')) {
            errors.push({ 
              id: activityId, 
              locale: activityLocale,
              error: errorMsg 
            });
            console.error(`  ✗ Failed: ${errorMsg}\n`);
          } else {
            // Plugin warning, but update might have succeeded
            updatedCount++;
            console.log(`  ✓ Updated (plugin warning ignored)\n`);
          }
        }
      } else {
        skippedCount++;
        if (i < 10 || (i + 1) % 50 === 0) {
          console.log(`[${i + 1}/${allActivities.length}] Skipping activity ID ${activityId} (locale: ${activityLocale}) - no updates needed\n`);
        }
      }

      // Show progress every 50 entries
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${allActivities.length} processed (${updatedCount} updated, ${skippedCount} skipped)\n`);
      }
    }

    // Summary
    console.log('\n=== Update Summary ===');
    console.log(`Total activities processed: ${allActivities.length}`);
    console.log(`Activities updated: ${updatedCount}`);
    console.log(`Activities skipped: ${skippedCount}`);
    console.log(`Total card details updated: ${totalCardsUpdated}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(({ id, locale, error }) => {
        console.log(`  - ID: ${id}, Locale: ${locale}`);
        console.log(`    Error: ${error}`);
      });
    }

    console.log('\nTitle to card_title copy complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  // Suppress plugin warnings and set log level to error only
  app.log.level = 'error';
  
  // Suppress console warnings from plugins
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const msg = args.join(' ');
    // Ignore deep-populate plugin warnings
    if (!msg.includes('deep-populate') && !msg.includes('Failed to save cached entry')) {
      originalWarn.apply(console, args);
    }
  };

  await copyTitleToCardTitle();
  
  // Restore original console.warn
  console.warn = originalWarn;
  
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

