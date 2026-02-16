export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            '*.aliyuncs.com',
            '*.aroya.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            '*.aliyuncs.com',
            '*.aroya.com',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  // Video compression middleware - compresses videos BEFORE OSS upload
  {
    resolve: './src/middlewares/video-compression',
    config: {},
  },
  // Response cache middleware - reduces load from populate=* queries
  {
    resolve: './src/middlewares/response-cache',
    config: {
      ttl: 300, // Cache for 5 minutes (adjust as needed)
    },
  },
];

