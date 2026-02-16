/**
 * destination controller
 * 
 * Customized to ensure ports relation is populated correctly.
 * The ports relation uses mappedBy, which requires explicit population.
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::destination.destination', ({ strapi }) => ({
    async find(ctx) {
        try {
            // Call parent find first to get all data with populate=*
            const { data, meta } = await super.find(ctx);

            // If populate was requested, ensure ports are populated
            // This handles the case where populate=* doesn't populate mappedBy relations
            if (ctx.query.populate && data) {
                const destinations = Array.isArray(data) ? data : [data];
                const locale = ctx.query.locale || 'en';

                // Check if any destination is missing ports and populate them
                const destinationsWithPorts = await Promise.all(
                    destinations.map(async (destination: any) => {
                        // If ports are already populated (even if empty array), return as-is
                        const dest = destination as any;
                        if (dest.ports !== undefined) {
                            return destination;
                        }

                        // Otherwise, fetch ports using documents API (works with documentId)
                        if (destination.documentId) {
                            try {
                                const fullDestination = await strapi.documents('api::destination.destination').findOne({
                                    documentId: destination.documentId,
                                    locale: String(locale),
                                    populate: {
                                        ports: true,
                                    },
                                }) as any;

                                if (fullDestination && fullDestination.ports) {
                                    return {
                                        ...destination,
                                        ports: fullDestination.ports || [],
                                    };
                                }
                            } catch (error) {
                                // If population fails, return original destination with empty ports array
                                console.error(`Failed to populate ports for destination ${destination.documentId}:`, error);
                                return {
                                    ...destination,
                                    ports: [],
                                };
                            }
                        }

                        return {
                            ...destination,
                            ports: [],
                        };
                    })
                );

                return {
                    data: Array.isArray(data) ? destinationsWithPorts : destinationsWithPorts[0],
                    meta,
                };
            }

            return { data, meta };
        } catch (error) {
            // If there's an error, log it and rethrow
            console.error('Error in destination find controller:', error);
            throw error;
        }
    },

    async findOne(ctx) {
        try {
            // Call parent findOne first to get all data with populate=*
            const { data, meta } = await super.findOne(ctx);

            // If populate was requested, ensure ports are populated
            // This handles the case where populate=* doesn't populate mappedBy relations
            if (ctx.query.populate && data && data.documentId) {
                // If ports are already populated (even if empty array), return as-is
                const destData = data as any;
                if (destData.ports === undefined) {
                    const locale = ctx.query.locale || 'en';

                    try {
                        const fullDestination = await strapi.documents('api::destination.destination').findOne({
                            documentId: data.documentId,
                            locale: String(locale),
                            populate: {
                                ports: true,
                            },
                        }) as any;

                        if (fullDestination && fullDestination.ports) {
                            return {
                                data: {
                                    ...data,
                                    ports: fullDestination.ports || [],
                                },
                                meta,
                            };
                        }
                    } catch (error) {
                        // If population fails, return original data with empty ports array
                        console.error(`Failed to populate ports for destination ${data.documentId}:`, error);
                        return {
                            data: {
                                ...data,
                                ports: [],
                            },
                            meta,
                        };
                    }
                }
            }

            return { data, meta };
        } catch (error) {
            // If there's an error, log it and rethrow
            console.error('Error in destination findOne controller:', error);
            throw error;
        }
    },
}));
