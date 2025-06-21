import { expect, test, describe, beforeEach } from 'bun:test';
import {
    convertToCanonicalTimeline,
    CanonicalTimeline,
    CTClip,
    CTSource, // CTSource is the processed one with uniqueId
    // Assuming CTEffect and CTTransition are not primary outputs for these tests
} from '../../../src/renderer/core/CanonicalTimeline';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1'; // Actual Zod inferred type

// Default values used by the current convertToCanonicalTimeline implementation in CanonicalTimeline.ts
// const DEFAULT_FPS = 30; // Not needed here, taken from doc.canvas
// const DEFAULT_CANVAS_WIDTH = 1920; // Not needed here
// const DEFAULT_CANVAS_HEIGHT = 1080; // Not needed here
// const DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT = 2; // This is defined in main code

describe('convertToCanonicalTimeline', () => {
  let minimalDocForCanvas: LayoutV1;

  beforeEach(() => {
    // A minimal valid LayoutV1 document for default canvas properties if not specified in test case
    minimalDocForCanvas = {
      spec: "layout/v1",
      canvas: { width: 1920, height: 1080, fps: 30 },
      blocks: [],
    };
  });

  test('should process an empty document (no blocks, bg, overlay)', async () => {
    const emptyDoc: LayoutV1 = {
      spec: "layout/v1",
      canvas: { w: 640, h: 360, fps: 10 },
      blocks: []
      // no background, no overlay implies they are undefined
    };
    const timeline = await convertToCanonicalTimeline(emptyDoc);
    expect(timeline).toBeObject();
    expect(timeline.clips).toBeArrayOfSize(0);
    expect(timeline.processedSources).toBeArrayOfSize(0);
    expect(timeline.canvasWidth).toBe(640);
    expect(timeline.canvasHeight).toBe(360);
    expect(timeline.fps).toBe(10);
    expect(timeline.canvasBackgroundColor).toBeUndefined(); // as it's not in emptyDoc.canvas
  });

  test('should transfer canvas properties from doc to timeline', async () => {
    const docWithCanvas: LayoutV1 = {
        spec: "layout/v1",
        canvas: { w: 1280, h: 720, fps: 25, background_color: "blue" },
        blocks: []
    };
    const timeline = await convertToCanonicalTimeline(docWithCanvas);
    expect(timeline.canvasWidth).toBe(1280);
    expect(timeline.canvasHeight).toBe(720);
    expect(timeline.fps).toBe(25);
    expect(timeline.canvasBackgroundColor).toBe("blue");
  });

  test('should use default duration for image/color elements if block and source element duration are missing', async () => {
    const doc: LayoutV1 = {
      spec: "layout/v1",
      canvas: { w: 320, h: 240, fps: 15 },
      blocks: [
        {
          id: 'block_with_image',
          visuals: [
            {
              kind: 'image',
              src: 'image.png',
            }
          ]
        },
        {
          id: 'block_with_colour',
          visuals: [
            {
              kind: 'colour',
              src: 'blue',
            }
          ]
        }
      ]
    };
    const timeline = await convertToCanonicalTimeline(doc);

    expect(timeline.clips).toBeArrayOfSize(2);
    expect(timeline.processedSources).toBeArrayOfSize(2);

    const imageClip = timeline.clips.find(c => c.kind === 'image');
    const colourClip = timeline.clips.find(c => c.kind === 'colour');

    expect(imageClip).toBeDefined();
    expect(imageClip?.id).toContain('block_with_image_vis_');
    expect(imageClip?.duration).toBe(2); // DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT (2s)
    expect(imageClip?.sourceIdRef).toBeDefined();
    const imageSource = timeline.processedSources.find(s => s.uniqueId === imageClip?.sourceIdRef);
    expect(imageSource?.kind).toBe('image');

    expect(colourClip).toBeDefined();
    expect(colourClip?.id).toContain('block_with_colour_vis_');
    expect(colourClip?.duration).toBe(2); // DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT (2s)
    expect(colourClip?.sourceIdRef).toBeDefined();
    const colourSource = timeline.processedSources.find(s => s.uniqueId === colourClip?.sourceIdRef);
    expect(colourSource?.kind).toBe('colour');
  });

  // Commented out describe block for old structure tests
  /*
  describe('Block Processing (Simplified based on current convertToCanonicalTimeline)', () => {
    // ... (old tests that are no longer valid) ...
  });
  */

  describe('PRD LayoutV1 Specifics (Background, Overlay, Block Visuals/Audio, Timing with "at")', () => {
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
        //   spec: "layout/v1", canvas: {w:100,h:100,fps:10},
        //   blocks: [{
        //     id: 'b1',
        //     visuals: [{ id: 'v1', kind: 'image', src:'i.png', at: 2, duration: 3 }]
        //   }]
        // };
        // const timeline = await convertToCanonicalTimeline(doc);
        // expect(timeline.clips[0].absoluteStartTime).toBe(2); // if block start time is 0
    });

    test.todo('TODO: should handle sequential timing for visuals/audio within a block if "at" is missing', async () => {
        // This implies a "current time within block" concept.
    });

    test.todo('TODO: should process multiple visuals/audio within a single block correctly', async () => {
        // This depends on interpretation: simultaneous layers within block time, or sequential?
    });
  });

  test('should correctly link clips to processed sources with original IDs if provided', async () => {
    const doc: LayoutV1 = {
      spec: "layout/v1",
      canvas: { w: 320, h: 240, fps: 15 },
      background: { id: "bgSrcOriginal", kind: "colour", src: "grey" },
      blocks: [
        {
          id: 'b1',
          visuals: [ { id: 'visSrcOriginal1', kind: 'image', src: 'img.png', duration: 2 } ],
          audio: [ { id: 'audSrcOriginal1', kind: 'audio', src: 'aud.mp3', duration: 2 } ]
        }
      ],
      overlay: { id: "overlaySrcOriginal", kind: "image", src: "logo.png", duration: 1, at: 0 }
    };
    const timeline = await convertToCanonicalTimeline(doc);

    expect(timeline.processedSources.length).toBe(4);
    expect(timeline.clips.length).toBe(4);

    for (const clip of timeline.clips) {
      expect(clip.sourceIdRef).toBeDefined();
      const correspondingSource = timeline.processedSources.find(s => s.uniqueId === clip.sourceIdRef);
      expect(correspondingSource).toBeDefined();
      // If original SourceV1 had an 'id', it should be the same as uniqueId
      if (correspondingSource?.id) {
        expect(clip.sourceIdRef).toBe(correspondingSource.id);
      }
    }
    expect(timeline.processedSources.find(s=>s.uniqueId === "bgSrcOriginal")).toBeDefined();
    expect(timeline.processedSources.find(s=>s.uniqueId === "visSrcOriginal1")).toBeDefined();
    expect(timeline.processedSources.find(s=>s.uniqueId === "audSrcOriginal1")).toBeDefined();
    expect(timeline.processedSources.find(s=>s.uniqueId === "overlaySrcOriginal")).toBeDefined();
  });

  test.todo('TODO: Re-evaluate zIndex tests for new block structure');
  test.todo('TODO: Re-evaluate sorting tests for new block structure and z-indexing');
  test.todo('TODO: Re-evaluate how to test source processing if sources are not global on CanonicalTimeline');
});
