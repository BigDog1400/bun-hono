import { EffectRenderer } from '../../types';
import { FilterGraphBuilder } from '../../core/FilterGraphBuilder';
import { CTClip, CTEffect } from '../../core/CanonicalTimeline';
import { effectRegistry } from '../../core/PluginRegistry';

interface FadeEffectParams {
  type: 'in' | 'out';
  duration: number; // in seconds
  color?: string; // Optional: for video fade to/from color
}

class FadeEffectRenderer implements EffectRenderer {
  kind: string = 'fade';

  apply(
    builder: FilterGraphBuilder,
    clip: CTClip,
    effect: CTEffect, // params should be FadeEffectParams
    inputStreams: { video?: string; audio?: string }
  ): { video?: string; audio?: string } {
    const params = effect.params as FadeEffectParams;
    if (!params || typeof params.type !== 'string' || typeof params.duration !== 'number') {
      console.warn(`FadeEffectRenderer: Invalid parameters for fade effect on clip ${clip.id}. Effect:`, JSON.stringify(effect));
      return inputStreams; // Return original streams if params are invalid
    }

    if (params.duration <= 0) {
      console.warn(`FadeEffectRenderer: Fade duration must be positive. Clip ${clip.id}, duration ${params.duration}. Skipping fade.`);
      return inputStreams;
    }

    const outputStreams: { video?: string; audio?: string } = { ...inputStreams };

    // --- Video Fade ---
    if (inputStreams.video) {
      const videoInputStream = inputStreams.video;
      const videoOutputStream = builder.getUniqueStreamLabel(`v_${clip.id}_fade_${params.type}`);

      let fadeFilter = `${videoInputStream}`;
      const fadeStartTime = params.type === 'in' ? 0 : Math.max(0, clip.duration - params.duration);

      fadeFilter += `fade=t=${params.type}:st=${fadeStartTime}:d=${params.duration}`;
      if (params.type === 'in' && params.color) {
        fadeFilter += `:color=${params.color}`;
      } else if (params.type === 'out' && params.color) {
        // FFmpeg fade out with color needs `alpha=1` usually if the source doesn't have alpha
        // and the color itself is not transparent.
        // For simplicity, we assume if color is provided, it's handled correctly by FFmpeg.
        // fadeFilter += `:alpha=1`; // May be needed if source has no alpha
        fadeFilter += `:color=${params.color}`;
      }
      // Ensure stream has alpha if fading to/from a color that might be transparent, or if base stream needs it
      // This might need format=rgba before the fade filter if the input stream isn't already rgba.
      // For now, assume input stream is compatible or fade filter handles it.

      fadeFilter += `[${videoOutputStream}]`;
      builder.addFilter(fadeFilter);
      outputStreams.video = videoOutputStream;
    }

    // --- Audio Fade ---
    if (inputStreams.audio) {
      const audioInputStream = inputStreams.audio;
      const audioOutputStream = builder.getUniqueStreamLabel(`a_${clip.id}_fade_${params.type}`);

      const fadeStartTime = params.type === 'in' ? 0 : Math.max(0, clip.duration - params.duration);

      const afadeFilter = `${audioInputStream}afade=t=${params.type}:st=${fadeStartTime}:d=${params.duration}[${audioOutputStream}]`;
      builder.addFilter(afadeFilter);
      outputStreams.audio = audioOutputStream;
    }

    return outputStreams;
  }
}

// Self-registration
effectRegistry.register(new FadeEffectRenderer());
