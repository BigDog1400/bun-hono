import { expect, test, describe, beforeEach, vi } from 'bun:test';
import { effectRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTEffect } from '../../../../src/renderer/core/CanonicalTimeline';

const FadeEffectRendererInstance = effectRegistry.get('fade');

if (!FadeEffectRendererInstance) {
  throw new Error("FadeEffectRenderer not found in effectRegistry. Ensure it's imported and self-registered.");
}
const fadeRenderer = FadeEffectRendererInstance;

describe('FadeEffectRenderer', () => {
  let mockBuilder: FilterGraphBuilder;
  let mockClip: CTClip;
  let mockEffect: CTEffect;
  let inputStreams: { video?: string; audio?: string };

  beforeEach(() => {
    mockBuilder = {
      getUniqueStreamLabel: vi.fn((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: vi.fn((filterSpec: string) => {}),
      // No options needed for this plugin directly
    } as any;

    mockClip = {
      id: 'c1',
      sourceId: 's1',
      kind: 'video', // or any, doesn't strictly matter for fade logic itself
      src: 'source.mp4',
      absoluteStartTime: 0,
      duration: 10, // seconds
      zIndex: 1,
      // Other props not directly used by fade effect logic (like opacity, volume)
    };

    mockEffect = {
      id: 'effect_fade1',
      kind: 'fade',
      params: {
        type: 'in', // Default type for most tests
        duration: 2,  // Default duration
      },
    };

    inputStreams = {
      video: '[vid_in]',
      audio: '[aud_in]',
    };
  });

  test('should be registered in effectRegistry with kind "fade"', () => {
    expect(FadeEffectRendererInstance).toBeDefined();
    expect(FadeEffectRendererInstance?.kind).toBe('fade');
  });

  describe('apply() method', () => {
    test('should apply video fade-in correctly', () => {
      mockEffect.params = { type: 'in', duration: 1.5 };
      inputStreams.audio = undefined; // Video only

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      const expectedVideoOut = `[v_${mockClip.id}_fade_in_mocklabel]`;
      expect(result.video).toBe(expectedVideoOut);
      expect(result.audio).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toBe(`${inputStreams.video}fade=t=in:st=0:d=1.5[${expectedVideoOut}]`);
    });

    test('should apply video fade-out correctly with color', () => {
      mockEffect.params = { type: 'out', duration: 2, color: 'black' };
      inputStreams.audio = undefined;

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      const expectedVideoOut = `[v_${mockClip.id}_fade_out_mocklabel]`;
      expect(result.video).toBe(expectedVideoOut);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      const expectedStartTime = mockClip.duration - mockEffect.params.duration; // 10 - 2 = 8
      expect(filterCall).toBe(`${inputStreams.video}fade=t=out:st=${expectedStartTime}:d=2:color=black[${expectedVideoOut}]`);
    });

    test('should apply audio fade-in correctly', () => {
      mockEffect.params = { type: 'in', duration: 1 };
      inputStreams.video = undefined; // Audio only

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      const expectedAudioOut = `[a_${mockClip.id}_fade_in_mocklabel]`;
      expect(result.audio).toBe(expectedAudioOut);
      expect(result.video).toBeUndefined();

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      expect(filterCall).toBe(`${inputStreams.audio}afade=t=in:st=0:d=1[${expectedAudioOut}]`);
    });

    test('should apply audio fade-out correctly', () => {
      mockEffect.params = { type: 'out', duration: 3 };
      inputStreams.video = undefined;

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      const expectedAudioOut = `[a_${mockClip.id}_fade_out_mocklabel]`;
      expect(result.audio).toBe(expectedAudioOut);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1);
      const filterCall = vi.mocked(mockBuilder.addFilter).mock.calls[0][0];
      const expectedStartTime = mockClip.duration - mockEffect.params.duration; // 10 - 3 = 7
      expect(filterCall).toBe(`${inputStreams.audio}afade=t=out:st=${expectedStartTime}:d=3[${expectedAudioOut}]`);
    });

    test('should apply fade to both video and audio streams', () => {
      mockEffect.params = { type: 'in', duration: 2.5, color: 'white' };

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      const expectedVideoOut = `[v_${mockClip.id}_fade_in_mocklabel]`;
      const expectedAudioOut = `[a_${mockClip.id}_fade_in_mocklabel]`;
      expect(result.video).toBe(expectedVideoOut);
      expect(result.audio).toBe(expectedAudioOut);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(2);
      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('fade=t=in'))![0];
      const audioFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('afade=t=in'))![0];

      expect(videoFilterCall).toBe(`${inputStreams.video}fade=t=in:st=0:d=2.5:color=white[${expectedVideoOut}]`);
      expect(audioFilterCall).toBe(`${inputStreams.audio}afade=t=in:st=0:d=2.5[${expectedAudioOut}]`);
    });

    test('should handle fade duration longer than clip duration (st becomes negative, clamped to 0 for fade-out by Math.max)', () => {
      mockClip.duration = 1; // Clip is 1s
      mockEffect.params = { type: 'out', duration: 2 }; // Fade out for 2s

      fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);

      // Video
      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('fade=t=out'))![0];
      // Expected st = Math.max(0, 1 - 2) = 0
      expect(videoFilterCall).toContain(`fade=t=out:st=0:d=2`);

      // Audio
      const audioFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('afade=t=out'))![0];
      expect(audioFilterCall).toContain(`afade=t=out:st=0:d=2`);
    });

    test('should handle fade duration of 0 by returning original streams and logging warning', () => {
      mockEffect.params.duration = 0;
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);
      expect(result).toEqual(inputStreams); // Original streams returned
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `FadeEffectRenderer: Fade duration must be positive. Clip ${mockClip.id}, duration 0. Skipping fade.`
      );
      consoleWarnSpy.mockRestore();
    });


    test('should return original streams if effect params are invalid (missing type)', () => {
      mockEffect.params = { duration: 1 }; // Missing 'type'
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);
      expect(result).toEqual(inputStreams); // Original streams
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    test('should return original streams if effect params are invalid (missing duration)', () => {
      mockEffect.params = { type: 'in' }; // Missing 'duration'
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);
      expect(result).toEqual(inputStreams); // Original streams
      expect(mockBuilder.addFilter).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });


    test('should return undefined for video/audio if corresponding input stream is missing', () => {
      inputStreams = { video: '[v_only]' }; // Only video input
      mockEffect.params = { type: 'in', duration: 1 };
      let result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);
      expect(result.video).toBeDefined();
      expect(result.audio).toBeUndefined();

      vi.mocked(mockBuilder.addFilter).mockClear();
      inputStreams = { audio: '[a_only]' }; // Only audio input
      result = fadeRenderer.apply(mockBuilder, mockClip, mockEffect, inputStreams);
      expect(result.video).toBeUndefined();
      expect(result.audio).toBeDefined();
    });
  });
});
