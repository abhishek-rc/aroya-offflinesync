/**
 * excursion controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::excursion.excursion', ({ strapi }) => ({
    async find(ctx) {
        // Check if shorex_code filter is provided
        const { shorex_code } = ctx.query;

        // If no shorex_code filter, use default behavior
        if (!shorex_code) {
            return await super.find(ctx);
        }

        // Remove shorex_code from query to avoid Strapi validation error
        delete ctx.query.shorex_code;

        // Normalize shorex_code to an array to support multiple values
        // Supports: ?shorex_code=A,B,C or ?shorex_code=A&shorex_code=B&shorex_code=C
        let shorexCodes: string[] = [];
        if (Array.isArray(shorex_code)) {
            // Handle multiple query params: ?shorex_code=A&shorex_code=B
            shorexCodes = shorex_code.flatMap((code: string) => code.split(',').map((c) => c.trim()));
        } else if (typeof shorex_code === 'string') {
            // Handle comma-separated: ?shorex_code=A,B,C
            shorexCodes = shorex_code.split(',').map((c) => c.trim());
        }

        // Get all excursions with default behavior
        const response = await super.find(ctx);

        // Filter results by shorex_code inside the dynamic zone
        if (response.data && Array.isArray(response.data)) {
            response.data = response.data.filter((excursion) => {
                const excursions = excursion.excursions || excursion.attributes?.excursions;

                if (!excursions || !Array.isArray(excursions)) {
                    return false;
                }

                // Check if any component in the dynamic zone has matching shorex_code
                return excursions.some((component) => {
                    const activity = component.Activity;
                    if (!activity) return false;

                    // Check if the activity's shorex_code matches any of the provided codes
                    return shorexCodes.includes(activity.shorex_code);
                });
            });

            // Update meta pagination count
            if (response.meta?.pagination) {
                response.meta.pagination.total = response.data.length;
            }
        }

        return response;
    },
}));
