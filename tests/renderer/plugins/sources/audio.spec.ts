import { expect, test, describe, beforeEach, mock, spyOn, type Mock } from 'bun:test';
// Ensure plugin is registered by importing its module
import '../../../../src/renderer/plugins/sources/audio';
import { sourceRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../../../src/renderer/core/CanonicalTimeline';

// Get the instance from the registry
const AudioSourceRendererInstance = sourceRegistry.get('audio');

if (!AudioSourceRendererInstance) {
  throw new Error("AudioSourceRenderer not found in sourceRegistry. Ensure it's imported and self-registered with kind 'audio'.");
}
const audioRenderer = AudioSourceRendererInstance;

describe('AudioSourceRenderer', () => {
  // Declare the mockBuilder with the real, full type
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockSource: CTSource;

  // Define reusable types for our mocks to keep casting clean
  type AddFilterMock = Mock<(filterSpec: string) => void>;
  type GetInputIndexMock = Mock<(filePath: string) => number | undefined>;

  beforeEach(() => {
    // Create a partial mock object with bun's native `mock()` and cast it once
    mockBuilder = {
      addInput: mock((filePath: string) => 0),
      getInputIndex: mock((filePath: string) => 0),
      getUniqueStreamLabel: mock((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: mock((filterSpec: string) => {}),
      options: {},
    } as unknown as FilterGraphBuilder;

    mockSource = {
      id: 's_audio1',
      url: 'path/to/audio.mp3',
      resolvedPath: 'path/to/audio.mp3',
      kind: 'audio',
      duration: 60,
    };

    mockClip = {
      id: 'clip_audio1',
      sourceId: 's_audio1',
      kind: 'audio',
      src: 'path/to/audio.mp3',
      absoluteStartTime: 0,
      duration: 30,
      zIndex: 1,
      volume: 100,
    };
  });

  test('should be registered in sourceRegistry with kind "audio"', () => {
    expect(AudioSourceRendererInstance).toBeDefined();
    expect(AudioSourceRendererInstance?.kind).toBe('audio');
  });

  describe('probe()', () => {
    test('should return { duration: source.duration } if source.duration is provided', async () => {
      mockSource.duration = 123;
      const result = await audioRenderer.probe(mockSource);
      expect(result).toEqual({ duration: 123 });
    });

    test('should return placeholder duration and log warning if source.duration is missing', async () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const sourceWithoutDuration = { ...mockSource, duration: undefined };

      const result = await audioRenderer.probe(sourceWithoutDuration as CTSource);

      expect(result).toEqual({ duration: 60 });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `AudioSourceRenderer: Probe for ${sourceWithoutDuration.id} - duration not available in source, returning placeholder 60s.`
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('addInputs()', () => {
    test('should call builder.addInput with source.resolvedPath if it exists', () => {
      audioRenderer.addInputs(mockBuilder, mockClip, mockSource);
      expect(mockBuilder.addInput).toHaveBeenCalledTimes(1);
      expect(mockBuilder.addInput).toHaveBeenCalledWith(mockSource.resolvedPath);
    });

    test('should not call builder.addInput and log warning if source.resolvedPath is missing', () => {
      const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const sourceWithoutPath = { ...mockSource, resolvedPath: undefined };

      audioRenderer.addInputs(mockBuilder, mockClip, sourceWithoutPath as CTSource);

      expect(mockBuilder.addInput).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `AudioSourceRenderer: Source ${sourceWithoutPath.id} for clip ${mockClip.id} has no resolvedPath. Cannot add input.`
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('getFilter()', () => {
    beforeEach(() => {
      // Set the mock's return value by casting the specific method to its Mock type
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(0);
    });

    test('should return correct audio filter string with volume and add it to builder', () => {
      mockClip.volume = 50; // Corresponds to volume=0.5
      const result = audioRenderer.getFilter(mockBuilder, mockClip, mockSource);

      const expectedAudioStreamLabel = `[a_${mockClip.id}_mocklabel]`;
      expect(result.audio).toBe(expectedAudioStreamLabel);
      expect(result.video).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];

      expect(filterCall).toBe(`[0:a]volume=0.5[${expectedAudioStreamLabel}]`);
    });

    test('should use "anull" if volume is 100 (or undefined)', () => {
      mockClip.volume = 100;
      let result = audioRenderer.getFilter(mockBuilder, mockClip, mockSource);
      let expectedAudioStreamLabel = `[a_${mockClip.id}_mocklabel]`;
      expect(result.audio).toBe(expectedAudioStreamLabel);
      let filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];
      expect(filterCall).toBe(`[0:a]anull[${expectedAudioStreamLabel}]`);

      (mockBuilder.addFilter as AddFilterMock).mockClear();

      const clipWithMissingVolume = { ...mockClip, volume: undefined } as any;
      result = audioRenderer.getFilter(mockBuilder, clipWithMissingVolume, mockSource);
      expectedAudioStreamLabel = `[a_${clipWithMissingVolume.id}_mocklabel]`;
      filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];
      expect(filterCall).toBe(`[0:a]anull[${expectedAudioStreamLabel}]`);
    });

    test('should handle volume 0 correctly', () => {
      mockClip.volume = 0;
      audioRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];
      expect(filterCall).toContain('volume=0');
    });

    test('should handle volume values between 0 and 100', () => {
      mockClip.volume = 75;
      audioRenderer.getFilter(mockBuilder, mockClip, mockSource);
      const filterCall = (mockBuilder.addFilter as AddFilterMock).mock.calls[0][0];
      expect(filterCall).toContain('volume=0.75');
    });

    test('should return empty object if inputIndex is undefined', () => {
      (mockBuilder.getInputIndex as GetInputIndexMock).mockReturnValue(undefined);
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const result = audioRenderer.getFilter(mockBuilder, mockClip, mockSource);

      expect(result).toEqual({});
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `AudioSourceRenderer: Input index not found for source ${mockSource.resolvedPath} of clip ${mockClip.id}.`
      );
      consoleErrorSpy.mockRestore();
    });
  });
});