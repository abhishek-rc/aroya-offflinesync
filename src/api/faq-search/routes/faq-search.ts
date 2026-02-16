/**
 * FAQ search router
 * 
 * Custom endpoint for searching FAQ questions and answers
 * GET /faq/search?q=search_term&site=mobile&locale=en&slug=faq
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/faq/search',
      handler: 'faq-search.search',
      config: {
        auth: false, // set true and use API tokens if needed
      },
    },
  ],
};

