// src/renderer/plugins/effects/fade.ts
import type { EffectRenderer, CTClip, Effect } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { effectRegistry } from "../../core/PluginRegistry";

class FadeEffectRenderer implements EffectRenderer {
  public readonly kind = "fade";

  public apply(
    builder: FilterGraphBuilder,
    clip: CTClip, // The clip to which the effect is applied
    effect: Effect, // The specific effect configuration from LayoutV1
    inputStreams: { video?: string; audio?: string }
  ): { video?: string; audio?: string } {
    const outputStreams: { video?: string; audio?: string } = { ...inputStreams };
    const effectDuration = effect.duration ?? 1; // Default to 1 second if not specified
    const clipDuration = clip.duration;

    // Determine start_time for FFmpeg's fade filter.
    // For 'fadein', start_time is 0 (relative to the clip's start).
    // For 'fadeout', start_time is clip.duration - effect.duration.
    let fadeStartTime: number;
    const effectType = effect.type ?? "in"; // Default to 'in' if type is not specified

    if (effectType === "in") {
      fadeStartTime = 0;
    } else if (effectType === "out") {
      fadeStartTime = Math.max(0, clipDuration - effectDuration);
    } else {
      // Should not happen if schema validation is effective for enum.
      console.warn(`Fade effect on clip ${clip.id} has invalid type: ${effect.type}. Defaulting to fade-in.`);
      fadeStartTime = 0;
    }

    // Apply to video stream if it exists
    if (inputStreams.video) {
      const fadedVideoStreamSuffix = builder.getUniqueStreamLabel("v");
      // FFmpeg fade filter expects 'in' or 'out' for the type.
      const fadeFilter = `fade=type=${effectType}:start_time=${fadeStartTime}:duration=${effectDuration}`;

      builder.addFilter(`${inputStreams.video}${fadeFilter}${fadedVideoStreamSuffix}`);
      outputStreams.video = fadedVideoStreamSuffix;
    }

    // Apply to audio stream if it exists
    if (inputStreams.audio) {
      const fadedAudioStreamSuffix = builder.getUniqueStreamLabel("a");
      // FFmpeg uses 'afade' for audio, type 'in' or 'out'.
      const audioFadeFilter = `afade=type=${effectType}:start_time=${fadeStartTime}:duration=${effectDuration}`;

      builder.addFilter(`${inputStreams.audio}${audioFadeFilter}${fadedAudioStreamSuffix}`);
      outputStreams.audio = fadedAudioStreamSuffix;
    }

    return outputStreams;
  }
}

// Self-register the plugin
effectRegistry.register("fade", new FadeEffectRenderer());
