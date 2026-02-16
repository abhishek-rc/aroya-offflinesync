/**
 * header controller
 * 
 * Extends the core header controller to include navigation data
 * in the response. Fetches navigation data and combines it with header
 * content in a single API call with locale support.
 */

import { factories } from '@strapi/strapi';

const NAVIGATION_SLUG = 'header-navigation';

/**
 * Fetches navigation data by slug with locale support
 */
async function fetchNavigation(strapi, slug = NAVIGATION_SLUG, locale = null) {
    try {
        const navigationPlugin = strapi.plugin('navigation');
        if (!navigationPlugin) {
            return null;
        }

        // Try render service first - returns navigation items with correct structure
        const renderService = navigationPlugin.service('render');
        if (renderService?.render) {
            try {
                const result = await renderService.render(slug);
                if (result && Array.isArray(result) && result.length > 0) {
                    return result;
                }
            } catch (error) {
                // Render service failed, fall through to entityService fallback
            }
        }

        // Fallback: Use entityService to fetch navigation with proper populate
        const queryOptions: any = {
            filters: { slug: { $eq: slug } },
            populate: {
                items: {
                    populate: {
                        parent: true,
                        related: true,
                        audience: true,
                    },
                },
            },
        };

        if (locale) {
            queryOptions.locale = locale;
        }

        const navigations = await strapi.entityService.findMany('plugin::navigation.navigation', queryOptions);

        if (!navigations || navigations.length === 0) {
            return null;
        }

        const navData = navigations.find((nav) => nav.slug === slug) || navigations[0];

        return navData.items || [];
    } catch (error) {
        return null;
    }
}

export default factories.createCoreController('api::headers.headers', ({ strapi }) => ({
    async find(ctx) {
        const locale = ctx.query.locale || null;
        const { data, meta } = await super.find(ctx);
        const headerNavigation = await fetchNavigation(strapi, NAVIGATION_SLUG, locale);

        return {
            data: Array.isArray(data)
                ? data.map((item) => ({ ...item, header_navigation: headerNavigation }))
                : { ...data, header_navigation: headerNavigation },
            meta,
        };
    },

    async findOne(ctx) {
        const locale = ctx.query.locale || null;
        const { data, meta } = await super.findOne(ctx);
        const headerNavigation = await fetchNavigation(strapi, NAVIGATION_SLUG, locale);

        return {
            data: { ...data, header_navigation: headerNavigation },
            meta,
        };
    },
}));
