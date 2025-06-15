// src/renderer/plugins/sources/video.ts
import type { SourceRenderer, CTClip, Source } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { sourceRegistry } from "../../core/PluginRegistry";

class VideoSourceRenderer implements SourceRenderer {
  public readonly kind = "video";

  public async probe(source: Source): Promise<{ duration: number; hasAudio: boolean; hasVideo: boolean }> {
    // Actual duration, and whether it has audio/video, would be determined by ffprobe.
    // For this skeleton, we'll assume some defaults.
    // This information is crucial for the convertToCanonicalTimeline logic.
    // const { duration, hasAudio, hasVideo } = await someFFprobeFunction(source.src);

    // Placeholder values:
    const PREDETERMINED_VIDEO_DURATION = 10.0; // seconds
    const PREDETERMINED_HAS_AUDIO = true; // Assume videos might have audio
    const PREDETERMINED_HAS_VIDEO = true;

    return {
      duration: PREDETERMINED_VIDEO_DURATION,
      hasAudio: PREDETERMINED_HAS_AUDIO,
      hasVideo: PREDETERMINED_HAS_VIDEO
    };
  }

  public addInputs(builder: FilterGraphBuilder, clip: CTClip, source: Source): void {
    builder.addInput(source.src);
  }

  public getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: Source
  ): { video?: string; audio?: string } {
    const inputIndex = builder.getInputCount() - 1;

    // These should ideally come from the result of probe() stored on the CTClip or accessible otherwise.
    // For now, using placeholder true based on typical video files.
    const videoStreamExists = true;
    const audioStreamExists = true;

    let videoOutput: string | undefined = undefined;
    let audioOutput: string | undefined = undefined;

    // --- Video Stream Processing (similar to ImageSourceRenderer) ---
    if (videoStreamExists) {
      // Initial stream selection
      let videoChain = `[${inputIndex}:v]`;
      const canvas = builder.getCanvasDimensions();
      const clipProps = clip.props || {};

      const targetWidth = clipProps.w ?? source.w ?? canvas.w; // Added source.w as fallback
      const targetHeight = clipProps.h ?? source.h ?? canvas.h; // Added source.h as fallback

      const scaledStreamSuffix = builder.getUniqueStreamLabel("v"); // Suffix for the stream label
      let scaleFilter = `scale=${targetWidth}:${targetHeight}`;

      if (source.resize === 'fit') {
        scaleFilter += `:force_original_aspect_ratio=decrease`;
      } else if (source.resize === 'fill') {
        scaleFilter += `:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;
      }
      // 'stretch' is default for scale if dimensions are explicit.

      videoChain += `${scaleFilter}${scaledStreamSuffix}`;
      let currentVideoOutput = scaledStreamSuffix; // This is the label like [v_1], not the full filter part

      if (source.opacity !== undefined && source.opacity < 1) {
        const opacityStreamSuffix = builder.getUniqueStreamLabel("v");
        // For videos, ensuring pixel format supports alpha (e.g. yuva420p) then applying opacity.
        // lutalpha is generally preferred for videos if the format has alpha.
        // Need to chain the filters correctly: input -> scale -> format -> lutalpha -> output
        videoChain += `;${currentVideoOutput}format=yuva420p,lutalpha=val=${source.opacity}${opacityStreamSuffix}`;
        currentVideoOutput = opacityStreamSuffix;
      }

      builder.addFilter(videoChain);
      videoOutput = currentVideoOutput;
    }

    // --- Audio Stream Processing (similar to AudioSourceRenderer) ---
    if (audioStreamExists) {
      // Simply select the audio stream from the input.
      // Audio effects (volume, fades) will be handled by EffectRenderers.
      // We assume the input video file might have an audio stream at index 'a'.
      // If ffprobe indicated no audio, this would be skipped.
      audioOutput = `[${inputIndex}:a]`;
      // No builder.addFilter() here for audio unless intrinsic source processing is needed.
    }

    return { video: videoOutput, audio: audioOutput };
  }
}

// Self-register the plugin
sourceRegistry.register("video", new VideoSourceRenderer());
