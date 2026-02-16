export default (config: any, { strapi }: { strapi: any }) => {
  return async (ctx: any, next: any) => {
    // This middleware can be used to track sync operations
    // For now, we'll let lifecycle hooks handle the tracking
    // This can be extended to add additional tracking or logging

    await next();
  };
};

