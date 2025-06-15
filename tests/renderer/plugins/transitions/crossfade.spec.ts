import { expect, test, describe, beforeEach, vi } from 'bun:test';
import { transitionRegistry } from '../../../../src/renderer/core/PluginRegistry';
import { FilterGraphBuilder } from '../../../../src/renderer/core/FilterGraphBuilder';
import { CTClip, CTTransition } from '../../../../src/renderer/core/CanonicalTimeline';

const CrossFadeTransitionRendererInstance = transitionRegistry.get('crossfade');

if (!CrossFadeTransitionRendererInstance) {
  throw new Error("CrossFadeTransitionRenderer not found in transitionRegistry. Ensure it's imported and self-registered.");
}
const crossfadeRenderer = CrossFadeTransitionRendererInstance;

describe('CrossFadeTransitionRenderer', () => {
  let mockBuilder: FilterGraphBuilder;
  let mockFromClip: CTClip;
  let mockToClip: CTClip;
  let mockTransition: CTTransition;
  let inputStreams: {
    fromVideo?: string;
    fromAudio?: string;
    toVideo?: string;
    toAudio?: string;
  };

  beforeEach(() => {
    mockBuilder = {
      getUniqueStreamLabel: vi.fn((prefix: string) => `[${prefix}_mocklabel]`),
      addFilter: vi.fn((filterSpec: string) => {}),
    } as any;

    mockFromClip = {
      id: 'c_from',
      sourceId: 's_from',
      kind: 'video',
      src: 'from.mp4',
      absoluteStartTime: 0,
      duration: 5, // seconds
      zIndex: 1,
    };

    mockToClip = {
      id: 'c_to',
      sourceId: 's_to',
      kind: 'video',
      src: 'to.mp4',
      absoluteStartTime: 5, // Assuming it starts after fromClip for context
      duration: 5,
      zIndex: 2,
    };

    mockTransition = {
      id: 't1',
      kind: 'crossfade', // from ZodTransition.type
      duration: 1,     // from ZodTransition.duration
      // params: { duration: 1 }, // if CTTransition had params.duration
    };

    inputStreams = {
      fromVideo: '[v_from]',
      fromAudio: '[a_from]',
      toVideo: '[v_to]',
      toAudio: '[a_to]',
    };
  });

  test('should be registered in transitionRegistry with kind "crossfade"', () => {
    expect(CrossFadeTransitionRendererInstance).toBeDefined();
    expect(CrossFadeTransitionRendererInstance?.kind).toBe('crossfade');
  });

  describe('apply() method', () => {
    test('should apply video and audio cross-fade correctly', () => {
      const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

      const expectedVideoOut = `[v_trans_${mockTransition.id}_mocklabel]`;
      const expectedAudioOut = `[a_trans_${mockTransition.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoOut);
      expect(result.audio).toBe(expectedAudioOut);

      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(2);

      const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('xfade'))![0];
      const audioFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('acrossfade'))![0];

      const expectedOffset = mockFromClip.duration - mockTransition.duration; // 5 - 1 = 4
      expect(videoFilterCall).toBe(`[${inputStreams.fromVideo}][${inputStreams.toVideo}]xfade=transition=fade:duration=${mockTransition.duration}:offset=${expectedOffset}[${expectedVideoOut}]`);
      expect(audioFilterCall).toBe(`[${inputStreams.fromAudio}][${inputStreams.toAudio}]acrossfade=d=${mockTransition.duration}:curve1=tri:curve2=tri[${expectedAudioOut}]`);
    });

    test('should apply video-only cross-fade if audio streams are missing', () => {
      inputStreams.fromAudio = undefined;
      inputStreams.toAudio = undefined;

      const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);
      const expectedVideoOut = `[v_trans_${mockTransition.id}_mocklabel]`;
      expect(result.video).toBe(expectedVideoOut);
      expect(result.audio).toBeUndefined();
      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1); // Only xfade
      expect(vi.mocked(mockBuilder.addFilter).mock.calls[0][0]).toContain('xfade');
    });

    test('should apply audio-only cross-fade if video streams are missing', () => {
      inputStreams.fromVideo = undefined;
      inputStreams.toVideo = undefined;

      const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);
      const expectedAudioOut = `[a_trans_${mockTransition.id}_mocklabel]`;
      expect(result.audio).toBe(expectedAudioOut);
      expect(result.video).toBeUndefined();
      expect(mockBuilder.addFilter).toHaveBeenCalledTimes(1); // Only acrossfade
      expect(vi.mocked(mockBuilder.addFilter).mock.calls[0][0]).toContain('acrossfade');
    });

    describe('Edge Cases and Fallbacks', () => {
      test('should return toClip streams if transition duration is 0, and log warning', () => {
        mockTransition.duration = 0;
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.video).toBe(inputStreams.toVideo);
        expect(result.audio).toBe(inputStreams.toAudio);
        expect(mockBuilder.addFilter).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          `CrossFadeTransitionRenderer: Invalid or zero duration for transition ${mockTransition.id}. Returning 'toClip' streams if available, else 'fromClip'.`
        );
        consoleWarnSpy.mockRestore();
      });

      test('should return undefined streams if transition duration is 0 and toClip streams are also undefined', () => {
        mockTransition.duration = 0;
        inputStreams.toVideo = undefined;
        inputStreams.toAudio = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.video).toBeUndefined();
        expect(result.audio).toBeUndefined();
        consoleWarnSpy.mockRestore();
      });


      test('should log warning if fromClip duration is less than transition duration for xfade', () => {
        mockFromClip.duration = 0.5; // Less than transition.duration = 1
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          `CrossFadeTransitionRenderer: fromClip ${mockFromClip.id} duration (${mockFromClip.duration}s) is less than transition duration (${mockTransition.duration}s). Xfade might behave unexpectedly or error. Adjusting offset to 0.`
        );
        // The filter will be called with offset potentially adjusted or as originally calculated (implementation detail)
        // The current implementation recalculates offset inside.
        // If fromClip.duration (0.5) < transition.duration (1), offset becomes -0.5.
        // The plugin code had a specific warning for this, but the xfade filter itself might error with negative offset.
        // The code itself did not adjust offset to 0 in the warning path, it just warned.
        // Let's verify the calculated offset.
        const videoFilterCall = vi.mocked(mockBuilder.addFilter).mock.calls.find(c => c[0].includes('xfade'))![0];
        const expectedOffset = mockFromClip.duration - mockTransition.duration; // 0.5 - 1 = -0.5
        expect(videoFilterCall).toContain(`offset=${expectedOffset}`);
        consoleWarnSpy.mockRestore();
      });

      test('should pass through toVideo if fromVideo is missing, and log', () => {
        inputStreams.fromVideo = undefined;
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.video).toBe(inputStreams.toVideo);
        expect(mockBuilder.addFilter).not.toHaveBeenCalledWith(expect.stringContaining('xfade'));
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `CrossFadeTransitionRenderer: fromVideo stream missing for transition ${mockTransition.id}. Passing toVideo stream through.`
        );
        consoleLogSpy.mockRestore();
      });

      test('should pass through fromVideo if toVideo is missing, and log', () => {
        inputStreams.toVideo = undefined;
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.video).toBe(inputStreams.fromVideo);
        expect(mockBuilder.addFilter).not.toHaveBeenCalledWith(expect.stringContaining('xfade'));
         expect(consoleLogSpy).toHaveBeenCalledWith(
            `CrossFadeTransitionRenderer: toVideo stream missing for transition ${mockTransition.id}. Passing fromVideo stream through.`
        );
        consoleLogSpy.mockRestore();
      });

      test('should return undefined video if both fromVideo and toVideo are missing', () => {
        inputStreams.fromVideo = undefined;
        inputStreams.toVideo = undefined;
        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);
        expect(result.video).toBeUndefined();
         // Audio part should still proceed if audio streams are present
        expect(mockBuilder.addFilter).toHaveBeenCalledWith(expect.stringContaining('acrossfade'));
      });

      // Similar tests for audio fallbacks
       test('should pass through toAudio if fromAudio is missing, and log', () => {
        inputStreams.fromAudio = undefined;
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.audio).toBe(inputStreams.toAudio);
        // xfade should still be called if video streams are present
        expect(mockBuilder.addFilter).toHaveBeenCalledWith(expect.stringContaining('xfade'));
        expect(mockBuilder.addFilter).not.toHaveBeenCalledWith(expect.stringContaining('acrossfade'));
        expect(consoleLogSpy).toHaveBeenCalledWith(
            `CrossFadeTransitionRenderer: fromAudio stream missing for transition ${mockTransition.id}. Passing toAudio stream through.`
        );
        consoleLogSpy.mockRestore();
      });

      test('should pass through fromAudio if toAudio is missing, and log', () => {
        inputStreams.toAudio = undefined;
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = crossfadeRenderer.apply(mockBuilder, mockFromClip, mockToClip, mockTransition, inputStreams);

        expect(result.audio).toBe(inputStreams.fromAudio);
        expect(mockBuilder.addFilter).not.toHaveBeenCalledWith(expect.stringContaining('acrossfade'));
         expect(consoleLogSpy).toHaveBeenCalledWith(
            `CrossFadeTransitionRenderer: toAudio stream missing for transition ${mockTransition.id}. Passing fromAudio stream through.`
        );
        consoleLogSpy.mockRestore();
      });
    });
  });
});
