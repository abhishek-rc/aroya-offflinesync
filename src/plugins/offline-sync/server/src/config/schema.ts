export default {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
    },
    mode: {
      type: 'string',
      enum: ['master', 'replica'],
      default: 'replica',
    },
    shipId: {
      type: 'string',
      nullable: true,
    },
    kafka: {
      type: 'object',
      properties: {
        brokers: {
          type: 'array',
          items: { type: 'string' },
        },
        ssl: { type: 'boolean' },
        sasl: {
          type: 'object',
          properties: {
            mechanism: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
        topics: {
          type: 'object',
          properties: {
            shipUpdates: { type: 'string' },
            masterUpdates: { type: 'string' },
          },
        },
      },
    },
    sync: {
      type: 'object',
      properties: {
        batchSize: { type: 'integer', default: 100 },
        retryAttempts: { type: 'integer', default: 3 },
        retryDelay: { type: 'integer', default: 5000 },
        connectivityCheckInterval: { type: 'integer', default: 30000 },
      },
    },
    contentTypes: {
      type: 'array',
      items: { type: 'string' },
      default: [],
    },
    // Media sync configuration (OSS to MinIO)
    media: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          default: false,
          description: 'Enable media sync between OSS and MinIO',
        },
        transformUrls: {
          type: 'boolean',
          default: true,
          description: 'Transform media URLs during content sync',
        },
        syncOnStartup: {
          type: 'boolean',
          default: true,
          description: 'Run media sync when Strapi starts',
        },
        syncInterval: {
          type: 'integer',
          default: 300000,
          description: 'Interval for periodic sync in milliseconds (default: 5 minutes)',
        },
        // OSS (Master) configuration
        oss: {
          type: 'object',
          properties: {
            endPoint: {
              type: 'string',
              description: 'OSS endpoint (e.g., oss-cn-hangzhou.aliyuncs.com)',
            },
            port: {
              type: 'integer',
              default: 443,
            },
            useSSL: {
              type: 'boolean',
              default: true,
            },
            accessKey: {
              type: 'string',
              description: 'OSS Access Key ID',
            },
            secretKey: {
              type: 'string',
              description: 'OSS Access Key Secret',
            },
            bucket: {
              type: 'string',
              description: 'OSS bucket name',
            },
            baseUrl: {
              type: 'string',
              description: 'Base URL for OSS (e.g., https://bucket.oss-cn-hangzhou.aliyuncs.com)',
            },
            region: {
              type: 'string',
              description: 'OSS region (e.g., oss-cn-hangzhou)',
            },
            uploadPath: {
              type: 'string',
              default: '',
              description: 'Upload path prefix in OSS (e.g., strapi-uploads)',
            },
            pathStyle: {
              type: 'boolean',
              default: false,
              description: 'Use path-style URLs (set false for Alibaba OSS)',
            },
          },
        },
        // MinIO (Replica) configuration
        minio: {
          type: 'object',
          properties: {
            endPoint: {
              type: 'string',
              default: 'localhost',
              description: 'MinIO endpoint',
            },
            port: {
              type: 'integer',
              default: 9000,
            },
            useSSL: {
              type: 'boolean',
              default: false,
            },
            accessKey: {
              type: 'string',
              default: 'minioadmin',
              description: 'MinIO access key',
            },
            secretKey: {
              type: 'string',
              default: 'minioadmin',
              description: 'MinIO secret key',
            },
            bucket: {
              type: 'string',
              default: 'media',
              description: 'MinIO bucket name',
            },
            baseUrl: {
              type: 'string',
              default: 'http://localhost:9000/media',
              description: 'Base URL for MinIO',
            },
          },
        },
        // Fields to scan for media URLs
        mediaFields: {
          type: 'array',
          items: { type: 'string' },
          default: ['url', 'src', 'href', 'image', 'thumbnail', 'video', 'file'],
          description: 'Field names that may contain media URLs',
        },
      },
    },
  },
};

