import { expect, test, describe, beforeEach, afterEach, mock, spyOn, type Mock } from 'bun:test';
import { VideoRenderer, RendererOptions } from '../../../src/renderer/core/VideoRenderer';
import { LayoutV1 } from '../../../src/renderer/schema/layout-v1';
import { CanonicalTimeline, CTClip, CTSource, CTEffect } from '../../../src/renderer/core/CanonicalTimeline';
import { sourceRegistry, effectRegistry, transitionRegistry } from '../../../src/renderer/core/PluginRegistry';
import type { FilterGraphBuilder } from '../../../src/renderer/core/FilterGraphBuilder';


// --- Bun Mocks ---

// Mock for convertToCanonicalTimeline
const mockConvertToCanonicalTimeline: Mock<(doc: LayoutV1) => Promise<CanonicalTimeline>> = mock();
mock.module('../../../src/renderer/core/CanonicalTimeline', () => ({
  convertToCanonicalTimeline: mockConvertToCanonicalTimeline,
}));

// Mock for FilterGraphBuilder
const mockFGBAddInput: Mock<(path: string) => void> = mock();
const mockFGBAddClipToGraph: Mock<(clip: CTClip, sources: CTSource[], ...rest: any[]) => void> = mock();
const mockFGBBuildCommandArgs: Mock<(outputPath: string) => string[]> = mock().mockReturnValue(['ffmpeg_args_mock']);
const mockFGBInstance = {
  addInput: mockFGBAddInput,
  addClipToGraph: mockFGBAddClipToGraph,
  buildCommandArgs: mockFGBBuildCommandArgs,
};
const mockFilterGraphBuilderConstructor: Mock<(options: any) => typeof mockFGBInstance> = mock(() => mockFGBInstance);
mock.module('../../../src/renderer/core/FilterGraphBuilder', () => ({
  FilterGraphBuilder: mockFilterGraphBuilderConstructor,
}));

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
    mockFilterGraphBuilderConstructor.mockClear();
    mockFGBAddInput.mockClear();
    mockFGBAddClipToGraph.mockClear();
    mockFGBBuildCommandArgs.mockClear().mockReturnValue(['ffmpeg_args_mock']);
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
      blocks: [{ id: 'b1', visuals: [{id: 'v1', kind: 'video', src: 'src1.mp4', duration: 10}] }],
    };

    const mockProcessedSources: CTSource[] = [
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
      sources: mockProcessedSources,
      clips: [clip1, clip2],
      transitions: [],
    };

    mockConvertToCanonicalTimeline.mockResolvedValue(mockTimeline);
    mockExecuteFFmpegCommand.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    // Cleanup is handled in beforeEach, no action needed here.
  });

  test('successful render path - high-level orchestration', async () => {
    const result = await renderer.render(mockDoc);

    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledWith(mockDoc);
    expect(mockConvertToCanonicalTimeline).toHaveBeenCalledTimes(1);

    expect(mockFilterGraphBuilderConstructor).toHaveBeenCalledTimes(1);
    
    // As per VideoRenderer implementation, `addInputsForTimeline` is called once
    // and is expected to handle all sources.
    // Let's assume an updated `addInputsForTimeline` method on the builder
    // Or verify the individual calls if that's the internal logic.
    // Based on the old test, it iterates and calls addInput.
    expect(mockFGBAddInput).toHaveBeenCalledTimes(mockTimeline.sources.length);
    for (const source of mockTimeline.sources) {
      expect(mockFGBAddInput).toHaveBeenCalledWith(source.resolvedPath);
    }

    expect(mockFGBAddClipToGraph).toHaveBeenCalledTimes(mockTimeline.clips.length);
    for (const clip of mockTimeline.clips) {
      expect(mockFGBAddClipToGraph).toHaveBeenCalledWith(
        clip,
        mockTimeline,
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
      ['ffmpeg_args_mock'],
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