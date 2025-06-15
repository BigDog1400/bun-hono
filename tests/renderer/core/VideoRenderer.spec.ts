import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test';
import { VideoRenderer, RendererOptions, RenderResult } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1';
import { CanonicalTimeline, CTClip, CTSource, CTEffect } from '../../../src/renderer/core/CanonicalTimeline'; // Keep actual types
// PluginRegistry is used by VideoRenderer to pass to FGB, so we need its actual structure, not a full mock
import { sourceRegistry, effectRegistry, transitionRegistry } from '../../../src/renderer/core/PluginRegistry';


// --- Bun Mocks ---

// Mock for convertToCanonicalTimeline
const mockConvertToCanonicalTimeline = mock.fn();
mock.module('../../../src/renderer/core/CanonicalTimeline', () => ({
  convertToCanonicalTimeline: mockConvertToCanonicalTimeline,
  // Export other types if VideoRenderer file imports them directly from CanonicalTimeline module
  // For now, assuming VideoRenderer only imports convertToCanonicalTimeline function and types
}));

// Mock for FilterGraphBuilder
const mockFGBAddInput = mock.fn();
const mockFGBAddClipToGraph = mock.fn();
const mockFGBBuildCommandArgs = mock.fn().mockReturnValue(['ffmpeg_args_mock']); // Default mock return
const mockFGBInstance = {
  addInput: mockFGBAddInput,
  addClipToGraph: mockFGBAddClipToGraph,
  buildCommandArgs: mockFGBBuildCommandArgs,
  // build: mock.fn().mockReturnValue('filter_complex_string_mock'), // if build() were used
};
const mockFilterGraphBuilderConstructor = mock.fn(() => mockFGBInstance);
mock.module('../../../src/renderer/core/FilterGraphBuilder', () => ({
  FilterGraphBuilder: mockFilterGraphBuilderConstructor,
}));

// Mock for ffmpeg-executor
const mockExecuteFFmpegCommand = mock.fn();
mock.module('../../../src/renderer/utils/ffmpeg-executor', () => ({
  executeFFmpegCommand: mockExecuteFFmpegCommand,
}));


// --- Test Suite ---

describe('VideoRenderer', () => {
  let renderer: VideoRenderer;
  let mockDoc: LayoutV1;
  let mockTimeline: CanonicalTimeline;
  let mockOptions: RendererOptions;

  beforeEach(() => {
    // Reset mocks before each test to clear call counts, etc.
    mockConvertToCanonicalTimeline.mockClear();
    mockFilterGraphBuilderConstructor.mockClear();
    mockFGBAddInput.mockClear();
    mockFGBAddClipToGraph.mockClear();
    mockFGBBuildCommandArgs.mockClear().mockReturnValue(['ffmpeg_args_mock']); // Reset and keep default
    mockExecuteFFmpegCommand.mockClear();

    mockOptions = {
      outputDir: 'test_output',
      outputFile: 'video.mp4',
      enableVerboseLogging: false,
    };
    renderer = new VideoRenderer(mockOptions);

    mockDoc = {
      version: 'v1',
      sources: [{ id: 's1', url: 'src1.mp4', kind: 'video', duration: 10 }],
      blocks: [{ id: 'b1', sourceId: 's1', start: 0, duration: 10 } as any],
    };

    const source1: CTSource = { id: 's1', url: 'src1.mp4', resolvedPath: 'src1.mp4', kind: 'video', duration: 10 };
    const clip1: CTClip = {
      id: 'c1', sourceId: 's1', kind: 'video', src: 'src1.mp4',
      absoluteStartTime: 0, duration: 5, zIndex: 1,
      effects: [{ id: 'e1', kind: 'fade', params: { type: 'in', duration: 1 } } as CTEffect],
    };
    const clip2: CTClip = {
      id: 'c2', sourceId: 's1', kind: 'video', src: 'src1.mp4',
      absoluteStartTime: 5, duration: 5, zIndex: 1,
    };
    mockTimeline = {
      version: 'v1', canvasWidth: 1920, canvasHeight: 1080, fps: 30,
      sources: [source1],
      clips: [clip1, clip2],
    };

    mockConvertToCanonicalTimeline.mockResolvedValue(mockTimeline);
    mockExecuteFFmpegCommand.mockResolvedValue({ success: true }); // Default to success
  });

  afterEach(() => {
    // No need for vi.clearAllMocks() as we are clearing specific mocks in beforeEach
  });

  test('successful render path - high-level orchestration', async () => {
    // const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); // Bun's mock doesn't have vi.spyOn
    // For console logs, if needed, could mock global console.log with mock.fn() but that's more involved.
    // The ffmpeg-executor now handles logging, so VideoRenderer console output is less critical.

    const result = await renderer.render(mockDoc);

    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledWith(mockDoc);
    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledTimes(1);

    expect(mockFilterGraphBuilderConstructor).toHaveBeenCalledTimes(1);
    // expect(mockFilterGraphBuilderConstructor).toHaveBeenCalledWith({ /* options if passed */ });

    expect(mockFGBAddInput).toHaveBeenCalledTimes(mockTimeline.sources.length);
    for (const source of mockTimeline.sources) {
      expect(mockFGBAddInput).toHaveBeenCalledWith(source.resolvedPath);
    }

    expect(mockFGBAddClipToGraph).toHaveBeenCalledTimes(mockTimeline.clips.length);
    for (const clip of mockTimeline.clips) {
      expect(mockFGBAddClipToGraph).toHaveBeenCalledWith(
        clip,
        mockTimeline.sources,
        sourceRegistry,
        effectRegistry,
        transitionRegistry
      );
    }

    expect(mockFGBBuildCommandArgs).toHaveBeenCalledWith(
      `${mockOptions.outputDir}/${mockOptions.outputFile}`
    );
    expect(mockFGBBuildCommandArgs).toHaveBeenCalledTimes(1);

    expect(mockExecuteFFmpegCommand).toHaveBeenCalledWith(
      ['ffmpeg_args_mock'], // This was the default return from mockFGBBuildCommandArgs
      {
        ffmpegPath: mockOptions.ffmpegPath, // VideoRenderer sets default 'ffmpeg' if not in options
        enableVerboseLogging: mockOptions.enableVerboseLogging,
      }
    );
    expect(mockExecuteFFmpegCommand).toHaveBeenCalledTimes(1);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(`${mockOptions.outputDir}/${mockOptions.outputFile}`);

    // consoleLogSpy.mockRestore(); // if using console spy
  });

  test('should return error result if convertToCanonicalTimeline fails', async () => {
    const errorMessage = 'CanonicalTimeline conversion failed';
    mockConvertToCanonicalTimeline.mockRejectedValue(new Error(errorMessage));

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(mockFilterGraphBuilderConstructor).not.toHaveBeenCalled();
  });

  test('should return error result if builder.addClipToGraph fails', async () => {
    const errorMessage = 'addClipToGraph failed';
    mockFGBAddClipToGraph.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(mockFGBBuildCommandArgs).not.toHaveBeenCalled();
  });

  test('should return error result if builder.buildCommandArgs fails', async () => {
    const errorMessage = 'buildCommandArgs failed';
    mockFGBBuildCommandArgs.mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const result = await renderer.render(mockDoc);
    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(mockExecuteFFmpegCommand).not.toHaveBeenCalled();
  });

  test('should return error result if FFmpeg execution fails', async () => {
    const ffmpegErrorMsg = 'ffmpeg actual error output';
    const ffmpegDetails = 'ffmpeg exited with code 1';
    mockExecuteFFmpegCommand.mockResolvedValue({ success: false, errorLog: ffmpegErrorMsg, details: ffmpegDetails });

    const result = await renderer.render(mockDoc);
    expect(result.success).toBe(false);
    expect(result.error).toBe(`FFmpeg execution failed: ${ffmpegDetails}`);
    expect(result.details).toBe(ffmpegErrorMsg);
  });
});
