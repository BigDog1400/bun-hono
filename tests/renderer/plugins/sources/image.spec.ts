import { expect, test, describe, beforeEach, mock, spyOn, type Mock } from 'bun:test';
// Ensure plugin is registered by importing its module
import '../../../../src/renderer/plugins/sources/image';
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../../../src/renderer/core/CanonicalTimeline';

const ImageSourceRendererInstance = sourceRegistry.get('image');

if (!ImageSourceRendererInstance) {
  throw new Error("ImageSourceRenderer not found in sourceRegistry. Ensure it's imported and self-registered.");
}
const imageRenderer = ImageSourceRendererInstance;

describe('ImageSourceRenderer', () => {
  // Declare mockBuilder with the real, full type
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  // Define reusable types for our mocks to keep the code clean
  type AddFilterMock = Mock<(filterSpec: string) => void>;
  type GetInputIndexMock = Mock<(filePath: string) => number | undefined>;

  const MOCK_CANVAS_WIDTH = 1280;
  const MOCK_CANVAS_HEIGHT = 720;
  const MOCK_FPS = 30;

  beforeEach(() => {
    // Create a partial mock object with bun's `mock()` and cast it once to the full type.
    mockBuilder = {
      addInput: mock((filePath: string) => 0),
      getInputIndex: mock((filePath: string) => 0),
      getUniqueStreamLabel: mock((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: mock((filterSpec: string) => {}),
      options: { canvasWidth: MOCK_CANVAS_WIDTH, canvasHeight: MOCK_CANVAS_HEIGHT, fps: MOCK_FPS },
    } as unknown as FilterGraphBuilder;

    mockSource = {
      id: 's_img1',
      url: 'path/to/image.png',
      resolvedPath: 'path/to/image.png',
      kind: 'image',
    };

    mockClip = {
      id: 'clip_img1',
      sourceId: 's_img1',
      kind: 'image',
      src: 'path/to/image.png',
      absoluteStartTime: 0,
      duration: 5,
      zIndex: 1,
      width: 0.5,
      height: 0.5,
      x: 0.1,
      y: 0.1,
      opacity: 1.0,
      resizeMode: 'cover',
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
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      imageRenderer.addInputs(mockBuilder, mockClip, sourceWithoutPath as CTSource);
      expect(mockBuilder.addInput).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('getFilter()', () => {
    beforeEach(() => {
      // Set the mock's return value by casting the specific method to its Mock type
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(0);
    });

    test('should return correct video filter string and add it to builder', () => {
      mockClip.duration = 10;
      mockClip.opacity = 1.0;
      const expectedScaleW = Math.floor(mockClip.width! * MOCK_CANVAS_WIDTH);
      const expectedScaleH = Math.floor(mockClip.height! * MOCK_CANVAS_HEIGHT);

      const result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedVideoStreamLabel = `[v_${mockClip.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoStreamLabel);
      expect(result.audio).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];

      expect(filterCall).toContain(`[0:v]loop=loop=-1:size=1,trim=duration=${mockClip.duration},setpts=PTS-STARTPTS`);
      expect(filterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
      expect(filterCall).not.toContain('lutalpha');
      expect(filterCall).toEndWith(expectedVideoStreamLabel);
    });

    test('should include lutalpha if opacity is less than 1.0', () => {
      mockClip.duration = 5;
      mockClip.opacity = 0.75;
      const expectedScaleW = Math.floor(mockClip.width! * MOCK_CANVAS_WIDTH);
      const expectedScaleH = Math.floor(mockClip.height! * MOCK_CANVAS_HEIGHT);

      imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];

      expect(filterCall).toContain(`scale=${expectedScaleW}:${expectedScaleH},setsar=1`);
      expect(filterCall).toContain(`format=rgba,lutalpha=val=${mockClip.opacity}`);
    });

    test('should use full canvas width/height for scaling if clip.width/height are not set', () => {
      mockClip.width = undefined;
      mockClip.height = undefined;
      mockClip.duration = 3;

      imageRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];
      expect(filterCall).toContain(`scale=${MOCK_CANVAS_WIDTH}:${MOCK_CANVAS_HEIGHT},setsar=1`);
    });

    test('should return empty object if clip duration is invalid', () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      
      mockClip.duration = 0;
      let result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});
      
      mockClip.duration = -1;
      result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});

      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    test('should return empty object if inputIndex is undefined', () => {
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(undefined);
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = imageRenderer.getFilter(mockBuilder, mockClip, mockSource);
      
      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});