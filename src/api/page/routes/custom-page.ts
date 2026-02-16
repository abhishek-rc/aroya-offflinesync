/**
 * Custom page routes for category filtering
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/pages/filter-by-category',
            handler: 'page.filterByCategory',
            config: {
                auth: false,
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'GET',
            path: '/pages/categories',
            handler: 'page.getCategories',
            config: {
                auth: false,
                policies: [],
                middlewares: [],
            },
        },
    ],
};

