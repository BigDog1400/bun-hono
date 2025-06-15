import { expect, test, describe, beforeEach } from 'bun:test';
import {
    convertToCanonicalTimeline,
    CanonicalTimeline,
    CTClip,
    CTSource,
    // Assuming CTEffect and CTTransition are not primary outputs for these tests
} from '../../../src/renderer/core/CanonicalTimeline';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1'; // Actual Zod inferred type

// Default values used by the current convertToCanonicalTimeline implementation
const DEFAULT_FPS = 30;
const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;
// const DEFAULT_IMAGE_DURATION = 5; // No longer used for this specific test's assertion logic directly
// const DEFAULT_COLOR_DURATION = 5; // No longer used for this specific test's assertion logic directly
// The main code now uses DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT which is 2.

describe('convertToCanonicalTimeline', () => {
  let minimalDoc: LayoutV1; // This will be PRD-aligned for new tests

  beforeEach(() => {
    // A minimal valid LayoutV1 document for PRD structure
    minimalDoc = {
      spec: "layout/v1", // Added spec as it's required by new schema
      canvas: { width: 1920, height: 1080, fps: 30 }, // Added canvas as it's required
      blocks: [],
      // No top-level sources: minimalDoc.sources from previous versions is removed
    };
  });

  test('should process an empty document (no blocks, bg, overlay)', async () => {
    // Minimal doc for this test already has no blocks, bg, or overlay
    const emptyDoc: LayoutV1 = {
      spec: "layout/v1",
      canvas: { w: 640, h: 360, fps: 10 },
      blocks: []
    };
    const timeline = await convertToCanonicalTimeline(emptyDoc);
    expect(timeline).toBeObject();
    expect(timeline.clips).toBeArrayOfSize(0);
    expect(timeline.canvasWidth).toBe(640); // Should take from doc.canvas
    expect(timeline.canvasHeight).toBe(360);
    expect(timeline.fps).toBe(10);
  });

  test('should transfer canvas properties from doc to timeline', async () => {
    const docWithCanvas: LayoutV1 = {
        spec: "layout/v1",
        canvas: { width: 1280, height: 720, fps: 25, background_color: "blue" },
        blocks: []
    };
    const timeline = await convertToCanonicalTimeline(docWithCanvas);
    expect(timeline.canvasWidth).toBe(1280);
    expect(timeline.canvasHeight).toBe(720);
    expect(timeline.fps).toBe(25);
    expect(timeline.canvasBackgroundColor).toBe("blue");
  });

  // This describe block was for the OLD convertToCanonicalTimeline.
  // It needs to be removed or its tests fully refactored for the new PRD-aligned structure.
  // For now, I will comment out the entire describe block to avoid confusion,
  // as all tests within it used the old 'sourceId' based block structure.
  // The specific test 'should use default duration...' will be rewritten below for the new structure.
  /*
  describe('Block Processing (Simplified based on current convertToCanonicalTimeline)', () => {
    // These tests reflect the current `convertToCanonicalTimeline` which takes `Block { sourceId, start, duration }`
    // This is different from PRD `LayoutV1.blocks[].visuals/audio`.
    // These tests will need to be updated when `convertToCanonicalTimeline` is updated.

    test('should process a single block with explicit start and duration', async () => {
      // ... old test logic ...
    });

    test('should use source duration if block duration is missing for video/audio', async () => {
      // ... old test logic ...
    });

    // The problematic test was here, it's being replaced below.

    test('should assign incrementing zIndex to sequential blocks', async () => {
      // ... old test logic ...
    });

    test('clips should be sorted by absoluteStartTime then zIndex', async () => {
       // ... old test logic ...
    });
  });
  */

  test('should use default duration for image/color elements if block and source element duration are missing', async () => {
    // This test now uses the PRD-aligned LayoutV1 structure.
    // convertToCanonicalTimeline has been refactored to process this structure.
    const doc: LayoutV1 = {
      spec: "layout/v1",
      // Use a fresh canvas for this specific test, not minimalDoc's, to be self-contained
      canvas: { w: 320, h: 240, fps: 15 },
      blocks: [
        {
          id: 'block_with_image',
          // No block duration, should be inferred from content.
          // If content also lacks duration, block gets default static duration.
          visuals: [
            {
              // id: 'img_el_1', // Element ID is optional in SourceV1
              kind: 'image',
              src: 'image.png', // Assuming this src is for context, not actual file loading in this specific test
              // No duration specified for this image element
            }
          ]
        },
        {
          id: 'block_with_colour',
          // No block duration
          visuals: [
            {
              // id: 'colour_el_1',
              kind: 'colour',
              src: 'blue',
              // No duration specified for this colour element
            }
          ]
        }
      ]
    };
    const timeline = await convertToCanonicalTimeline(doc);

    // Expect two clips, one for the image element, one for the colour element.
    // Both elements should receive DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT (2s) because
    // neither the elements nor their parent blocks define a duration.
    // The blocks themselves will also get this duration as it's inferred from their content.
    expect(timeline.clips).toBeArrayOfSize(2);

    const imageClip = timeline.clips.find(c => c.kind === 'image');
    const colourClip = timeline.clips.find(c => c.kind === 'colour');

    expect(imageClip).toBeDefined();
    // ID might be auto-generated, e.g. "block_with_image_vis_0"
    expect(imageClip?.id).toContain('block_with_image_vis_');
    expect(imageClip?.duration).toBe(2); // DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT (2s)

    expect(colourClip).toBeDefined();
    expect(colourClip?.id).toContain('block_with_colour_vis_');
    expect(colourClip?.duration).toBe(2); // DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT (2s)
  });

  describe('PRD LayoutV1 Specifics (Background, Overlay, Block Visuals/Audio, Timing with "at")', () => {
    // These tests assume convertToCanonicalTimeline WILL BE UPDATED to handle full LayoutV1.
    // They will likely FAIL with the current simplified implementation.

    test.todo('TODO: should process doc.background correctly (low zIndex, full duration)', async () => {
      // const docWithBg: LayoutV1 = { ... };
      // const timeline = await convertToCanonicalTimeline(docWithBg);
      // expect clip for background with zIndex 0, duration matching longest content or explicit.
    });

    test.todo('TODO: should process doc.overlay correctly (high zIndex)', async () => {
      // const docWithOverlay: LayoutV1 = { ... };
      // const timeline = await convertToCanonicalTimeline(docWithOverlay);
      // expect clips for overlay items with zIndex higher than blocks.
    });

    test.todo('TODO: should process block.visuals[].at for absolute timing', async () => {
        // const doc: LayoutV1 = {
        //   ...minimalDoc, // careful with minimalDoc, it's not PRD aligned
        //   spec: "layout/v1", canvas: {w:100,h:100,fps:10},
        //   blocks: [{
        //     id: 'b1',
        //     visuals: [{ id: 'v1', /*sourceId: 's1',*/ kind: 'image', src:'i.png', at: 2, duration: 3 }]
        //   }]
        // };
        // const timeline = await convertToCanonicalTimeline(doc);
        // expect(timeline.clips[0].absoluteStartTime).toBe(2); // if block start time is 0
    });

    test.todo('TODO: should handle sequential timing for visuals/audio within a block if "at" is missing', async () => {
        // This implies a "current time within block" concept.
        // const doc: LayoutV1 = { ... };
        // const timeline = await convertToCanonicalTimeline(doc);
        // ...
    });

    test.todo('TODO: should process multiple visuals/audio within a single block correctly', async () => {
        // This depends on interpretation: simultaneous layers within block time, or sequential?
        // CTClip is one source per clip. So this would mean multiple CTClips from one LayoutV1 block.
        // const doc: LayoutV1 = { ... };
        // const timeline = await convertToCanonicalTimeline(doc);
        // ...
    });
  });

  // Test for source processing (Now, sources are not top-level in CanonicalTimeline)
  test.todo('TODO: Re-evaluate how to test source processing if sources are not global on CanonicalTimeline');
  // test('should include all sources in timeline.sources, processed', async () => {
  //   const timeline = await convertToCanonicalTimeline(minimalDoc); // minimalDoc has old structure
    // expect(timeline.sources.length).toBe(minimalDoc.sources.length); // timeline.sources no longer exists
    // timeline.sources.forEach(s => {
    //   expect(s.resolvedPath).toBe(s.url);
    // });
  // });
});
