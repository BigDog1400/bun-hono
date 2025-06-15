// tests/renderer/plugins/sources/image.spec.ts
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import type { SourceRenderer, CTClip, Source } from '../../../../src/renderer/types';
import type { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { LayoutV1 } from '../../../../src/renderer/schema/layout-v1'; // For canvas dimensions if needed

// Manually import the specific class to ensure it's registered
import '../../../../src/renderer/plugins/sources/image'; // This ensures ImageSourceRenderer is registered

// Mock FilterGraphBuilder
const mockAddInput = jest.fn();
const mockAddFilter = jest.fn();
const mockGetUniqueStreamLabel = jest.fn().mockImplementation((prefix: string) => `[${prefix}_mock_1]`);
const mockGetCanvasDimensions = jest.fn().mockReturnValue({ w: 1920, h: 1080, fps: 30 });

jest.mock('../../../../src/renderer/core/FilterGraphBuilder', () => ({
  FilterGraphBuilder: jest.fn().mockImplementation(() => ({
    addInput: mockAddInput,
    addFilter: mockAddFilter,
    getUniqueStreamLabel: mockGetUniqueStreamLabel,
    getCanvasDimensions: mockGetCanvasDimensions,
    getInputCount: jest.fn().mockReturnValue(1), // Assume one input has been added before getFilter
  })),
}));


describe('ImageSourceRenderer', () => {
  let imageRenderer: SourceRenderer;
  let mockBuilderInstance: FilterGraphBuilder;

  beforeEach(() => {
    // Reset mocks before each test
    mockAddInput.mockClear();
    mockAddFilter.mockClear();
    mockGetUniqueStreamLabel.mockClear();
    // mockGetCanvasDimensions.mockClear(); // This is part of the constructor mock, cleared via FilterGraphBuilder mock

    // Get the registered image renderer instance
    imageRenderer = sourceRegistry.get('image');
    // Create a new mock instance for each test, which uses the mocked constructor above
    mockBuilderInstance = new (jest.requireMock('../../../../src/renderer/core/FilterGraphBuilder'))({} as any, {} as any, {} as LayoutV1);
  });

  describe('probe', () => {
    it('should return infinite duration and indicate video content', async () => {
      const source: Source = { kind: 'image', src: 'test.png' };
      const probeResult = await imageRenderer.probe(source);
      expect(probeResult.duration).toBe(Infinity);
      expect(probeResult.hasAudio).toBe(false);
      expect(probeResult.hasVideo).toBe(true);
    });
  });

  describe('addInputs', () => {
    it('should call builder.addInput with the source src', () => {
      const clip: CTClip = { id: 'c1', kind: 'image', src: 'test.jpg', track: 1, start: 0, end: 5, duration: 5, layerId: 'b1' };
      const source: Source = { kind: 'image', src: 'test.jpg' };
      imageRenderer.addInputs(mockBuilderInstance, clip, source);
      expect(mockAddInput).toHaveBeenCalledWith('test.jpg', clip.id); // Assuming addInput now takes clipId
    });
  });

  describe('getFilter', () => {
    const baseClip: CTClip = { id: 'c1', kind: 'image', src: 'test.png', track: 1, start: 0, end: 5, duration: 5, layerId: 'b1' };
    const baseSource: Source = { kind: 'image', src: 'test.png' };

    it('should generate a simple scale filter by default (stretch to clip.props dimensions)', () => {
      (mockBuilderInstance.getInputCount as jest.Mock).mockReturnValueOnce(1); // Input index will be 0
      (mockBuilderInstance.getCanvasDimensions as jest.Mock).mockReturnValueOnce({ w: 1280, h: 720, fps: 25 });
      // Ensure getUniqueStreamLabel returns a predictable value for this test
      (mockBuilderInstance.getUniqueStreamLabel as jest.Mock).mockImplementationOnce((prefix: string) => `[${prefix}_stretch_1]`);


      const result = imageRenderer.getFilter(mockBuilderInstance,
        { ...baseClip, props: { w: 1280, h: 720 } },
        baseSource
      );

      expect(mockAddFilter).toHaveBeenCalledWith(expect.stringContaining('[0:v]scale=1280:720[v_stretch_1]'));
      expect(result.video).toBe('[v_stretch_1]');
    });

    it('should apply opacity if specified', () => {
      (mockBuilderInstance.getInputCount as jest.Mock).mockReturnValueOnce(1);
      (mockBuilderInstance.getCanvasDimensions as jest.Mock).mockReturnValueOnce({ w: 1920, h: 1080, fps: 30 });
      (mockBuilderInstance.getUniqueStreamLabel as jest.Mock)
        .mockReturnValueOnce('[v_scaled_opacity_1]') // For scale output
        .mockReturnValueOnce('[v_opacity_final_1]'); // For opacity output

      const sourceWithOpacity: Source = { ...baseSource, opacity: 0.5, w:1920, h:1080 };
      const result = imageRenderer.getFilter(mockBuilderInstance,
        { ...baseClip, props: { ...sourceWithOpacity } },
        sourceWithOpacity
      );

      expect(mockAddFilter).toHaveBeenCalledWith(expect.stringContaining(`[0:v]scale=1920:1080[v_scaled_opacity_1];[v_scaled_opacity_1]format=rgba,colorchannelmixer=aa=0.5[v_opacity_final_1]`));
      expect(result.video).toBe('[v_opacity_final_1]');
    });

    it('should handle "fit" resize mode', () => {
        (mockBuilderInstance.getInputCount as jest.Mock).mockReturnValueOnce(1);
        (mockBuilderInstance.getCanvasDimensions as jest.Mock).mockReturnValueOnce({ w: 800, h: 600, fps: 30 });
        (mockBuilderInstance.getUniqueStreamLabel as jest.Mock).mockImplementationOnce((prefix: string) => `[${prefix}_fit_1]`);

        const sourceFit: Source = { ...baseSource, resize: 'fit', w:800, h:600 };
        imageRenderer.getFilter(mockBuilderInstance,
            { ...baseClip, props: { ...sourceFit } },
            sourceFit
        );
        expect(mockAddFilter).toHaveBeenCalledWith(expect.stringContaining(`[0:v]scale=800:600:force_original_aspect_ratio=decrease[v_fit_1]`));
    });

    it('should handle "fill" resize mode', () => {
        (mockBuilderInstance.getInputCount as jest.Mock).mockReturnValueOnce(1);
        (mockBuilderInstance.getCanvasDimensions as jest.Mock).mockReturnValueOnce({ w: 1024, h: 768, fps: 30 });
        (mockBuilderInstance.getUniqueStreamLabel as jest.Mock).mockImplementationOnce((prefix: string) => `[${prefix}_fill_1]`);

        const sourceFill: Source = { ...baseSource, resize: 'fill', w:1024, h:768 };
        imageRenderer.getFilter(mockBuilderInstance,
            { ...baseClip, props: { ...sourceFill } },
            sourceFill
        );
        expect(mockAddFilter).toHaveBeenCalledWith(expect.stringContaining(`[0:v]scale=1024:768:force_original_aspect_ratio=increase,crop=1024:768[v_fill_1]`));
    });

     it('should use clip.props for dimensions over source and canvas', () => {
      (mockBuilderInstance.getInputCount as jest.Mock).mockReturnValueOnce(1);
      (mockBuilderInstance.getCanvasDimensions as jest.Mock).mockReturnValueOnce({ w: 1920, h: 1080, fps: 30 }); // Canvas
      (mockBuilderInstance.getUniqueStreamLabel as jest.Mock).mockImplementationOnce((prefix: string) => `[${prefix}_clip_prop_dim_1]`);

      const sourceWithDims: Source = { ...baseSource, w: 800, h: 600 }; // Source explicit dims
      const clipWithOverrideDims: CTClip = { ...baseClip, props: { w: 640, h: 480 } }; // Clip props override

      imageRenderer.getFilter(mockBuilderInstance, clipWithOverrideDims, sourceWithDims);

      expect(mockAddFilter).toHaveBeenCalledWith(expect.stringContaining('[0:v]scale=640:480[v_clip_prop_dim_1]'));
    });
  });
});
