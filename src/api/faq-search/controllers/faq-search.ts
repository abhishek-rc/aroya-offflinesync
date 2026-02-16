/**
 * FAQ search controller
 * 
 * Searches FAQ questions and answers within pages
 * Filters by site setting, locale, and page slug
 */

// Strapi is available globally in controllers
declare const strapi: any;

/**
 * Extracts plain text from rich-text (blocks) structure
 * Recursively traverses the node tree to collect text content
 */
function extractPlainText(richNodes: any[]): string {
    if (!Array.isArray(richNodes)) return '';

    const stack = [...richNodes];
    const parts: string[] = [];

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

export default {
    async search(ctx: any) {
        const q = String(ctx.query.q || '').trim();

        if (!q) {
            return ctx.badRequest('Missing query param: q');
        }

        const site = String(ctx.query.site_setting);
        const locale = String(ctx.query.locale || 'en');
        const slug = String(ctx.query.slug || 'faq');

        console.log('>>>site', site);
        console.log('>>locale', locale);
        console.log('>>slug', slug);

        try {
            // Fetch the FAQ page with all nested data
            // Note: For dynamic zones (components), we must use the fragment API with 'on' keyword
            const pages = await strapi.entityService.findMany('api::page.page', {
                filters: {
                    page_slug: { $eq: slug },
                    site_setting: { name: { $eq: site } },
                    locale: { $eq: locale },
                },
                populate: {
                    components: {
                        on: {
                            'shared.faq': {
                                populate: {
                                    faq_categories: {
                                        populate: {
                                            faq_items: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                limit: 1,
            } as any);

            if (!pages?.length) {
                return ctx.notFound(
                    `FAQ page not found for slug=${slug}, site=${site}, locale=${locale}`
                );
            }

            const page: any = pages[0];
            const results: any[] = [];
            const queryLower = q.toLowerCase();

            // Find the shared.faq component on the page
            const faqBlocks = Array.isArray(page.components)
                ? page.components.filter((c: any) => c.__component === 'shared.faq')
                : [];

            for (const block of faqBlocks) {
                const categories = block.faq_categories || [];

                for (const cat of categories) {
                    const items = cat.faq_items || [];

                    for (const item of items) {
                        const question = extractPlainText(item.faq_question);
                        const answer = extractPlainText(item.faq_answer);

                        const haystack = `${question} ${answer}`.toLowerCase();

                        if (haystack.includes(queryLower)) {
                            results.push({
                                id: item.id,
                                displayOrder: item.display_order ?? null,
                                isActive: !!item.is_active,
                                category: {
                                    id: cat.id,
                                    title: cat.category_title || null,
                                    displayOrder: cat.display_order ?? null,
                                },
                                question,
                                answer,
                                page: {
                                    id: page.id,
                                    slug: page.page_slug,
                                    locale: page.locale,
                                    site,
                                },
                            });
                        }
                    }
                }
            }

            // Sort by category.displayOrder then item.displayOrder
            results.sort((a, b) => {
                const ca = Number(a.category.displayOrder || 0);
                const cb = Number(b.category.displayOrder || 0);
                if (ca !== cb) return ca - cb;

                const ia = Number(a.displayOrder || 0);
                const ib = Number(b.displayOrder || 0);
                return ia - ib;
            });

            ctx.body = {
                query: q,
                count: results.length,
                data: results,
            };
        } catch (error: any) {
            strapi.log.error('FAQ search error:', error);
            return ctx.internalServerError('An error occurred while searching FAQs');
        }
    },
};

