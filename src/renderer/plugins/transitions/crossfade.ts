// src/renderer/plugins/transitions/crossfade.ts
import type { TransitionRenderer, CTClip, Transition } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { transitionRegistry } from "../../core/PluginRegistry";

class CrossfadeTransitionRenderer implements TransitionRenderer {
  public readonly kind = "crossfade";

  public apply(
    builder: FilterGraphBuilder,
    fromClip: CTClip, // The clip transitioning from
    toClip: CTClip,   // The clip transitioning to
    transition: Transition, // The transition configuration from LayoutV1
    fromStreamVideo: string, // Video stream label of the 'from' clip (post-effects)
    fromStreamAudio: string | undefined, // Audio stream label of the 'from' clip (post-effects)
    toStreamVideo: string,   // Video stream label of the 'to' clip (post-effects)
    toStreamAudio: string | undefined     // Audio stream label of the 'to' clip (post-effects)
  ): { video?: string; audio?: string } {
    const transitionDuration = transition.duration; // Duration of the crossfade itself

    // The xfade filter expects the 'from' stream to be trimmed to end at the transition point,
    // and the 'to' stream to start effectively at the transition point for the xfade duration.
    // This means the source clips given to xfade should be thought of as:
    // fromClipVideo: ends at fromClip.end
    // toClipVideo: starts at toClip.start
    // The transition effectively happens from (fromClip.end - transitionDuration) to fromClip.end
    // OR from toClip.start to (toClip.start + transitionDuration)
    // The xfade filter itself handles the overlap.
    // The `offset` parameter in xfade determines when the second video appears relative to the start of the first video.
    // If fromStreamVideo is the full 'from' clip, and toStreamVideo is the full 'to' clip,
    // xfade needs to know the point where 'toStreamVideo' should conceptually start fading in
    // over 'fromStreamVideo'. This is typically `fromClip.duration - transitionDuration`.

    const outputStreams: { video?: string; audio?: string } = {};

    // --- Video Crossfade using 'xfade' ---
    // The 'xfade' filter is quite powerful. It needs the two input streams
    // and parameters for the transition type and duration.
    // Example: [from_v][to_v]xfade=transition=fade:duration=1:offset=T[out_v]
    // 'offset' is the time in the first stream when the second stream should start.
    // For a crossfade at the boundary, offset = fromClip.duration - transition.duration.
    // This assumes fromStreamVideo and toStreamVideo are the *full* clip streams.
    // The xfade filter will internally manage the overlap.

    const videoOffset = fromClip.duration - transitionDuration;
    if (videoOffset < 0) {
      console.warn(`Crossfade on ${fromClip.id} to ${toClip.id}: transition duration (${transitionDuration}s) is longer than fromClip duration (${fromClip.duration}s). Video transition may not appear as expected. Setting offset to 0.`);
      // Potentially skip video transition or adjust offset to 0
      // For now, we'll let xfade handle it, it might truncate.
    }

    const xfadedVideoStreamSuffix = builder.getUniqueStreamLabel("v");
    // Using a common 'fade' transition effect for xfade. Others include 'wipeleft', etc.
    // FFmpeg needs the streams to have the same resolution and framerate for xfade.
    // This should be ensured by the source plugins scaling to canvas dimensions.
    const xfadeFilter = `xfade=transition=fade:duration=${transitionDuration}:offset=${Math.max(0, videoOffset)}`;

    builder.addFilter(`${fromStreamVideo}${toStreamVideo}${xfadeFilter}${xfadedVideoStreamSuffix}`);
    outputStreams.video = xfadedVideoStreamSuffix;


    // --- Audio Crossfade using 'acrossfade' ---
    // Similar to xfade, 'acrossfade' handles audio.
    // Example: [from_a][to_a]acrossfade=duration=1:overlap=1[out_a]
    // 'overlap=1' means the duration is the overlap time.
    if (fromStreamAudio && toStreamAudio) {
      const afadedAudioStreamSuffix = builder.getUniqueStreamLabel("a");
      // For acrossfade, duration is the length of the fade.
      // No direct 'offset' like xfade; it assumes inputs are aligned such that the
      // end of the first stream overlaps with the start of the second for the given duration.
      // This means the FilterGraphBuilder/VideoRenderer needs to ensure that `fromStreamAudio`
      // is trimmed or available up to `fromClip.end` and `toStreamAudio` starts effectively at `toClip.start`.
      // The `acrossfade` filter will then mix them over the specified `transition.duration`.
      // Unlike xfade, acrossfade doesn't have an 'offset' to shift the second stream.
      // The streams must be fed to it already aligned for the transition period.
      // This is a key difference and often a point of confusion.
      // One way to handle this is to use `atrim` and `adelay` on the audio inputs *before* `acrossfade`
      // OR ensure the main timeline logic provides these streams correctly timed for the transition.
      // For now, we assume the main renderer will handle the timing of what `fromStreamAudio` and `toStreamAudio` represent.
      // A simpler model for acrossfade is to just specify the duration of the fade.
      // It will take `duration` seconds from the end of the first stream and `duration` seconds from the start of the second.
      const acrossfadeFilter = `acrossfade=d=${transitionDuration}`; // 'd' is for duration

      builder.addFilter(`${fromStreamAudio}${toStreamAudio}${acrossfadeFilter}${afadedAudioStreamSuffix}`);
      outputStreams.audio = afadedAudioStreamSuffix;
    } else {
      // If one stream has audio and the other doesn't, no crossfade.
      // The main rendering logic would typically just continue the existing audio or start the new one.
      // This plugin's responsibility is the transition *between two existing* streams.
      if (fromStreamAudio && !toStreamAudio) {
        // If only the 'from' clip has audio, that audio will simply end.
        // The VideoRenderer's job is to ensure this stream is used up to the transition point,
        // and then no audio (or new audio from toClip if it had it) is used thereafter.
        // This transition plugin itself doesn't need to output the fromStreamAudio again,
        // as the main graph building logic should handle using non-transitioned parts.
        // However, for simplicity, if we are expected to return the "resulting" audio stream
        // of the transition period, and there's no actual transition, what should it be?
        // This area needs careful handling in the main VideoRenderer logic.
        // For now, let's assume the main logic will handle cases where audio doesn't transition.
        // outputStreams.audio = fromStreamAudio; // This might be incorrect if not handled well by caller
      } else if (toStreamAudio && !fromStreamAudio) {
        // outputStreams.audio = toStreamAudio; // Similar to above
      }
      // If neither has audio, or only one does, outputStreams.audio remains undefined from this plugin.
      // The VideoRenderer will need to decide how to construct the final audio track from
      // segments before, during (if transitioned), and after the transition.
    }

    return outputStreams;
  }
}

// Self-register the plugin
transitionRegistry.register("crossfade", new CrossfadeTransitionRenderer());
