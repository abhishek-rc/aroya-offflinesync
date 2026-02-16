/**
 * page controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::page.page', ({ strapi }) => ({
    /**
     * Custom endpoint to filter pages by category within card sections
     * GET /api/pages/filter-by-category
     *
     * Query params:
     * - page_slug: (required) The page slug to search
     * - category: (required) The category to filter by
     * - site_setting: (optional) The site setting name (e.g., 'mobile', 'website')
     * - locale: (optional) The locale (default: 'en')
     */
    async filterByCategory(ctx) {
        try {
            const { page_slug, category, site_setting, locale = 'en' } = ctx.query;

            // Validate required parameters
            if (!page_slug) {
                return ctx.badRequest('Missing required query param: page_slug');
            }

            if (!category) {
                return ctx.badRequest('Missing required query param: category');
            }

            // Build the filters
            const filters: any = {
                page_slug: { $eq: page_slug },
                locale: { $eq: locale },
            };

            // Add site_setting filter if provided
            if (site_setting) {
                filters.site_settings = {
                    name: { $eq: site_setting },
                };
            }

            // Deep populate configuration for nested component fields
            const deepPopulate = {
                components: {
                    on: {
                        'shared.card-section': {
                            populate: {
                                section_items: {
                                    populate: {
                                        image: true,
                                        logo: true,
                                        cta: true,
                                    },
                                },
                            },
                        },
                        'shared.hero-banner': {
                            populate: {
                                hero_banner: {
                                    populate: {
                                        mobile_image: true,
                                        desktop_image: true,
                                        cta_button: true,
                                    },
                                },
                            },
                        },
                        'shared.gallery-item': {
                            populate: '*',
                        },
                        'shared.faq': {
                            populate: '*',
                        },
                        'shared.feature-section': {
                            populate: '*',
                        },
                        'shared.image-and-text-section': {
                            populate: '*',
                        },
                        'destinations.venue-section': {
                            populate: '*',
                        },
                        'destinations.villas-and-suites': {
                            populate: '*',
                        },
                        'information.info': {
                            populate: '*',
                        },
                    },
                },
                SEO: true,
                site_settings: true,
            };

            // Find the page with all components populated using document service
            const pages = await strapi.documents('api::page.page').findMany({
                filters,
                populate: deepPopulate,
            }) as any[];

            if (!pages || pages.length === 0) {
                return ctx.notFound('Page not found');
            }

            const page = pages[0] as any;
            const categoryStr = String(category).toLowerCase();

            // Filter card sections by category
            const filteredComponents: any[] = [];

            if (page.components && Array.isArray(page.components)) {
                for (const component of page.components) {
                    // Check if this is a card-section component
                    if (component.__component === 'shared.card-section') {
                        // Filter section_items by category
                        if (component.section_items && Array.isArray(component.section_items)) {
                            const matchingItems = component.section_items.filter(
                                (item: any) =>
                                    item.category &&
                                    String(item.category).toLowerCase() === categoryStr
                            );

                            if (matchingItems.length > 0) {
                                filteredComponents.push({
                                    ...component,
                                    section_items: matchingItems,
                                });
                            }
                        }
                    }
                }
            }

            // Return the filtered result
            return {
                data: {
                    id: page.id,
                    documentId: page.documentId,
                    page_title: page.page_title,
                    page_slug: page.page_slug,
                    locale: page.locale,
                    components: filteredComponents,
                    SEO: page.SEO,
                    site_settings: page.site_settings,
                },
                meta: {
                    category: category,
                    total_items: filteredComponents.reduce(
                        (acc: number, comp: any) => acc + (comp.section_items?.length || 0),
                        0
                    ),
                },
            };
        } catch (error) {
            strapi.log.error('Error in filterByCategory:', error);
            return ctx.internalServerError(
                'An error occurred while filtering by category'
            );
        }
    },

    /**
     * Get all unique categories from a page's card sections
     * GET /api/pages/categories
     *
     * Query params:
     * - page_slug: (required) The page slug
     * - site_setting: (optional) The site setting name
     * - locale: (optional) The locale (default: 'en')
     */
    async getCategories(ctx) {
        try {
            const { page_slug, site_setting, locale = 'en' } = ctx.query;

            if (!page_slug) {
                return ctx.badRequest('Missing required query param: page_slug');
            }

            // Build the filters
            const filters: any = {
                page_slug: { $eq: page_slug },
                locale: { $eq: locale },
            };

            if (site_setting) {
                filters.site_settings = {
                    name: { $eq: site_setting },
                };
            }

            const pages = await strapi.documents('api::page.page').findMany({
                filters,
                populate: {
                    components: {
                        populate: '*',
                    },
                },
            }) as any[];

            if (!pages || pages.length === 0) {
                return ctx.notFound('Page not found');
            }

            const page = pages[0] as any;
            const categories = new Set<string>();

            // Extract all unique categories from card sections
            if (page.components && Array.isArray(page.components)) {
                for (const component of page.components) {
                    if (component.__component === 'shared.card-section') {
                        if (component.section_items && Array.isArray(component.section_items)) {
                            for (const item of component.section_items) {
                                if (item.category) {
                                    categories.add(item.category);
                                }
                            }
                        }
                    }
                }
            }

            return {
                data: Array.from(categories).sort(),
                meta: {
                    page_slug,
                    total: categories.size,
                },
            };
        } catch (error) {
            strapi.log.error('Error in getCategories:', error);
            return ctx.internalServerError(
                'An error occurred while fetching categories'
            );
        }
    },
}));
