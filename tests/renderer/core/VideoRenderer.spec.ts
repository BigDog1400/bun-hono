import { expect, test, describe, beforeEach, afterEach, mock, spyOn, type Mock } from 'bun:test';
import { VideoRenderer, RendererOptions } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1';
import { CanonicalTimeline, CTClip, CTSource, CTEffect } from '../../../src/renderer/core/CanonicalTimeline';
import { sourceRegistry, effectRegistry, transitionRegistry } from '../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../src/renderer/core/FilterGraphBuilder'; // Import the actual class

// --- Bun Mocks ---
// Spies for FilterGraphBuilder methods
let spiedFGBAddInput: Mock<any>;
let spiedFGBAddClipToGraph: Mock<any>;
let spiedFGBBuildCommandArgs: Mock<any>;

// Mock for convertToCanonicalTimeline
const mockConvertToCanonicalTimeline: Mock<(doc: LayoutV1) => Promise<CanonicalTimeline>> = mock();
mock.module('../../../src/renderer/core/CanonicalTimeline', () => ({
  convertToCanonicalTimeline: mockConvertToCanonicalTimeline,
}));

// FilterGraphBuilder will be spied upon, not fully mocked at module level.
// const mockFGBAddInput: Mock<(path: string) => void> = mock(); // To be replaced by spy
// const mockFGBAddClipToGraph: Mock<(clip: CTClip, sources: CTSource[], ...rest: any[]) => void> = mock(); // To be replaced by spy
// const mockFGBBuildCommandArgs: Mock<(outputPath: string) => string[]> = mock().mockReturnValue(['ffmpeg_args_mock']); // To be replaced by spy
// const mockFGBInstance = {
//   addInput: mockFGBAddInput,
//   addClipToGraph: mockFGBAddClipToGraph,
//   buildCommandArgs: mockFGBBuildCommandArgs,
// };
// const mockFilterGraphBuilderConstructor: Mock<(options: any) => typeof mockFGBInstance> = mock(() => mockFGBInstance); // To be removed
// mock.module('../../../src/renderer/core/FilterGraphBuilder', () => ({ // To be removed
//   FilterGraphBuilder: mockFilterGraphBuilderConstructor,
// }));

// Mock for ffmpeg-executor
type FFmpegExecutorOptions = { ffmpegPath: string; enableVerboseLogging?: boolean; };
type FFmpegResult = { success: boolean; errorLog?: string; details?: string; };
const mockExecuteFFmpegCommand: Mock<(args: string[], options: FFmpegExecutorOptions) => Promise<FFmpegResult>> = mock();
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
    // Reset mocks before each test
    mockConvertToCanonicalTimeline.mockClear();
    mockExecuteFFmpegCommand.mockClear();

    // Setup spies for FilterGraphBuilder methods
    spiedFGBAddInput = spyOn(FilterGraphBuilder.prototype, 'addInput');
    spiedFGBAddClipToGraph = spyOn(FilterGraphBuilder.prototype, 'addClipToGraph');
    spiedFGBBuildCommandArgs = spyOn(FilterGraphBuilder.prototype, 'buildCommandArgs').mockReturnValue(['ffmpeg_args_mock']);

    mockOptions = {
      outputDir: 'test_output',
      outputFile: 'video.mp4',
      enableVerboseLogging: false,
    };
    renderer = new VideoRenderer(mockOptions);

    mockDoc = {
      version: 'v1',
      sources: [{ id: 's1', url: 'src1.mp4', kind: 'video', duration: 10 }], // Input doc structure
      blocks: [{ id: 'b1', visuals: [{id: 'v1', kind: 'video', src: 'src1.mp4', duration: 10}] }],
    };

    const mockTimelineSources: CTSource[] = [ // Renamed for clarity, used for processedSources
      { id: 's1', url: 'src1.mp4', resolvedPath: 'src1.mp4', kind: 'video', duration: 10 },
    ];

    const clip1: CTClip = {
      id: 'c1',
      sourceId: 's1',
      kind: 'video',
      src: 'src1.mp4',
      absoluteStartTime: 0, duration: 5, zIndex: 1,
      effects: [{ id: 'e1', kind: 'fade', params: { type: 'in', duration: 1 } } as CTEffect],
    };
    const clip2: CTClip = {
      id: 'c2',
      sourceId: 's1',
      kind: 'video',
      src: 'src1.mp4',
      absoluteStartTime: 5, duration: 5, zIndex: 1,
    };

    mockTimeline = {
      version: 'v1',
      canvasWidth: 1920,
      canvasHeight: 1080,
      fps: 30,
      processedSources: mockTimelineSources, // Use processedSources
      clips: [clip1, clip2],
      transitions: [],
      // sources: [], // Explicitly empty or undefined if it shouldn't be used
    };

    mockConvertToCanonicalTimeline.mockResolvedValue(mockTimeline);
    mockExecuteFFmpegCommand.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    // Restore all spied methods
    spiedFGBAddInput.mockRestore();
    spiedFGBAddClipToGraph.mockRestore();
    spiedFGBBuildCommandArgs.mockRestore();
  });

  test('successful render path - high-level orchestration', async () => {
    const result = await renderer.render(mockDoc);

    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledWith(mockDoc);
    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledTimes(1);

    // expect(mockFilterGraphBuilderConstructor).toHaveBeenCalledTimes(1); // Removed as we no longer mock the constructor
    
    // As per VideoRenderer implementation, `addInputsForTimeline` is called once
    // and is expected to handle all sources.
    // Let's assume an updated `addInputsForTimeline` method on the builder
    // Or verify the individual calls if that's the internal logic.
    // Based on the old test, it iterates and calls addInput.
    expect(spiedFGBAddInput).toHaveBeenCalledTimes(mockTimeline.processedSources.length);
    for (const source of mockTimeline.processedSources) {
      expect(spiedFGBAddInput).toHaveBeenCalledWith(source.resolvedPath);
    }

    expect(spiedFGBAddClipToGraph).toHaveBeenCalledTimes(mockTimeline.clips.length);
    for (const clip of mockTimeline.clips) {
      expect(spiedFGBAddClipToGraph).toHaveBeenCalledWith(
        clip,
        mockTimeline.processedSources, // Pass processedSources here as per VideoRenderer logic
        sourceRegistry,
        effectRegistry,
        transitionRegistry
      );
    }

    expect(spiedFGBBuildCommandArgs).toHaveBeenCalledWith(
      `${mockOptions.outputDir}/${mockOptions.outputFile}`
    );
    expect(spiedFGBBuildCommandArgs).toHaveBeenCalledTimes(1);

    expect(mockExecuteFFmpegCommand).toHaveBeenCalledWith(
      ['ffmpeg_args_mock'], // This comes from the spy's mockReturnValue
      {
        ffmpegPath: mockOptions.ffmpegPath || 'ffmpeg',
        enableVerboseLogging: mockOptions.enableVerboseLogging,
      }
    );
    expect(mockExecuteFFmpegCommand).toHaveBeenCalledTimes(1);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(`${mockOptions.outputDir}/${mockOptions.outputFile}`);
  });

  test('should return error result if convertToCanonicalTimeline fails', async () => {
    const errorMessage = 'CanonicalTimeline conversion failed';
    mockConvertToCanonicalTimeline.mockRejectedValue(new Error(errorMessage));

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    // expect(mockFilterGraphBuilderConstructor).not.toHaveBeenCalled(); // Constructor is no longer mocked
  });

  test('should return error result if builder.addClipToGraph fails', async () => {
    const errorMessage = 'addClipToGraph failed';
    spiedFGBAddClipToGraph.mockImplementation(() => { // Use the spy
      throw new Error(errorMessage);
    });

    const result = await renderer.render(mockDoc);

    expect(result.success).toBe(false);
    expect(result.error).toContain(errorMessage);
    expect(spiedFGBBuildCommandArgs).not.toHaveBeenCalled(); // Use the spy
  });

  test('should return error result if builder.buildCommandArgs fails', async () => {
    const errorMessage = 'buildCommandArgs failed';
    spiedFGBBuildCommandArgs.mockImplementation(() => { // Use the spy
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