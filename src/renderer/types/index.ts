// src/renderer/types/index.ts
import type { FilterGraphBuilder } from "../core/FilterGraphBuilder";
// Forward declarations for types that will be fully defined in CanonicalTimeline.ts
// This avoids circular dependencies but provides enough shape for the interfaces.

export interface CTLayer {
  id: string;
  // other properties as they become clear from CanonicalTimeline.ts
}

export interface CTClip {
  id: string;
  kind: string; // e.g., "video", "image", "audio", "colour"
  src: string; // URL for media, hex/keyword for colour
  track: number; // z-index for compositing
  start: number; // absolute start time in seconds
  end: number; // absolute end time in seconds
  duration: number; // duration in seconds
  layerId: string; // ID of the CTLayer this clip belongs to

  // Source-specific properties (will be a discriminated union based on 'kind')
  // Example for an image source:
  props?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    resize?: "fit" | "fill" | "stretch";
    opacity?: number;
    // other source-specific props
  };
  // Effects and transitions might also be part of CTClip or handled separately
  effects?: Effect[];
  transitionFrom?: Transition; // Transition applied at the start of this clip
  transitionTo?: Transition; // Transition applied at the end of this clip
}

export interface Source {
  kind: "video" | "image" | "audio" | "colour";
  src: string;
  x?: number;
  y?: number;
  resize?: "fit" | "fill" | "stretch";
  opacity?: number;
}

export interface Effect {
  kind: string; // e.g., "fade"
  // Effect-specific properties
  // Example for a fade effect:
  duration?: number;
  type?: "in" | "out"; // For fade in or fade out
}

export interface Transition {
  kind: "crossfade"; // Example, will expand with more transition types
  duration: number;
}

export interface SourceRenderer {
  kind: string; // Matches Source.kind
  probe(source: Source): Promise<{ duration: number; hasAudio?: boolean; hasVideo?: boolean }>;
  addInputs(builder: FilterGraphBuilder, clip: CTClip, source: Source): void;
  getFilter(builder: FilterGraphBuilder, clip: CTClip, source: Source): {
    video?: string; // Output stream label e.g., "[v_clip1]"
    audio?: string; // Output stream label e.g., "[a_clip1]"
  };
}

export interface EffectRenderer {
  kind: string; // Matches Effect.kind
  apply(
    builder: FilterGraphBuilder,
    clip: CTClip,
    effect: Effect,
    inputStreams: { video?: string; audio?: string }
  ): {
    video?: string; // New output video stream label
    audio?: string; // New output audio stream label
  };
}

export interface TransitionRenderer {
  kind: string; // Matches Transition.kind
  apply(
    builder: FilterGraphBuilder,
    fromClip: CTClip, // The clip transitioning from
    toClip: CTClip,   // The clip transitioning to
    transition: Transition,
    fromStreamVideo: string, // Video stream label of the 'from' clip
    fromStreamAudio?: string, // Audio stream label of the 'from' clip (if any)
    toStreamVideo: string,   // Video stream label of the 'to' clip
    toStreamAudio?: string    // Audio stream label of the 'to' clip (if any)
  ): {
    video?: string; // Output video stream label for the transitioned segment
    audio?: string; // Output audio stream label for the transitioned segment
  };
}

// Options for the VideoRenderer constructor (FR-103)
export interface RendererOptions {
  outputDir: string;
  ffmpegPath?: string; // Optional path to ffmpeg executable
  ffprobePath?: string; // Optional path to ffprobe executable
  // Concurrency limits, other FFmpeg settings can go here
  canvas: {
    w: number;
    h: number;
    fps: number;
  };
}

// Result of the render operation (FR-101)
export interface RenderResult {
  success: boolean;
  outputPath?: string;
  error?: string; // Error message, FFmpeg stderr
}
