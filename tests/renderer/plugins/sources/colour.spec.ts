import { expect, test, describe, beforeEach, vi } from 'bun:test';
// Ensure plugin is registered by importing its module
import '../../../../src/renderer/plugins/sources/colour';
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../../../src/renderer/core/CanonicalTimeline';

// Get the instance from the registry
const ColourSourceRendererInstance = sourceRegistry.get('colour');

if (!ColourSourceRendererInstance) {
  throw new Error("ColourSourceRenderer not found in sourceRegistry. Ensure it's imported and self-registered with kind 'colour'.");
}
const colourRenderer = ColourSourceRendererInstance;

describe('ColourSourceRenderer', () => {
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  const MOCK_CANVAS_WIDTH = 1280;
  const MOCK_CANVAS_HEIGHT = 720;

  beforeEach(() => {
    mockBuilder = {
      addInput: vi.fn(), // Should not be called by colour renderer
      getInputIndex: vi.fn(), // Not relevant for colour
      getUniqueStreamLabel: vi.fn((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: vi.fn((filterSpec: string) => {}),
      options: { canvasWidth: MOCK_CANVAS_WIDTH, canvasHeight: MOCK_CANVAS_HEIGHT, fps: 30 },
    } as any;

    mockSource = {
      id: 's_color1',
      // For ColourSourceRenderer, 'url' or 'resolvedPath' is used for the color string
      url: 'red',
      resolvedPath: 'red', // Let's assume resolvedPath is preferred or url is fallback
      kind: 'colour',
    };

    mockClip = {
      id: 'clip_color1',
      sourceId: 's_color1',
      kind: 'colour',
      src: 'red', // from source.resolvedPath or source.url
      absoluteStartTime: 0,
      duration: 5,
      zIndex: 1,
      opacity: 1.0, // Default
      // No specific x,y,width,height for color clip itself, uses canvas dimensions
    };
  });

  test('should be registered in sourceRegistry with kind "colour"', () => {
    expect(ColourSourceRendererInstance).toBeDefined();
    expect(ColourSourceRendererInstance?.kind).toBe('colour');
  });

  describe('probe()', () => {
    test('should return { duration: Infinity }', async () => {
      const result = await colourRenderer.probe(mockSource);
      expect(result).toEqual({ duration: Infinity });
    });
  });

  describe('addInputs()', () => {
    test('should not call builder.addInput as colours are generated', () => {
      colourRenderer.addInputs(mockBuilder, mockClip, mockSource);
      expect(mockBuilder.addInput).not.toHaveBeenCalled();
    });
  });

  describe('getFilter()', () => {
    test('should return correct video filter string and add it to builder', () => {
      mockClip.duration = 10;
      mockClip.opacity = 1.0;
      mockSource.resolvedPath = 'blue'; // Change color for this test
      mockClip.src = 'blue';

      const result = colourRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedVideoStreamLabel = `[v_${mockClip.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoStreamLabel);
      expect(result.audio).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];

      const expectedColorFilter = `color=c=${mockClip.src}:s=${MOCK_CANVAS_WIDTH}x${MOCK_CANVAS_HEIGHT}:d=${mockClip.duration},format=rgba`;
      expect(filterCall).toStartWith(expectedColorFilter);
      expect(filterCall).not.toContain('lutalpha'); // Opacity is 1.0
      expect(filterCall).toEndWith(expectedVideoStreamLabel);
    });

    test('should include lutalpha if opacity is less than 1.0', () => {
      mockClip.duration = 5;
      mockClip.opacity = 0.6;
      mockSource.resolvedPath = '#FF0000';
      mockClip.src = '#FF0000';

      colourRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      const expectedColorFilter = `color=c=${mockClip.src}:s=${MOCK_CANVAS_WIDTH}x${MOCK_CANVAS_HEIGHT}:d=${mockClip.duration},format=rgba`;
      expect(filterCall).toStartWith(expectedColorFilter);
      expect(filterCall).toContain(`,lutalpha=val=${mockClip.opacity}`);
    });

    test('should use source.url if source.resolvedPath is undefined', () => {
      mockSource.resolvedPath = undefined;
      mockSource.url = 'green';
      mockClip.src = 'green'; // Assuming VideoRenderer sets clip.src from one of these

      colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toContain(`color=c=green`);
    });

    test('should default to "black" if both source.resolvedPath and source.url are missing', () => {
      mockSource.resolvedPath = undefined;
      mockSource.url = undefined;
      mockClip.src = 'black'; // Default color
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toContain(`color=c=black`);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    test('should return empty object if clip duration is invalid', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockClip.duration = 0;
      let result = colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();

      vi.mocked(mockBuilder.addFilter).mockClear(); // Clear previous calls for next check
      mockClip.duration = -2;
      result = colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      consoleWarnSpy.mockRestore();
    });

    test('should handle different valid durations', () => {
      mockClip.duration = 0.5; // Short duration
      colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      let filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toContain(`d=0.5`);

      vi.mocked(mockBuilder.addFilter).mockClear();
      mockClip.duration = 100; // Long duration
      colourRenderer.getFilter(mockBuilder, mockClip, mockSource);
      filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toContain(`d=100`);
    });
  });
});
