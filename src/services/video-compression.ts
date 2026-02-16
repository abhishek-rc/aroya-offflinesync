import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);

interface CompressionOptions {
  crf?: number;           // Quality: 23=high, 28=medium, 32=low (default: 28)
  maxWidth?: number;      // Max video width (default: 1920)
  videoBitrate?: string;  // Video bitrate (default: auto)
  audioBitrate?: string;  // Audio bitrate (default: '128k')
}

/**
 * Compress video using FFmpeg
 * @param inputPath - Path to input video file
 * @param outputPath - Path to save compressed video
 * @param options - Compression options
 * @returns Promise<void>
 */
export async function compressVideo(
  inputPath: string,
  outputPath: string,
  options: CompressionOptions = {}
): Promise<void> {
  const {
    crf = 28,                    // Medium quality (good balance)
    maxWidth = 1920,             // Full HD max
    videoBitrate = undefined,    // Let FFmpeg auto-calculate
    audioBitrate = '128k',       // Good audio quality
  } = options;

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .videoCodec('libx264')                    // H.264 codec (universal)
      .audioCodec('aac')                        // AAC audio
      .audioBitrate(audioBitrate)
      .outputOptions([
        `-crf ${crf}`,                          // Quality setting
        '-preset fast',                         // Encoding speed
        '-movflags +faststart',                 // Web optimization
        `-vf scale='min(${maxWidth},iw):-2'`,  // Scale down if needed
      ])
      .format('mp4');                           // Output format

    // Add video bitrate if specified
    if (videoBitrate) {
      command = command.videoBitrate(videoBitrate);
    }

    command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log(`[FFmpeg] Started: ${commandLine}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[FFmpeg] Processing: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`[FFmpeg] Compression completed: ${outputPath}`);
        resolve();
      })
      .on('error', (err, stdout, stderr) => {
        console.error('[FFmpeg] Error:', err.message);
        console.error('[FFmpeg] stderr:', stderr);
        reject(err);
      })
      .run();
  });
}

/**
 * Get video metadata
 */
export async function getVideoMetadata(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

/**
 * Check if file is a video based on mime type
 */
export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * Process uploaded video file
 * - Compresses video
 * - Replaces original with compressed version
 * - Updates file stats
 */
export async function processUploadedVideo(
  filePath: string,
  options: CompressionOptions = {}
): Promise<{ size: number; compressed: boolean }> {
  const tempPath = filePath + '.temp.mp4';

  try {
    console.log(`[Video] Starting compression: ${filePath}`);

    // Get original size
    const originalStats = await fs.stat(filePath);
    const originalSize = originalStats.size;

    // Compress video to temp file
    await compressVideo(filePath, tempPath, options);

    // Get compressed size
    const compressedStats = await fs.stat(tempPath);
    const compressedSize = compressedStats.size;

    // Calculate savings
    const savings = ((originalSize - compressedSize) / originalSize) * 100;
    console.log(
      `[Video] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(
        compressedSize /
        1024 /
        1024
      ).toFixed(2)}MB (${savings.toFixed(1)}% reduction)`
    );

    // Only replace if compression actually reduced size
    if (compressedSize < originalSize) {
      // Delete original
      await unlinkAsync(filePath);
      // Rename compressed to original name
      await fs.move(tempPath, filePath, { overwrite: true });

      return { size: compressedSize, compressed: true };
    } else {
      // Compression made it bigger (rare), keep original
      console.log('[Video] Keeping original (compressed version was larger)');
      await unlinkAsync(tempPath);
      return { size: originalSize, compressed: false };
    }
  } catch (error) {
    console.error('[Video] Compression failed:', error);

    // Clean up temp file if exists
    if (await fs.pathExists(tempPath)) {
      await unlinkAsync(tempPath);
    }

    // Return original size, mark as not compressed
    const originalStats = await fs.stat(filePath);
    return { size: originalStats.size, compressed: false };
  }
}
