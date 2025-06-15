import { expect, test, describe, beforeEach, mock, vi } from 'bun:test';
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder, RendererOptions } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../../../src/renderer/core/CanonicalTimeline';
// Import the class directly to test its methods, registry check is separate
// Assuming image.ts exports the class:
// import ImageSourceRenderer from '../../../../src/renderer/plugins/sources/image';
// However, plugins self-register, so we get the instance from the registry.

const ImageSourceRendererInstance = sourceRegistry.get('image');

if (!ImageSourceRendererInstance) {
  // This would mean the plugin didn't self-register or kind is wrong.
  // Throw error to halt tests if plugin isn't found, as it's crucial for the suite.
  throw new Error("ImageSourceRenderer not found in sourceRegistry. Ensure it's imported and self-registered.");
}
const imageRenderer = ImageSourceRendererInstance; // Type assertion might be needed if registry.get returns base type

describe('ImageSourceRenderer', () => {

  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  const MOCK_CANVAS_WIDTH = 1280;
  const MOCK_CANVAS_HEIGHT = 720;
  const MOCK_FPS = 30;

  beforeEach(() => {
    // Mock FilterGraphBuilder
    // We need to mock all methods that the plugin calls
    mockBuilder = {
      addInput: vi.fn((filePath: string) => 0), // Assume input index 0 for simplicity
      getInputIndex: vi.fn((filePath: string) => 0),
      getUniqueStreamLabel: vi.fn((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: vi.fn((filterSpec: string) => {}),
      // Provide options as the plugin uses builder.options for canvas dimensions
      options: { canvasWidth: MOCK_CANVAS_WIDTH, canvasHeight: MOCK_CANVAS_HEIGHT, fps: MOCK_FPS },
    } as any; // Cast to any to allow mocking only subset of methods / properties

    mockSource = {
      id: 's_img1',
      url: 'path/to/image.png',
      resolvedPath: 'path/to/image.png',
      kind: 'image',
      // other source props if needed by plugin
    };

    mockClip = {
      id: 'clip_img1',
      sourceId: 's_img1',
      kind: 'image', // Should match renderer kind
      src: 'path/to/image.png', // From source.resolvedPath
      absoluteStartTime: 0,
      duration: 5, // Default test duration
      zIndex: 1,
      // Visual props (assuming flat structure on clip for testing, or adjust as per CTClip definition)
      width: 0.5, // relative to canvas
      height: 0.5, // relative to canvas
      x: 0.1,
      y: 0.1,
      opacity: 1.0, // Default, test with < 1.0 as well
      resizeMode: 'cover',
      // inputIndex: 0, // This would be set by VideoRenderer after calling addInputs
    };
  });

  test('should be registered in sourceRegistry', () => {
    expect(ImageSourceRendererInstance).toBeDefined();
    expect(ImageSourceRendererInstance?.kind).toBe('image');
  });

  describe('probe()', () => {
    test('should return { duration: Infinity }', async () => {
      const result = await imageRenderer.probe(mockSource);
      expect(result).toEqual({ duration: Infinity });
    });
  });

  describe('addInputs()', () => {
    test('should call builder.addInput with source.resolvedPath', () => {
      imageRenderer.addInputs(mockBuilder, mockClip, mockSource);
      expect(mockBuilder.addInput).toHaveBeenCalledTimes(1);
      expect(mockBuilder.addInput).toHaveBeenCalledWith(mockSource.resolvedPath);
    });

    test('should not call builder.addInput if source.resolvedPath is missing', () => {
      const sourceWithoutPath = { ...mockSource, resolvedPath: undefined };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress warning
      imageRenderer.addInputs(mockBuilder, mockClip, sourceWithoutPath as CTSource);
      expect(mockBuilder.addInput).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('getFilter()', () => {
    beforeEach(() => {
      // Simulate that addInputs has been called and inputIndex is available via builder
      vi.mocked(mockBuilder.getInputIndex).mockReturnValue(0);
    });

    test('should return correct video filter string and add it to builder', () => {
      mockClip.duration = 10;
      mockClip.opacity = 1.0;
      // Expected scale dimensions based on clip.width/height and mock canvas dimensions
      const expectedScaleW = Math.floor(mockClip.width! * MOCK_CANVAS_WIDTH); // 0.5 * 1280 = 640
      const expectedScaleH = Math.floor(mockClip.height! * MOCK_CANVAS_HEIGHT); // 0.5 * 720 = 360

      const result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedVideoStreamLabel = `[v_${mockClip.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoStreamLabel);
      expect(result.audio).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];

      expect(filterCall).toContain(`[0:v]loop=loop=-1:size=1,trim=duration=${mockClip.duration},setpts=PTS-STARTPTS`);
      expect(filterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
      expect(filterCall).not.toContain('lutalpha'); // Opacity is 1.0
      expect(filterCall).toEndWith(expectedVideoStreamLabel);
    });

    test('should include lutalpha if opacity is less than 1.0', () => {
      mockClip.duration = 5;
      mockClip.opacity = 0.75;
      const expectedScaleW = Math.floor(mockClip.width! * MOCK_CANVAS_WIDTH);
      const expectedScaleH = Math.floor(mockClip.height! * MOCK_CANVAS_HEIGHT);

      imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];

      expect(filterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
      expect(filterCall).toContain(`format=rgba,lutalpha=val=${mockClip.opacity}`);
    });

    test('should use full canvas width/height for scaling if clip.width/height are not set', () => {
      mockClip.width = undefined;
      mockClip.height = undefined;
      mockClip.duration = 3;

      imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toContain(`scale=${MOCK_CANVAS_WIDTH}:${MOCK_CANVAS_HEIGHT},setsar=1`);
    });

    test('should return empty object if clip duration is invalid', () => {
      mockClip.duration = 0;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();

      mockClip.duration = -1;
      const resultNegative = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(resultNegative).toEqual({});
    });

    test('should return empty object if inputIndex is undefined', () => {
      vi.mocked(mockBuilder.getInputIndex).mockReturnValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
