import { TransitionRenderer } from '../../types';
import { FilterGraphBuilder } from '../../core/FilterGraphBuilder';
import { CTClip, CTTransition } from '../../core/CanonicalTimeline';
import { transitionRegistry } from '../../core/PluginRegistry';

class CrossFadeTransitionRenderer implements TransitionRenderer {
  kind: string = 'crossfade';

  apply(
    builder: FilterGraphBuilder,
    fromClip: CTClip,
    toClip: CTClip, // toClip is not directly used for xfade offset/duration, but useful for context
    transition: CTTransition,
    inputStreams: {
      fromVideo?: string;
      fromAudio?: string;
      toVideo?: string;
      toAudio?: string;
    }
  ): { video?: string; audio?: string } {

    const transitionDuration = transition.duration; // Directly from ZodTransition

    if (!transitionDuration || transitionDuration <= 0) {
      console.warn(`CrossFadeTransitionRenderer: Invalid or zero duration for transition ${transition.id}. Returning 'toClip' streams if available, else 'fromClip'.`);
      // Fallback: effectively no transition, output the 'toClip' streams or 'fromClip' if 'toClip' is not available.
      // This part of logic would typically be handled by the VideoRenderer orchestrating the pipeline.
      // Here, we'd ideally output just the `toStreams` or `fromStreams` if no transition is applied.
      // For simplicity, if transition is invalid, we'll just pass through the `toClip`'s streams if they exist.
      return { video: inputStreams.toVideo, audio: inputStreams.toAudio };
    }

    const outputStreams: { video?: string; audio?: string } = {};

    // --- Video Cross-Fade (xfade) ---
    if (inputStreams.fromVideo && inputStreams.toVideo) {
      const fromVideoStream = inputStreams.fromVideo;
      const toVideoStream = inputStreams.toVideo;
      const videoOutputStream = builder.getUniqueStreamLabel(`v_trans_${transition.id}`);

      // xfade offset: when the second video should start fading in, relative to the start of the first video.
      // If fromClip.duration is 5s, and transitionDuration is 1s, offset is 4s.
      // The total duration of the xfade output will be: fromClip.duration + toClip.duration - transitionDuration
      const offset = Math.max(0, fromClip.duration - transitionDuration);

      // Ensure fromClip has enough duration for the transition offset.
      // If fromClip.duration < transitionDuration, the behavior of xfade can be unexpected or error.
      // Often, users expect the transition to "eat into" both clips by transitionDuration/2 each,
      // or for the fromClip to play up to `duration - transitionDuration` then transition starts.
      // The `offset` parameter for `xfade` means "start of the secondary video, measured from the start of the primary video".
      if (fromClip.duration < transitionDuration) {
          console.warn(`CrossFadeTransitionRenderer: fromClip ${fromClip.id} duration (${fromClip.duration}s) is less than transition duration (${transitionDuration}s). Xfade might behave unexpectedly or error. Adjusting offset to 0.`);
          // Adjusting offset to 0 might not be ideal, but xfade requires offset < fromClip.duration.
          // A common strategy is to shorten the transition or the fromClip's effective part in it.
          // For now, we let it proceed, FFmpeg might error or produce short output.
          // A robust solution might involve pre-trimming or complex filter graph adjustments.
      }


      // The xfade filter joins fromVideoStream and toVideoStream.
      // 'transition=fade' is a common type for crossfade.
      const xfadeFilter = `[${fromVideoStream}][${toVideoStream}]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[${videoOutputStream}]`;
      builder.addFilter(xfadeFilter);
      outputStreams.video = videoOutputStream;

    } else if (inputStreams.toVideo) {
      // If fromVideo is missing, but toVideo exists, pass toVideo through (e.g., transition from color to video)
      // This assumes the VideoRenderer handles scenarios like an effect creating a "black" stream for fromVideo.
      // Or, this transition might not be applicable. For now, pass toVideo.
      console.log(`CrossFadeTransitionRenderer: fromVideo stream missing for transition ${transition.id}. Passing toVideo stream through.`);
      outputStreams.video = inputStreams.toVideo;
    } else if (inputStreams.fromVideo) {
      // If toVideo is missing, pass fromVideo through.
      console.log(`CrossFadeTransitionRenderer: toVideo stream missing for transition ${transition.id}. Passing fromVideo stream through.`);
      outputStreams.video = inputStreams.fromVideo;
    }


    // --- Audio Cross-Fade (acrossfade) ---
    if (inputStreams.fromAudio && inputStreams.toAudio) {
      const fromAudioStream = inputStreams.fromAudio;
      const toAudioStream = inputStreams.toAudio;
      const audioOutputStream = builder.getUniqueStreamLabel(`a_trans_${transition.id}`);

      // acrossfade 'd' is duration. 'curve1' and 'curve2' affect the fade shape. 'tri' (triangular) is common for constant power.
      const acrossfadeFilter = `[${fromAudioStream}][${toAudioStream}]acrossfade=d=${transitionDuration}:curve1=tri:curve2=tri[${audioOutputStream}]`;
      builder.addFilter(acrossfadeFilter);
      outputStreams.audio = audioOutputStream;

    } else if (inputStreams.toAudio) {
      console.log(`CrossFadeTransitionRenderer: fromAudio stream missing for transition ${transition.id}. Passing toAudio stream through.`);
      outputStreams.audio = inputStreams.toAudio;
    } else if (inputStreams.fromAudio) {
      console.log(`CrossFadeTransitionRenderer: toAudio stream missing for transition ${transition.id}. Passing fromAudio stream through.`);
      outputStreams.audio = inputStreams.fromAudio;
    }

    return outputStreams;
  }
}

// Self-registration
transitionRegistry.register(new CrossFadeTransitionRenderer());
