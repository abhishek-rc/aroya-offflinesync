/**
 * Video compression middleware
 * Intercepts file uploads and compresses videos before they reach OSS
 */

export default (config, { strapi }) => {
  return async (ctx, next) => {
    // Only intercept upload routes (Strapi uses /upload, not /api/upload)
    if (ctx.request.url.startsWith('/upload') && ctx.request.method === 'POST') {
      console.log('🔥 [Video Middleware] Upload request intercepted!');
      console.log('🔥 [Video Middleware] URL:', ctx.request.url);
      console.log('🔥 [Video Middleware] Files:', Object.keys(ctx.request.files || {}));
      
      // Check if video compression is enabled
      const compressionEnabled = process.env.ENABLE_VIDEO_COMPRESSION !== 'false';
      
      if (compressionEnabled && ctx.request.files) {
        const { processUploadedVideo, isVideo } = require('../services/video-compression');
        const fs = require('fs-extra');
        
        // Get files from request
        const files = ctx.request.files as any;
        let fileArray: any[] = [];
        
        if (files.files) {
          fileArray = Array.isArray(files.files) ? files.files : [files.files];
        }
        
        console.log(`🔥 [Video Middleware] Found ${fileArray.length} file(s) to process`);
        
        // Process each file
        for (const file of fileArray.filter(Boolean)) {
          if (file.mimetype && isVideo(file.mimetype)) {
            try {
              console.log(`[Upload] Video detected: ${file.originalFilename} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
              console.log(`[Upload] Compressing video before OSS upload...`);
              
              const tempPath = file.filepath;
              
              if (tempPath && (await fs.pathExists(tempPath))) {
                const originalSize = file.size;
                
                const { size: newSize, compressed } = await processUploadedVideo(tempPath, {
                  crf: parseInt(process.env.VIDEO_CRF || '28', 10),
                  maxWidth: parseInt(process.env.VIDEO_MAX_WIDTH || '1920', 10),
                  audioBitrate: process.env.VIDEO_AUDIO_BITRATE || '128k',
                });
                
                if (compressed) {
                  // Update file size
                  file.size = newSize;
                  
                  const savings = ((originalSize - newSize) / originalSize) * 100;
                  console.log(
                    `[Upload] ✅ Video compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(
                      newSize / 1024 / 1024
                    ).toFixed(2)}MB (${savings.toFixed(1)}% reduction)`
                  );
                  console.log(`[Upload] Uploading compressed video to OSS...`);
                } else {
                  console.log(`[Upload] Keeping original (compressed version was larger)`);
                }
              }
            } catch (error: any) {
              console.error('[Upload] ❌ Compression failed:', error.message);
              // Continue with original file if compression fails
            }
          }
        }
      }
    }
    
    // Continue to next middleware/controller
    await next();
  };
};
