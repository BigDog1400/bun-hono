import { expect, test, describe, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
// Import all plugins to ensure they are registered before VideoRenderer is instantiated
import '../../../src/renderer/plugins';
import { VideoRenderer, RendererOptions } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1';

// --- IMPORTANT NOTE FOR THIS TEST SUITE ---
// This integration test suite RELIES ON:
// 1. FFmpeg being INSTALLED and accessible in the system PATH.
// 2. REAL, VALID media files located in `tests/renderer/integration/media/`.
//    - `test_image.png` (e.g., a small PNG)
//    - `test_audio.mp3` (e.g., a short silent MP3)
// The placeholder text files created by the AI will cause FFmpeg to fail.
// Replace them with actual media files before running these tests for meaningful results.
// ---

const MEDIA_DIR = path.resolve(__dirname, 'media');
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const TEST_IMAGE_PATH = path.join(MEDIA_DIR, 'test_image.png');
// const TEST_AUDIO_PATH = path.join(MEDIA_DIR, 'test_audio.mp3'); // For later tests

describe('VideoRenderer Integration Tests', () => {
  let renderer: VideoRenderer;
  let defaultOptions: RendererOptions;
  const outputFilesCreated: string[] = []; // Track files for cleanup

  beforeEach(() => {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    defaultOptions = {
      outputDir: OUTPUT_DIR,
      outputFile: `test_output_${Date.now()}.mp4`, // Unique output file per test
      ffmpegPath: 'ffmpeg', // Assume ffmpeg is in PATH
      enableVerboseLogging: true, // Set true for easier debugging if tests fail
    };
    renderer = new VideoRenderer(defaultOptions);
    outputFilesCreated.push(path.join(defaultOptions.outputDir, defaultOptions.outputFile));
  });

  afterEach(() => {
    // Clean up created output files
    for (const file of outputFilesCreated) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          console.error(`Error deleting test output file ${file}:`, err);
        }
      }
    }
    outputFilesCreated.length = 0; // Clear the array
  });

  test('should render a simple scene with a color background and an image', async () => {
    // Check if the dummy image file exists, warn if it's a placeholder
    if (fs.existsSync(TEST_IMAGE_PATH)) {
        const imageContent = fs.readFileSync(TEST_IMAGE_PATH, 'utf-8');
        if (imageContent.startsWith("This is a placeholder")) {
            console.warn(`\nWARNING: Test image '${TEST_IMAGE_PATH}' is a placeholder. FFmpeg will likely fail. Replace with a real image for a valid test.\n`);
        }
    } else {
        throw new Error(`Test image not found at ${TEST_IMAGE_PATH}. Ensure media files are set up.`);
    }


    const doc: LayoutV1 = {
      version: 'v1',
      canvas: { width: 64, height: 64, fps: 10 },
      sources: [
        { id: 's_bg', url: 'blue', kind: 'colour' },
        { id: 's_img', url: TEST_IMAGE_PATH, kind: 'image' }, // Use resolved path
      ],
      blocks: [
        // Background Block (implicitly handled by some renderers, here explicit for now or use dedicated background field if supported)
        // For current CT convertToCanonicalTimeline, background is not special. So treat as a normal block.
        {
          id: 'b_bg',
          // visuals: [{ id: 'v_bg', sourceId: 's_bg', duration: 1 }], // PRD style
          // This matches the simplified Block structure convertToCanonicalTimeline currently expects
          sourceId: 's_bg', duration: 1, start: 0,
        } as any,
        {
          id: 'b_img',
          // visuals: [{ id: 'v_img', sourceId: 's_img', duration: 1, width: 0.5, height: 0.5, x:0.25, y:0.25 }], // PRD style
          sourceId: 's_img', duration: 1, start: 0,
          // Add props for image if CTClip expects them directly (current CT impl does)
          // width: 0.5, height: 0.5, x:0.25, y:0.25 // These would be on CTClip
        } as any,
      ],
    };

    // Manually adjust CTClip properties if needed due to simplified convertToCanonicalTimeline
    // For this test, we rely on the current convertToCanonicalTimeline.
    // The actual structure of `blocks` in `doc` needs to align with what
    // `convertToCanonicalTimeline` *currently* expects.
    // The current `convertToCanonicalTimeline` expects `blocks: [{ sourceId, start, duration }]`.
    // It does NOT process `visuals` array within blocks or `background`/`overlay` fields.
    // So the LayoutV1 doc needs to be structured simply for the current implementation.

    console.log(`VideoRenderer Integration Test: Starting render for '${defaultOptions.outputFile}'...`);
    const result = await renderer.render(doc);

    const outputFilePath = path.join(defaultOptions.outputDir, defaultOptions.outputFile);
    console.log(`VideoRenderer Integration Test: Render result:`, JSON.stringify(result, null, 2));
    if (result.error) console.error("Error details:", result.details);


    expect(result.success).toBe(true);
    expect(fs.existsSync(outputFilePath)).toBe(true);

    const stats = fs.statSync(outputFilePath);
    expect(stats.size).toBeGreaterThan(0); // File is not empty

    // Optional: ffprobe check (requires ffprobe to be installed and accessible)
    // This would be a more robust check but adds complexity.
    // For now, existence and non-zero size are the primary checks.
    // try {
    //   const probeResult = await executeFFprobeCommand(outputFilePath); // Another helper
    //   expect(probeResult.streams[0].width).toBe(64);
    //   expect(probeResult.streams[0].height).toBe(64);
    //   expect(parseFloat(probeResult.streams[0].duration)).toBeCloseTo(1.0, 1);
    //   expect(probeResult.streams[0].codec_name).toBe('mpeg4'); // or h264 depending on ffmpeg defaults
    // } catch (probeError) {
    //   console.error("FFprobe check failed:", probeError);
    //   // Fail the test if ffprobe check is critical, or just log warning
    //   expect(true).toBe(false); // Force fail if probe fails
    // }

  }, 20000); // Increase timeout for FFmpeg execution
});
