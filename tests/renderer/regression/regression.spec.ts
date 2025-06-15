import { expect, test, describe, beforeAll, afterAll, beforeEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { VideoRenderer, RendererOptions } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1, LayoutDocument } from '../../../src/renderer/schema/layout-v1'; // Zod schema for parsing

// --- IMPORTANT NOTE FOR THIS TEST SUITE ---
// This regression test suite RELIES ON:
// 1. FFmpeg being INSTALLED and accessible in the system PATH.
// 2. REAL, VALID media files located in `tests/renderer/integration/media/`.
//    - `test_image.png`
//    - `test_audio.mp3`
// The placeholder text files will cause FFmpeg to fail.
// Replace them with actual media files before running for meaningful results.
// ---

const LAYOUTS_DIR = path.resolve(__dirname, 'layouts');
const OUTPUT_DIR = path.resolve(__dirname, 'output');
// const REFERENCE_DIR = path.resolve(__dirname, 'references'); // For future pHash comparisons

const layoutFiles = fs.readdirSync(LAYOUTS_DIR).filter(file => file.endsWith('.json'));

describe('VideoRenderer Regression Tests', () => {
  beforeAll(() => {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    // Check for actual media files and warn if they are placeholders
    const mediaDir = path.resolve(__dirname, '../integration/media');
    const imagePath = path.join(mediaDir, 'test_image.png');
    const audioPath = path.join(mediaDir, 'test_audio.mp3');

    if (fs.existsSync(imagePath) && fs.readFileSync(imagePath, 'utf-8').startsWith("This is a placeholder")) {
        console.warn(`\nREGRESSION TEST WARNING: Test image '${imagePath}' is a placeholder. FFmpeg will likely fail. Replace with a real image.\n`);
    }
    if (fs.existsSync(audioPath) && fs.readFileSync(audioPath, 'utf-8').startsWith("This is a placeholder")) {
        console.warn(`\nREGRESSION TEST WARNING: Test audio '${audioPath}' is a placeholder. FFmpeg will likely fail. Replace with a real audio file.\n`);
    }
  });

  afterAll(() => {
    // Optional: Clean up all files in OUTPUT_DIR after all tests run
    // For now, individual tests will manage their specific output file if needed for inspection.
    // Or, keep them for manual review and .gitignore output dir.
    console.log(`Regression test outputs are in: ${OUTPUT_DIR}`);
    console.log("Remember to .gitignore this output directory if you haven't already.");
  });

  layoutFiles.forEach(jsonFileName => {
    const testName = jsonFileName.replace('.json', '');
    const layoutFilePath = path.join(LAYOUTS_DIR, jsonFileName);
    const outputFileName = `${testName}.mp4`;
    const outputFilePath = path.join(OUTPUT_DIR, outputFileName);

    // Increase timeout significantly for each test case involving FFmpeg
    test(`renders ${jsonFileName} without errors`, async () => {
      const jsonContent = fs.readFileSync(layoutFilePath, 'utf-8');
      let doc: LayoutV1;
      try {
        const parsedJson = JSON.parse(jsonContent);
        // Validate with Zod schema
        const validationResult = LayoutDocument.safeParse(parsedJson);
        if (!validationResult.success) {
          console.error(`Validation failed for ${jsonFileName}:`, validationResult.error.issues);
          throw new Error(`Zod validation failed for ${jsonFileName}`);
        }
        doc = validationResult.data;
      } catch (e: any) {
        console.error(`Error parsing or validating ${jsonFileName}:`, e.message);
        // Fail the test if JSON is invalid
        expect(e).toBeUndefined();
        return;
      }

      const rendererOptions: RendererOptions = {
        outputDir: OUTPUT_DIR,
        outputFile: outputFileName,
        ffmpegPath: 'ffmpeg', // Ensure ffmpeg is in PATH
        enableVerboseLogging: false, // Keep false unless debugging a specific test
      };
      const renderer = new VideoRenderer(rendererOptions);

      console.log(`Regression Test [${testName}]: Starting render...`);
      const renderResult = await renderer.render(doc);
      console.log(`Regression Test [${testName}]: Render result:`, JSON.stringify(renderResult, null, 2));
      if(renderResult.error) console.error("Error details:", renderResult.details);


      // Primary assertion: render process completed successfully
      expect(renderResult.success).toBe(true);

      // Secondary assertion: output file was created
      expect(fs.existsSync(outputFilePath)).toBe(true);

      // Tertiary assertion: output file is not empty
      if (fs.existsSync(outputFilePath)) {
        const stats = fs.statSync(outputFilePath);
        expect(stats.size).toBeGreaterThan(0);
      }

      // Future: Perceptual hash (pHash) comparison
      // const referenceVideoPath = path.join(REFERENCE_DIR, outputFileName);
      // if (fs.existsSync(referenceVideoPath)) {
      //   // const pHashOutput = await calculatePHash(outputFilePath);
      //   // const pHashReference = await getStoredPHash(referenceVideoPath);
      //   // expect(pHashOutput).toBe(pHashReference); // Or within a certain tolerance
      // } else {
      //   console.warn(`Reference video not found for ${testName} at ${referenceVideoPath}. Cannot perform pHash comparison.`);
      //   // On first run or when updating references, this output becomes the new reference.
      // }

      // Cleanup the specific output file for this test run to keep output dir clean for next run if desired
      // Or comment this out to keep files for inspection.
      // if (fs.existsSync(outputFilePath) && renderResult.success) { // Only delete if success and we don't need to inspect error
      //   // fs.unlinkSync(outputFilePath);
      // }

    }, 30000); // 30-second timeout per test case, adjust as needed
  });
});
