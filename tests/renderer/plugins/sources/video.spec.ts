import { expect, test, describe, beforeEach, spyOn, mock, type Mock } from 'bun:test';
// Ensure plugin is registered by importing its module
import '../../../../src/renderer/plugins/sources/video';
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../../../src/renderer/core/CanonicalTimeline';

// Get the instance from the registry
const VideoSourceRendererInstance = sourceRegistry.get('video');

if (!VideoSourceRendererInstance) {
  throw new Error("VideoSourceRenderer not found in sourceRegistry. Ensure it's imported and self-registered with kind 'video'.");
}
const videoRenderer = VideoSourceRendererInstance;

describe('VideoSourceRenderer', () => {
  // Declare the mockBuilder with the real, full type
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  // Define reusable types for our mocks to keep casting clean
  type AddFilterMock = Mock<(filterSpec: string) => void>;
  type GetInputIndexMock = Mock<(filePath: string) => number | undefined>;

  const MOCK_CANVAS_WIDTH = 1920;
  const MOCK_CANVAS_HEIGHT = 1080;

  beforeEach(() => {
    // Create a partial mock object with bun's native `mock()` and cast it once
    mockBuilder = {
      addInput: mock((filePath: string) => 0),
      getInputIndex: mock((filePath: string) => 0),
      getUniqueStreamLabel: mock((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: mock((filterSpec: string) => {}),
      options: { canvasWidth: MOCK_CANVAS_WIDTH, canvasHeight: MOCK_CANVAS_HEIGHT, fps: 30 },
    } as unknown as FilterGraphBuilder;

    mockSource = {
      id: 's_video1',
      url: 'path/to/video.mp4',
      resolvedPath: 'path/to/video.mp4',
      kind: 'video',
      duration: 30,
    };

    mockClip = {
      id: 'clip_video1',
      sourceId: 's_video1',
      kind: 'video',
      src: 'path/to/video.mp4',
      absoluteStartTime: 0,
      duration: 10,
      zIndex: 1,
      width: undefined,
      height: undefined,
      x: 0,
      y: 0,
      opacity: 1.0,
      resizeMode: 'cover',
      volume: 100,
    };
  });

  test('should be registered in sourceRegistry with kind "video"', () => {
    expect(VideoSourceRendererInstance).toBeDefined();
    expect(VideoSourceRendererInstance?.kind).toBe('video');
  });

  describe('probe()', () => {
    test('should return { duration: source.duration } if source.duration is provided', async () => {
      mockSource.duration = 45;
      const result = await videoRenderer.probe(mockSource);
      expect(result).toEqual({ duration: 45 });
    });

    test('should return placeholder duration and log warning if source.duration is missing', async () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const sourceWithoutDuration = { ...mockSource, duration: undefined };

      const result = await videoRenderer.probe(sourceWithoutDuration as CTSource);
      expect(result).toEqual({ duration: 30 });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `VideoSourceRenderer: Probe for ${sourceWithoutDuration.id} - duration not available in source, returning placeholder 30s.`
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('addInputs()', () => {
    test('should call builder.addInput with source.resolvedPath if it exists', () => {
      videoRenderer.addInputs(mockBuilder, mockClip, mockSource);
      expect(mockBuilder.addInput).toHaveBeenCalledTimes(1);
      expect(mockBuilder.addInput).toHaveBeenCalledWith(mockSource.resolvedPath);
    });

    test('should not call builder.addInput and log warning if source.resolvedPath is missing', () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const sourceWithoutPath = { ...mockSource, resolvedPath: undefined };

      videoRenderer.addInputs(mockBuilder, mockClip, sourceWithoutPath as CTSource);

      expect(mockBuilder.addInput).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `VideoSourceRenderer: Source ${sourceWithoutPath.id} for clip ${mockClip.id} has no resolvedPath. Cannot add input.`
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('getFilter()', () => {
    beforeEach(() => {
      // Set the mock's return value by casting the specific method to its Mock type
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(0);
    });

    test('should return correct video and audio filter strings and add them to builder (default props)', () => {
      const result = videoRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedVideoStreamLabel = `[v_${mockClip.id}_mocklabel]`;
      const expectedAudioStreamLabel = `[a_${mockClip.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoStreamLabel);
      expect(result.audio).toBe(expectedAudioStreamLabel);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(2);

      const addFilterMock = mockBuilder.addFilter as AddFilterMock;
      const videoFilterCall = addFilterMock.mock.calls.find(call => call[0].includes('[0:v]'))![0];
      expect(videoFilterCall).toContain(`[0:v]scale=${MOCK_CANVAS_WIDTH}:${MOCK_CANVAS_HEIGHT},setsar=1`);
      expect(videoFilterCall).not.toContain('lutalpha');
      expect(videoFilterCall).toEndWith(expectedVideoStreamLabel);

      const audioFilterCall = addFilterMock.mock.calls.find(call => call[0].includes('[0:a]'))![0];
      expect(audioFilterCall).toBe(`[0:a]anull${expectedAudioStreamLabel}`);
    });

    test('video filter should include lutalpha if opacity is less than 1.0', () => {
      mockClip.opacity = 0.8;
      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const videoFilterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls.find(call => call[0].includes('[0:v]'))![0];
      expect(videoFilterCall).toContain(`format=rgba,lutalpha=val=${mockClip.opacity}`);
    });

    test('audio filter should include volume if volume is not 100', () => {
      mockClip.volume = 60;
      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const audioFilterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls.find(call => call[0].includes('[0:a]'))![0];
      expect(audioFilterCall).toContain('volume=0.6');
    });

    test('video filter should use clip.width/height for scaling if provided', () => {
      mockClip.width = 0.5;
      mockClip.height = 0.75;
      const expectedScaleW = Math.floor(mockClip.width * MOCK_CANVAS_WIDTH);
      const expectedScaleH = Math.floor(mockClip.height * MOCK_CANVAS_HEIGHT);

      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const videoFilterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls.find(call => call[0].includes('[0:v]'))![0];
      expect(videoFilterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
    });

    test.todo('video filter should implement resizeMode "contain" correctly');
    test.todo('video filter should implement resizeMode "stretch" correctly');
    test.todo('video filter should implement resizeMode "cover" correctly');

    test('should return empty object if inputIndex is undefined for video source', () => {
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(undefined);
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = videoRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `VideoSourceRenderer: Input index not found for source ${mockSource.resolvedPath} of clip ${mockClip.id}. Ensure addInputs was called.`
      );
      consoleErrorSpy.mockRestore();
    });

    test('audio filter generation is attempted even if source might not have audio', () => {
      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const audioFilterCallExists = (mockBuilder.addFilter as AddFilterMock).mock.calls.some(call => call[0].includes('[0:a]'));
      expect(audioFilterCallExists).toBe(true);
    });
  });
});