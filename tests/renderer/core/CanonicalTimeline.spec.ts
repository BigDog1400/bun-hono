// tests/renderer/core/CanonicalTimeline.spec.ts
import { convertToCanonicalTimeline, probeSource, CanonicalTimeline } from '../../../src/renderer/core/CanonicalTimeline';
import type { CTClip, RendererOptions, Source } from '../../../src/renderer/types';
import { LayoutV1, LayoutDocumentSchema } from '../../../src/renderer/schema/layout-v1';

// Mock the probeSource function for predictable results in tests
jest.mock('../../../src/renderer/core/CanonicalTimeline', () => ({
  ...jest.requireActual('../../../src/renderer/core/CanonicalTimeline'), // Import and retain default exports
  probeSource: jest.fn(), // Mock probeSource specifically
}));

describe('convertToCanonicalTimeline', () => {
  let mockLayout: LayoutV1;
  let mockOptions: RendererOptions;
  const mockedProbeSource = probeSource as jest.Mock;

  beforeEach(() => {
    mockedProbeSource.mockReset();

    // Default mock implementation for probeSource
    mockedProbeSource.mockImplementation(async (source: Source, blockDuration?: number) => {
      if (source.kind === 'video') {
        return { duration: 10, width: 1920, height: 1080, hasAudio: true, hasVideo: true };
      }
      if (source.kind === 'audio') {
        return { duration: 15, hasAudio: true, hasVideo: false };
      }
      if (source.kind === 'image') {
        return { duration: blockDuration ?? Infinity, width: 800, height: 600, hasAudio: false, hasVideo: true };
      }
      if (source.kind === 'colour') {
        return { duration: blockDuration ?? Infinity, hasAudio: false, hasVideo: true };
      }
      return { duration: 0, width:0, height:0, hasAudio:false, hasVideo:false};
    });

    mockOptions = {
      outputDir: 'test',
      canvas: { w: 1920, h: 1080, fps: 30 } // This canvas in options is for renderer, not the layout's canvas for CT conversion.
                                            // convertToCanonicalTimeline takes layout.canvas directly.
    };
  });

  it('should convert a simple layout with one video block', async () => {
    mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1280, h: 720, fps: 25 },
      blocks: [
        {
          id: 'block1',
          visuals: [{ kind: 'video', src: 'video.mp4', w: 640, h: 360 }],
          duration: 5, // Explicit block duration
        },
      ],
    });

    mockedProbeSource.mockResolvedValueOnce({ duration: 10, width: 1920, height: 1080, hasVideo: true, hasAudio: false });

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);

    expect(timeline.clips).toHaveLength(1);
    const clip = timeline.clips[0];
    expect(clip.id).toBe('block1_visual_0');
    expect(clip.kind).toBe('video');
    expect(clip.src).toBe('video.mp4');
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(5); // Clipped by block duration
    expect(clip.end).toBe(5);
    expect(clip.props?.w).toBe(640); // From source
    expect(clip.props?.h).toBe(360); // From source
    expect(timeline.duration).toBe(5);
    expect(timeline.canvas).toEqual({ w: 1280, h: 720, fps: 25, background: undefined });
  });

  it('should infer block duration from audio if not specified', async () => {
    mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1280, h: 720, fps: 25 },
      blocks: [
        {
          id: 'block1',
          audio: { kind: 'audio', src: 'music.mp3' },
          visuals: [{ kind: 'image', src: 'bg.png' }], // Image fills block
        },
      ],
    });

    // Mock probe for audio (determines block duration)
    mockedProbeSource.mockImplementation(async (source: Source) => {
      if (source.kind === 'audio') return { duration: 12, hasAudio: true, hasVideo: false };
      if (source.kind === 'image') return { duration: Infinity, width:1280, height:720, hasVideo: true, hasAudio: false };
      return { duration: 0, width:0, height:0, hasAudio:false, hasVideo:false };
    });

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);

    expect(timeline.clips).toHaveLength(2); // 1 image, 1 audio
    const imageClip = timeline.clips.find(c => c.kind === 'image')!;
    const audioClip = timeline.clips.find(c => c.kind === 'audio')!;

    expect(audioClip.duration).toBe(12);
    expect(imageClip.duration).toBe(12); // Image takes duration of block (from audio)
    expect(timeline.duration).toBe(12);
  });

  it('should handle sequential blocks correctly (advancing currentTime)', async () => {
    mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1280, h: 720, fps: 25 },
      blocks: [
        { id: 'b1', duration: 5, visuals: [{kind: 'colour', src: 'red'}] }, // Block 1: 0-5s
        { id: 'b2', duration: 3, visuals: [{kind: 'colour', src: 'blue'}] }, // Block 2: 5-8s
      ],
    });

    // Mock for colour sources (duration will be block duration)
    mockedProbeSource.mockImplementation(async (source: Source, blockDuration?:number ) => {
      if (source.kind === 'colour') return { duration: blockDuration ?? 0, hasVideo: true, hasAudio: false };
      return { duration: 0, width:0, height:0, hasAudio:false, hasVideo:false };
    });

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);

    expect(timeline.clips).toHaveLength(2);
    const clip1 = timeline.clips.find(c => c.id === 'b1_visual_0')!;
    const clip2 = timeline.clips.find(c => c.id === 'b2_visual_0')!;

    expect(clip1.start).toBe(0);
    expect(clip1.duration).toBe(5);
    expect(clip1.end).toBe(5);

    expect(clip2.start).toBe(5);
    expect(clip2.duration).toBe(3);
    expect(clip2.end).toBe(8);

    expect(timeline.duration).toBe(8);
  });

  it('should use block.at for absolute timing, not advancing currentTime', async () => {
    mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1280, h: 720, fps: 25 },
      blocks: [
        { id: 'b1', duration: 5, visuals: [{kind: 'colour', src: 'red'}] }, // Block 1: 0-5s, currentTime becomes 5
        { id: 'b2', at: 2, duration: 3, visuals: [{kind: 'colour', src: 'blue'}] }, // Block 2: 2-5s, currentTime remains 5
      ],
    });
     mockedProbeSource.mockImplementation(async (source: Source, blockDuration?:number ) => {
      if (source.kind === 'colour') return { duration: blockDuration ?? 0, hasVideo: true, hasAudio: false };
      return { duration: 0, width:0, height:0, hasAudio:false, hasVideo:false };
    });

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);

    const clip1 = timeline.clips.find(c => c.id === 'b1_visual_0')!;
    const clip2 = timeline.clips.find(c => c.id === 'b2_visual_0')!;

    expect(clip1.start).toBe(0);
    expect(clip1.end).toBe(5);

    expect(clip2.start).toBe(2); // Absolute time
    expect(clip2.end).toBe(5);   // Start (2) + Duration (3)

    // Timeline duration is max of all clip end times
    expect(timeline.duration).toBe(5);
  });

  it('should correctly apply default props and use probed dimensions', async () => {
    mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1920, h: 1080, fps: 30 },
      blocks: [
        { visuals: [{ kind: 'image', src: 'test.jpg' }], duration: 5 }
      ],
    });

    mockedProbeSource.mockResolvedValueOnce({ duration: Infinity, width: 800, height: 600, hasVideo: true, hasAudio: false });

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);
    const clip = timeline.clips[0];

    expect(clip.props?.x).toBe(0); // Default
    expect(clip.props?.y).toBe(0); // Default
    expect(clip.props?.w).toBe(800); // From probe
    expect(clip.props?.h).toBe(600); // From probe
    expect(clip.props?.opacity).toBe(1.0); // Default
    expect(clip.props?.resize).toBe('stretch'); // Default
  });

  it('should sort clips by start time, then track', async () => {
     mockLayout = LayoutDocumentSchema.parse({
      spec: 'layout/v1',
      canvas: { w: 1280, h: 720, fps: 25 },
      blocks: [
        {
          id: 'b1',
          at: 0,
          duration: 5,
          visuals: [
            { kind: 'colour', src: 'red', y: 10 }, // track 1 (index 0 + 1)
            { kind: 'colour', src: 'green', y: 20 } // track 2 (index 1 + 1)
          ],
          audio: { kind: 'audio', src: 'noise.mp3'} // track 0
        },
        {
          id: 'b2',
          at: 0, // Same start time as b1's content
          duration: 2,
          visuals: [ {kind: 'colour', src: 'blue', y: 30} ] // track 1
        }
      ],
    });

    // Simplified probe for this test
    mockedProbeSource.mockImplementation(async (s:Source, bd?:number) => ({duration: bd || 5, width:1280, height:720, hasVideo: s.kind !== 'audio', hasAudio: s.kind === 'audio'}));

    const timeline = await convertToCanonicalTimeline(mockLayout, mockOptions);

    // Expected order:
    // 1. b1_audio (start 0, track 0)
    // 2. b1_visual_0 (start 0, track 1, src red)
    // 3. b2_visual_0 (start 0, track 1, src blue) -> Note: if two clips have same start and track, original order is preserved.
    // 4. b1_visual_1 (start 0, track 2, src green)
    // This test highlights that unique track numbers are important for deterministic sorting if start times are identical.
    // The current implementation gives visuals of the same block different tracks,
    // but visuals from different blocks (if they start at the same time) could get the same track number.
    // The PRD states: "time-sorted, and layer-sorted list of CTClip objects."
    // This needs careful thought for global Z-indexing. For now, block-level track is tested.

    expect(timeline.clips.map(c => `${c.id}_track${c.track}`)).toEqual([
      'b1_audio_track0',
      'b1_visual_0_track1', // red
      'b2_visual_0_track1', // blue
      'b1_visual_1_track2', // green
    ]);
    // Verifying actual sort order based on start time then track
     expect(timeline.clips[0].id).toBe('b1_audio'); // track 0
     expect(timeline.clips[0].track).toBe(0);

     // Clips at start=0, track=1
     const track1Clips = timeline.clips.filter(c => c.start === 0 && c.track === 1).map(c => c.id);
     expect(track1Clips).toContain('b1_visual_0'); // red
     expect(track1Clips).toContain('b2_visual_0'); // blue

     expect(timeline.clips.find(c => c.id === 'b1_visual_1')?.track).toBe(2); // green, track 2
  });

});
