// Even though these files don't exist yet, we are asked to import them.
import { FilterGraphBuilder } from '../core/FilterGraphBuilder';
import { Source as CTSource, Effect as CTEffect, Transition as CTTransition, Clip as CTClip } from '../core/CanonicalTimeline';

// Placeholder for Source type, can be refined later
// For now, let's assume it might be different from the Zod schema's Source
// and closer to what the renderer internally needs.
export type Source = CTSource; // This is actually CTSource

// Placeholder for Effect type
export type Effect = CTEffect;

// Placeholder for Transition type
export type Transition = CTTransition;

// Placeholder for CTClip type, will be fleshed out with CanonicalTimeline
export type { CTClip }; // This is actually CTClip from CanonicalTimeline

/**
 * Interface for a source renderer.
 * Each source type (video, image, audio, etc.) will have a corresponding renderer.
 */
export interface SourceRenderer {
  /**
   * A unique string identifying the kind of source this renderer handles (e.g., 'video', 'image', 'silent').
   */
  kind: string;

  /**
   * Probes the source to determine intrinsic properties like duration.
   * @param source The CTSource object from the canonical timeline.
   * @returns A promise resolving to an object with source properties (e.g., { duration: number }).
   */
  probe(source: CTSource): Promise<{ duration?: number; [key: string]: any }>;

  /**
   * Adds necessary FFmpeg inputs for this clip/source via the FilterGraphBuilder.
   * This method is responsible for calling `builder.addInput()` if the source is file-based
   * and potentially storing the returned input index (e.g., on the clip or a map)
   * if it's needed by `getFilter`.
   * For generated sources (like 'color'), this might be a no-op.
   *
   * @param builder The FilterGraphBuilder instance.
   * @param clip The CTClip object being processed.
   * @param source The CTSource associated with the clip.
   */
  addInputs(builder: FilterGraphBuilder, clip: CTClip, source: CTSource): void;

  /**
   * Generates the FFmpeg filter graph segment for this clip.
   * @param builder The FilterGraphBuilder instance.
   * @param clip The CTClip object for which to generate the filter.
   * @param source The CTSource associated with the clip.
   * @param inputIndex The index of the FFmpeg input file for this source (if applicable).
   *                   This might be managed by the VideoRenderer or the plugin itself via addInputs.
   * @returns An object containing video and/or audio stream labels output by the filter.
   *          Example: { video: "[v_clip1]", audio: "[a_clip1]" }
   */
  getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: CTSource,
    // Optional: canvasWidth, canvasHeight, fps if needed directly and not from builder.options
    // canvasWidth: number,
    // canvasHeight: number,
    // fps: number
  ): { video?: string; audio?: string };
}

/**
 * Interface for an effect renderer.
 * Each effect type (blur, overlay, etc.) will have a corresponding renderer.
 */
export interface EffectRenderer {
  /**
   * A unique string identifying the kind of effect this renderer handles (e.g., 'blur', 'overlayText').
   */
  kind: string;

  /**
   * Applies the effect to the given input video and/or audio streams.
   * @param builder The FilterGraphBuilder instance to add filters to.
   * @param clip The CTClip object to which the effect is being applied (provides context like duration).
   * @param effect The CTEffect object from the canonical timeline (provides effect kind and parameters).
   * @param inputStreams An object containing the labels of the input video and/or audio streams.
   *                     Example: { video: "[v_in]", audio: "[a_in]" }
   * @returns An object containing the labels of the output video and/or audio streams after applying the effect.
   *          Example: { video: "[v_out]", audio: "[a_out]" }
   */
  apply(
    builder: FilterGraphBuilder,
    clip: CTClip,
    effect: CTEffect,
    inputStreams: { video?: string; audio?: string }
  ): { video?: string; audio?: string };
}

/**
 * Interface for a transition renderer.
 * Each transition type (fade, wipe, etc.) will have a corresponding renderer.
 */
export interface TransitionRenderer {
  /**
   * A unique string identifying the kind of transition this renderer handles (e.g., 'fade', 'wipeLeft').
   */
  kind: string;

  /**
   * Applies the transition between two clips in the filter graph.
   * @param builder The FilterGraphBuilder instance to add filters to.
   * @param fromClip The CTClip object from which the transition originates.
   * @param toClip The CTClip object to which the transition leads.
   * @param transition The CTTransition object describing the transition (kind, duration, params).
   * @param inputStreams An object containing the video/audio stream labels from the 'fromClip' and 'toClip'.
   *                     Example: { fromVideo: "[v_from]", fromAudio: "[a_from]", toVideo: "[v_to]", toAudio: "[a_to]" }
   * @returns An object containing the video and/or audio stream labels representing the output of the transition.
   *          Example: { video: "[v_trans_out]", audio: "[a_trans_out]" }
   */
  apply(
    builder: FilterGraphBuilder,
    fromClip: CTClip,
    toClip: CTClip,
    transition: CTTransition,
    inputStreams: {
      fromVideo?: string;
      fromAudio?: string;
      toVideo?: string;
      toAudio?: string;
    }
  ): { video?: string; audio?: string };
}
