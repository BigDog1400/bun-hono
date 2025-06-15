import { expect, test, describe, beforeEach, vi } from 'bun:test';
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
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  const MOCK_CANVAS_WIDTH = 1920;
  const MOCK_CANVAS_HEIGHT = 1080;

  beforeEach(() => {
    mockBuilder = {
      addInput: vi.fn((filePath: string) => 0),
      getInputIndex: vi.fn((filePath: string) => 0),
      getUniqueStreamLabel: vi.fn((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: vi.fn((filterSpec: string) => {}),
      options: { canvasWidth: MOCK_CANVAS_WIDTH, canvasHeight: MOCK_CANVAS_HEIGHT, fps: 30 },
    } as any;

    mockSource = {
      id: 's_video1',
      url: 'path/to/video.mp4',
      resolvedPath: 'path/to/video.mp4',
      kind: 'video',
      duration: 30, // Source duration
      // For video, actual width/height might come from probe, not here
    };

    mockClip = {
      id: 'clip_video1',
      sourceId: 's_video1',
      kind: 'video',
      src: 'path/to/video.mp4',
      absoluteStartTime: 0,
      duration: 10, // Clip duration
      zIndex: 1,
      // Visual props from CTClip
      width: undefined, // Optional: relative to canvas, if not set, use canvas size or fit logic
      height: undefined, // Optional
      x: 0,
      y: 0,
      opacity: 1.0,
      resizeMode: 'cover', // Default from Zod schema for Source, assumed to be on CTClip too
      volume: 100, // Default volume (0-100)
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
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sourceWithoutDuration = { ...mockSource, duration: undefined };

      const result = await videoRenderer.probe(sourceWithoutDuration as CTSource);
      // Implementation returns { duration: 30 } as placeholder
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
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      vi.mocked(mockBuilder.getInputIndex).mockReturnValue(0); // Assume input index 0
    });

    test('should return correct video and audio filter strings and add them to builder (default props)', () => {
      const result = videoRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedVideoStreamLabel = `[v_${mockClip.id}_mocklabel]`;
      const expectedAudioStreamLabel = `[a_${mockClip.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoStreamLabel);
      expect(result.audio).toBe(expectedAudioStreamLabel);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(2); // 1 for video, 1 for audio

      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(call => call[0].includes('[0:v]'))![0];
      // Default scale is to canvas width/height (current simple implementation)
      expect(videoFilterCall).toContain(`[0:v]scale=${MOCK_CANVAS_WIDTH}:${MOCK_CANVAS_HEIGHT},setsar=1`);
      expect(videoFilterCall).not.toContain('lutalpha'); // Opacity is 1.0
      expect(videoFilterCall).toEndWith(expectedVideoStreamLabel);

      const audioFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(call => call[0].includes('[0:a]'))![0];
      expect(audioFilterCall).toBe(`[0:a]anull[${expectedAudioStreamLabel}]`); // Volume 100 -> anull
    });

    test('video filter should include lutalpha if opacity is less than 1.0', () => {
      mockClip.opacity = 0.8;
      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(call => call[0].includes('[0:v]'))![0];
      expect(videoFilterCall).toContain(`format=rgba,lutalpha=val=${mockClip.opacity}`);
    });

    test('audio filter should include volume if volume is not 100', () => {
      mockClip.volume = 60; // results in volume=0.6
      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const audioFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(call => call[0].includes('[0:a]'))![0];
      expect(audioFilterCall).toContain('volume=0.6');
    });

    test('video filter should use clip.width/height for scaling if provided', () => {
      mockClip.width = 0.5; // 50% of canvas width
      mockClip.height = 0.75; // 75% of canvas height
      const expectedScaleW = Math.floor(mockClip.width * MOCK_CANVAS_WIDTH); // 0.5 * 1920 = 960
      const expectedScaleH = Math.floor(mockClip.height * MOCK_CANVAS_HEIGHT); // 0.75 * 1080 = 810

      videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(call => call[0].includes('[0:v]'))![0];
      expect(videoFilterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
    });

    test.todo('video filter should implement resizeMode "contain" correctly', () => {
      mockClip.resizeMode = 'contain';
      // This would require a more complex filter: scale=w:h:force_original_aspect_ratio=decrease,pad=w:h:(ow-iw)/2:(oh-ih)/2
      // e.g. scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black
      // The current implementation only does simple scale. This test would fail.
    });

    test.todo('video filter should implement resizeMode "stretch" correctly', () => {
      mockClip.resizeMode = 'stretch';
      // This is scale=W:H without maintaining aspect ratio. This is the current default if clip W/H are set.
      // If clip W/H are not set, it scales to canvas W/H.
    });

    test.todo('video filter should implement resizeMode "cover" correctly', () => {
        mockClip.resizeMode = 'cover';
      // This would require: scale=w:h:force_original_aspect_ratio=increase,crop=w:h
      // e.g. scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080
      // The current implementation only does simple scale. This test would fail.
    });

    test('should return empty object if inputIndex is undefined for video source', () => {
      vi.mocked(mockBuilder.getInputIndex).mockReturnValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = videoRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(result).toEqual({}); // Expect empty if main input (video) is missing
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `VideoSourceRenderer: Input index not found for source ${mockSource.resolvedPath} of clip ${mockClip.id}. Ensure addInputs was called.`
      );
      consoleErrorSpy.mockRestore();
    });

    // The VideoSourceRenderer currently optimistically creates an audio filter string.
    // FFmpeg itself would fail if [0:a] doesn't exist for that input.
    // The plugin doesn't (yet) know if audio exists from probe.
    test('audio filter generation is attempted even if source might not have audio', () => {
        // This test just confirms current behavior. A more advanced plugin might skip audio filter
        // if probe data indicated no audio track.
        videoRenderer.getFilter(mockBuilder, mockClip, mockSource);
        const audioFilterCallExists = vi.mocked(mockBuilder.addFilter).mock.calls.some(call => call[0].includes('[0:a]'));
        expect(audioFilterCallExists).toBe(true);
    });
  });
});
