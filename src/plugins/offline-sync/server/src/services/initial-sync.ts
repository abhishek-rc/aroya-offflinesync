/**
 * Initial Sync Service
 * Syncs all existing content from master to replica and creates mappings
 * Used for production systems where data existed before sync was active
 */

export default ({ strapi: strapiInstance }: { strapi: any }) => {
  const strapi = strapiInstance;

  return {
    /**
     * Perform initial sync from master (REPLICA SIDE)
     * Fetches all content from master API and creates local copies with mappings
     */
    async pullFromMaster(options: {
      masterUrl: string;
      masterApiToken?: string;
      contentTypes?: string[];
      dryRun?: boolean;
    }): Promise<{
      success: boolean;
      synced: number;
      skipped: number;
      errors: string[];
      details: Array<{ contentType: string; masterDocId: string; localDocId: string; action: string }>;
    }> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        throw new Error('pullFromMaster only available in replica mode');
      }

      const shipId = config.shipId;
      const documentMapping = strapi.plugin('offline-sync').service('document-mapping');

      const result = {
        success: true,
        synced: 0,
        skipped: 0,
        errors: [] as string[],
        details: [] as Array<{ contentType: string; masterDocId: string; localDocId: string; action: string }>,
      };

      // Get content types to sync
      let contentTypesToSync = options.contentTypes || config.contentTypes || [];

      // If no content types specified, auto-discover all API content types
      if (contentTypesToSync.length === 0) {
        contentTypesToSync = this.discoverApiContentTypes();
        strapi.log.info(`[InitialSync] Auto-discovered ${contentTypesToSync.length} content types`);
      }

      if (contentTypesToSync.length === 0) {
        result.errors.push('No content types found to sync');
        result.success = false;
        return result;
      }

      strapi.log.info(`[InitialSync] Starting pull from master: ${options.masterUrl}`);
      strapi.log.info(`[InitialSync] Content types: ${contentTypesToSync.join(', ')}`);
      strapi.log.info(`[InitialSync] Dry run: ${options.dryRun ? 'YES' : 'NO'}`);

      // Track processed documentIds to prevent duplicates within this sync run
      const processedDocIds = new Set<string>();

      for (const contentType of contentTypesToSync) {
        try {
          // Skip single types - they don't need mappings (only one instance exists)
          if (this.isSingleType(contentType)) {
            strapi.log.debug(`[InitialSync] Skipping single type: ${contentType}`);
            continue;
          }

          strapi.log.info(`[InitialSync] Processing ${contentType}...`);

          // Get API path from Strapi's configuration
          const apiPath = this.contentTypeToApiPath(contentType);

          if (!apiPath) {
            result.errors.push(`${contentType}: Could not determine API path`);
            continue;
          }

          const masterContent = await this.fetchFromMaster(
            options.masterUrl,
            apiPath,
            options.masterApiToken
          );

          if (!masterContent || !Array.isArray(masterContent)) {
            strapi.log.warn(`[InitialSync] No content found for ${contentType}`);
            continue;
          }

          strapi.log.info(`[InitialSync] Found ${masterContent.length} items in ${contentType}`);

          for (const masterDoc of masterContent) {
            const masterDocId = masterDoc.documentId || masterDoc.id;

            if (!masterDocId) {
              result.errors.push(`${contentType}: Document missing ID`);
              continue;
            }

            // Create unique key for tracking (contentType + masterDocId)
            const trackingKey = `${contentType}:${masterDocId}`;

            // Skip if already processed in this sync run (handles multiple locales of same doc)
            if (processedDocIds.has(trackingKey)) {
              strapi.log.debug(`[InitialSync] Skipping duplicate: ${trackingKey}`);
              continue;
            }

            try {
              // Check if mapping already exists in database
              const existingMapping = await documentMapping.findByMasterDocumentId(
                shipId,
                contentType,
                masterDocId
              );

              if (existingMapping) {
                // Mapping exists - skip
                processedDocIds.add(trackingKey);
                result.skipped++;
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: existingMapping.replicaDocumentId,
                  action: 'skipped (mapping exists)',
                });
                continue;
              }

              // Try to find local document by matching fields
              const localDoc = await this.findMatchingLocalDocument(
                contentType,
                masterDoc
              );

              if (options.dryRun) {
                // Dry run - just log what would happen
                processedDocIds.add(trackingKey);
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: localDoc?.documentId || 'WOULD_CREATE',
                  action: localDoc ? 'would link' : 'would create',
                });
                result.synced++;
                continue;
              }

              if (localDoc) {
                // Found matching local document - create mapping
                await documentMapping.setMapping(
                  shipId,
                  contentType,
                  localDoc.documentId,
                  masterDocId
                );

                processedDocIds.add(trackingKey);
                result.synced++;
                result.details.push({
                  contentType,
                  masterDocId,
                  localDocId: localDoc.documentId,
                  action: 'linked existing',
                });

                strapi.log.info(`[InitialSync] Linked: ${masterDocId} → ${localDoc.documentId}`);
              } else {
                // No matching local document found
                // Since master and replica have SAME data, assume same documentId
                // Just create mapping: masterDocId → masterDocId

                // First verify the document exists locally with same documentId
                try {
                  const existsLocally = await strapi.documents(contentType).findOne({
                    documentId: masterDocId,
                  });

                  if (existsLocally) {
                    // Document exists with same documentId - create direct mapping
                    await documentMapping.setMapping(
                      shipId,
                      contentType,
                      masterDocId, // replicaDocId = masterDocId (same!)
                      masterDocId
                    );

                    processedDocIds.add(trackingKey);
                    result.synced++;
                    result.details.push({
                      contentType,
                      masterDocId,
                      localDocId: masterDocId,
                      action: 'mapped same-id',
                    });

                    strapi.log.info(`[InitialSync] Mapped same ID: ${masterDocId}`);
                  } else {
                    // Document doesn't exist locally at all - skip (don't create!)
                    strapi.log.warn(`[InitialSync] No local document found for ${masterDocId}, skipping (no creation)`);
                    result.errors.push(`${contentType}/${masterDocId}: No local document found`);
                  }
                } catch (findError: any) {
                  strapi.log.warn(`[InitialSync] Error checking local doc ${masterDocId}: ${findError.message}`);
                  result.errors.push(`${contentType}/${masterDocId}: ${findError.message}`);
                }
              }
            } catch (docError: any) {
              result.errors.push(`${contentType}/${masterDocId}: ${docError.message}`);
            }
          }
        } catch (typeError: any) {
          result.errors.push(`${contentType}: ${typeError.message}`);
        }
      }

      strapi.log.info(`[InitialSync] Complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`);

      if (result.errors.length > 0) {
        result.success = result.synced > 0; // Partial success if some items synced
      }

      return result;
    },

    /**
     * Create mappings for existing content that matches between master and replica
     * This doesn't create new content, just establishes mappings
     */
    async createMappingsOnly(options: {
      contentTypes?: string[];
      matchBy?: 'id' | 'name' | 'custom';
      customMatcher?: (masterDoc: any, localDoc: any) => boolean;
    }): Promise<{
      success: boolean;
      mapped: number;
      errors: string[];
    }> {
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        throw new Error('createMappingsOnly only available in replica mode');
      }

      // This would require master API access or a shared database
      // For now, return instructions
      return {
        success: false,
        mapped: 0,
        errors: ['Use pullFromMaster with dryRun=true first to see what would be synced'],
      };
    },

    /**
     * Auto-discover all API content types (excludes plugin:: and admin::)
     */
    discoverApiContentTypes(): string[] {
      const contentTypes: string[] = [];

      for (const uid of Object.keys(strapi.contentTypes)) {
        // Only include api:: content types (user-created)
        if (uid.startsWith('api::')) {
          contentTypes.push(uid);
        }
      }

      strapi.log.info(`[InitialSync] Found content types: ${contentTypes.join(', ')}`);
      return contentTypes;
    },

    /**
     * Convert content type to API path using Strapi's actual configuration
     */
    contentTypeToApiPath(contentType: string): string | null {
      try {
        const model = strapi.contentTypes[contentType];

        if (!model) {
          strapi.log.warn(`[InitialSync] Content type not found: ${contentType}`);
          return null;
        }

        // Get the plural/singular name from Strapi's configuration
        const info = model.info || {};
        const kind = model.kind; // 'singleType' or 'collectionType'

        // For single types, use singular name; for collections, use plural name
        let routeName: string;

        if (kind === 'singleType') {
          // Single types use singular name: /api/header, /api/footer
          routeName = info.singularName || info.displayName?.toLowerCase().replace(/\s+/g, '-');
        } else {
          // Collection types use plural name: /api/pages, /api/excursions
          routeName = info.pluralName || info.singularName + 's';
        }

        if (!routeName) {
          // Fallback: extract from content type UID
          const parts = contentType.split('.');
          routeName = parts[parts.length - 1];
        }

        strapi.log.debug(`[InitialSync] ${contentType} → /api/${routeName} (${kind})`);
        return `/api/${routeName}`;
      } catch (error: any) {
        strapi.log.warn(`[InitialSync] Error getting API path for ${contentType}: ${error.message}`);
        return null;
      }
    },

    /**
     * Check if content type is a single type (not a collection)
     */
    isSingleType(contentType: string): boolean {
      try {
        const model = strapi.contentTypes[contentType];
        return model?.kind === 'singleType';
      } catch {
        return false;
      }
    },

    /**
     * Fetch content from master API
     * Only needs documentIds for mapping - locale doesn't matter for mapping
     * Locale-specific operations are handled by the sync service
     */
    async fetchFromMaster(
      masterUrl: string,
      apiPath: string,
      apiToken?: string
    ): Promise<any[]> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true', // Bypass ngrok warning page
      };

      if (apiToken) {
        headers['Authorization'] = `Bearer ${apiToken}`;
      }

      // Fetch without locale filter - we only need documentIds for mapping
      // The same documentId is used for ALL locales (en, ar, etc.)
      // Locale-specific sync operations are handled separately by sync-service
      const url = `${masterUrl}${apiPath}?pagination[pageSize]=1000&populate=*`;

      strapi.log.debug(`[InitialSync] Fetching: ${url}`);

      try {
        const response = await fetch(url, { headers });

        if (!response.ok) {
          strapi.log.warn(`[InitialSync] Failed to fetch ${apiPath}: HTTP ${response.status}`);
          return [];
        }

        const json = await response.json();
        const data = json.data || [];

        if (data.length > 0) {
          strapi.log.info(`[InitialSync] Fetched ${data.length} documents from ${apiPath}`);
        } else {
          strapi.log.debug(`[InitialSync] No items found at ${apiPath}`);
        }

        return data;
      } catch (error: any) {
        strapi.log.warn(`[InitialSync] Error fetching ${apiPath}: ${error.message}`);
        return [];
      }
    },

    /**
     * Find matching local document by comparing key fields
     */
    async findMatchingLocalDocument(
      contentType: string,
      masterDoc: any
    ): Promise<any | null> {
      try {
        const docLocale = masterDoc._fetchedLocale || masterDoc.locale || 'en';

        // Try to find by name/title first
        const nameField = masterDoc.name || masterDoc.title || masterDoc.label;

        if (nameField) {
          const results = await strapi.documents(contentType).findMany({
            filters: {
              $or: [
                { name: { $eq: nameField } },
                { title: { $eq: nameField } },
                { label: { $eq: nameField } },
              ],
            },
            locale: docLocale,
            limit: 1,
          });

          if (results && results.length > 0) {
            return results[0];
          }
        }

        // Try to find by slug if available
        if (masterDoc.slug) {
          const results = await strapi.documents(contentType).findMany({
            filters: { slug: { $eq: masterDoc.slug } },
            locale: docLocale,
            limit: 1,
          });

          if (results && results.length > 0) {
            return results[0];
          }
        }

        return null;
      } catch (error: any) {
        strapi.log.debug(`[InitialSync] Error finding match: ${error.message}`);
        return null;
      }
    },

    /**
     * Clean sync data - remove internal Strapi fields and prepare components
     */
    cleanSyncData(data: any): any {
      if (!data || typeof data !== 'object') return data;

      // Handle arrays (dynamic zones, repeatable components, relations)
      if (Array.isArray(data)) {
        return data.map(item => this.cleanSyncData(item));
      }

      const cleaned: Record<string, any> = {};

      for (const [key, value] of Object.entries(data)) {
        // Skip internal Strapi fields
        if ([
          'id',
          'documentId',
          'createdAt',
          'updatedAt',
          'publishedAt',
          'createdBy',
          'updatedBy',
          'localizations',
          'locale',
          '_fetchedLocale',
        ].includes(key)) {
          continue;
        }

        // Handle nested objects (components, relations)
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            // Array of components or relations
            cleaned[key] = value.map(item => {
              if (item && typeof item === 'object') {
                const cleanedItem = this.cleanSyncData(item);
                // Keep __component for dynamic zones
                if ((item as any).__component) {
                  cleanedItem.__component = (item as any).__component;
                }
                return cleanedItem;
              }
              return item;
            });
          } else if ((value as any).__component) {
            // Single component
            const cleanedComponent = this.cleanSyncData(value);
            cleanedComponent.__component = (value as any).__component;
            cleaned[key] = cleanedComponent;
          } else if ((value as any).data !== undefined) {
            // Strapi v5 relation format: { data: { id, attributes } }
            // Skip relations for now to avoid ID conflicts
            cleaned[key] = null;
          } else if ((value as any).id && !(value as any).__component) {
            // Regular relation - skip to avoid ID conflicts
            cleaned[key] = null;
          } else {
            // Nested object (media, etc.)
            cleaned[key] = this.cleanSyncData(value);
          }
        } else {
          cleaned[key] = value;
        }
      }

      return cleaned;
    },
  };
};

