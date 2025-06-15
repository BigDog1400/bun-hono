import { expect, test, describe, beforeEach, vi, afterEach } from 'bun:test';
import { VideoRenderer, RendererOptions, RenderResult } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1, LayoutDocument } from '../../../src/renderer/schema/layout-v1';
import { convertToCanonicalTimeline, CanonicalTimeline, CTClip, CTSource, CTEffect, CTTransition } from '../../../src/renderer/core/CanonicalTimeline';
import { FilterGraphBuilder } from '../../../src/renderer/core/FilterGraphBuilder';
import { sourceRegistry, effectRegistry, transitionRegistry } from '../../../src/renderer/core/PluginRegistry';

// --- Mocks ---

// Mock convertToCanonicalTimeline
vi.mock('../../../src/renderer/core/CanonicalTimeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/renderer/core/CanonicalTimeline')>();
  return {
    ...actual, // Keep actual types
    convertToCanonicalTimeline: vi.fn(),
  };
});

// Mock Registries
vi.mock('../../../src/renderer/core/PluginRegistry', () => ({
  sourceRegistry: { get: vi.fn() },
  effectRegistry: { get: vi.fn() },
  transitionRegistry: { get: vi.fn() },
}));

// Mock FilterGraphBuilder and its methods that VideoRenderer interacts with
const mockFilterGraphBuilderInstance = {
  addInput: vi.fn(), // For global inputs added by VideoRenderer from timeline.sources
  addClipToGraph: vi.fn(), // This is the key method VideoRenderer uses per clip
  buildCommandArgs: vi.fn().mockReturnValue(['ffmpeg_args_mock']), // Mock return value
  build: vi.fn().mockReturnValue('filter_complex_string_mock'), // If build() is used instead of buildCommandArgs
};

vi.mock('../../../src/renderer/core/FilterGraphBuilder', () => ({
  FilterGraphBuilder: vi.fn(() => mockFilterGraphBuilderInstance),
}));

// Mock FFmpeg execution (VideoRenderer currently logs, doesn't execute a separate module)
// If it did:
// vi.mock('../path/to/ffmpegExecutor', () => ({ executeFFmpeg: vi.fn() }));


describe('VideoRenderer', () => {
  let renderer: VideoRenderer;
  let mockDoc: LayoutV1;
  let mockTimeline: CanonicalTimeline;
  let mockOptions: RendererOptions;

  beforeEach(() => {
    mockOptions = {
      outputDir: 'test_output',
      outputFile: 'video.mp4',
      enableVerboseLogging: false, // Keep false to reduce console noise during tests
    };
    renderer = new VideoRenderer(mockOptions);

    mockDoc = {
      version: 'v1',
      sources: [{ id: 's1', url: 'src1.mp4', kind: 'video', duration: 10 }],
      blocks: [{ id: 'b1', sourceId: 's1', start: 0, duration: 10 } as any], // Simplified block for current CT
    };

    // Define a simple timeline that convertToCanonicalTimeline would return
    const source1: CTSource = { id: 's1', url: 'src1.mp4', resolvedPath: 'src1.mp4', kind: 'video', duration: 10 };
    const clip1: CTClip = {
      id: 'c1',
      sourceId: 's1',
      kind: 'video',
      src: 'src1.mp4',
      absoluteStartTime: 0,
      duration: 5,
      zIndex: 1,
      effects: [{ id: 'e1', kind: 'fade', params: { type: 'in', duration: 1 } } as CTEffect],
    };
    const clip2: CTClip = {
      id: 'c2',
      sourceId: 's1', // Using same source for simplicity
      kind: 'video',
      src: 'src1.mp4',
      absoluteStartTime: 5,
      duration: 5,
      zIndex: 1,
    };
    mockTimeline = {
      version: 'v1',
      canvasWidth: 1920,
      canvasHeight: 1080,
      fps: 30,
      sources: [source1],
      clips: [clip1, clip2],
      // transitions: [{ id: 't1', kind: 'crossfade', duration: 1, fromClipId: 'c1', toClipId: 'c2' }] // Conceptual
    };

    // Setup mock implementations
    vi.mocked(convertToCanonicalTimeline).mockResolvedValue(mockTimeline);
    // vi.mocked(executeFFmpeg).mockResolvedValue({ success: true }); // If actual execution was called
  });

  afterEach(() => {
    vi.clearAllMocks(); // Clear mocks between tests
  });

  test('successful render path - high-level orchestration', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); // Suppress and spy on ffmpeg command log

    const result = await renderer.render(mockDoc);

    // 1. Verify convertToCanonicalTimeline call
    expect(convertToCanonicalTimeline).toHaveBeenCalledWith(mockDoc);
    expect(convertToCanonicalTimeline).toHaveBeenCalledTimes(1);

    // 2. Verify FilterGraphBuilder instantiation
    expect(FilterGraphBuilder).toHaveBeenCalledTimes(1);
    // expect(FilterGraphBuilder).toHaveBeenCalledWith({ /* options if passed to constructor */ });

    // 3. Verify builder.addInput for each source in timeline.sources
    // This was part of VideoRenderer's previous implementation sketch.
    expect(mockFilterGraphBuilderInstance.addInput).toHaveBeenCalledTimes(mockTimeline.sources.length);
    for (const source of mockTimeline.sources) {
      expect(mockFilterGraphBuilderInstance.addInput).toHaveBeenCalledWith(source.resolvedPath);
    }

    // 4. Verify builder.addClipToGraph for each clip
    // This is the key delegation point.
    expect(mockFilterGraphBuilderInstance.addClipToGraph).toHaveBeenCalledTimes(mockTimeline.clips.length);
    for (const clip of mockTimeline.clips) {
      expect(mockFilterGraphBuilderInstance.addClipToGraph).toHaveBeenCalledWith(
        clip,
        mockTimeline.sources,
        sourceRegistry, // Passed directly
        effectRegistry,   // Passed directly
        transitionRegistry // Passed directly
      );
    }

    // 5. Verify FFmpeg command generation
    expect(mockFilterGraphBuilderInstance.buildCommandArgs).toHaveBeenCalledWith(
      `${mockOptions.outputDir}/${mockOptions.outputFile}`
    );
    expect(mockFilterGraphBuilderInstance.buildCommandArgs).toHaveBeenCalledTimes(1);

    // 6. Verify FFmpeg execution (currently logging)
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('FFmpeg execution placeholder. Command:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ffmpeg ffmpeg_args_mock'));


    // 7. Verify successful result
    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(`${mockOptions.outputDir}/${mockOptions.outputFile}`);

    consoleLogSpy.mockRestore();
  });

  test('should return error result if convertToCanonicalTimeline fails', async () => {
    const errorMessage = 'CanonicalTimeline conversion failed';
    vi.mocked(convertToCanonicalTimeline).mockRejectedValue(new Error(errorMessage));

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(FilterGraphBuilder).not.toHaveBeenCalled(); // Should fail before builder instantiation
  });

  test('should return error result if builder.addClipToGraph fails', async () => {
    const errorMessage = 'addClipToGraph failed';
    mockFilterGraphBuilderInstance.addClipToGraph.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(mockFilterGraphBuilderInstance.buildCommandArgs).not.toHaveBeenCalled(); // Should fail before command generation
  });

  test('should return error result if builder.buildCommandArgs fails', async () => {
    const errorMessage = 'buildCommandArgs failed';
    mockFilterGraphBuilderInstance.buildCommandArgs.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const result = await renderer.render(mockDoc);
    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
     // FFmpeg (logging part) should not be called
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('FFmpeg execution placeholder'));
    consoleLogSpy.mockRestore();
  });

  // Test for "Plugin not found" is tricky if addClipToGraph is the one resolving plugins.
  // If VideoRenderer itself called registry.get() and a plugin was missing, that would be testable here.
  // Since addClipToGraph is a black box for this test, we assume it handles internal plugin resolution errors.
  // If VideoRenderer was responsible for getting plugins for addClipToGraph, we'd test:
  // test.todo('should return error if a required plugin is not found');

  // Test for FFmpeg execution failure (if it were a real execution)
  // test.todo('should return error result if FFmpeg execution fails');
  // vi.mocked(executeFFmpeg).mockResolvedValue({ success: false, error: 'ffmpeg error' });
  // const result = await renderer.render(mockDoc);
  // expect(result.success).toBe(false);
  // expect(result.error).toBe('ffmpeg error');
});
