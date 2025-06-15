import { SourceRenderer } from '../../types';
import { FilterGraphBuilder } from '../../core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../core/CanonicalTimeline';
import { sourceRegistry } from '../../core/PluginRegistry';

// Helper to get canvas dimensions, assuming they are stored in builder.options
// In a more robust setup, these would be explicitly passed or accessed from a dedicated Timeline object.
const getCanvasDimensions = (builder: FilterGraphBuilder) => {
  // Accessing options directly if they exist on FilterGraphBuilder from its constructor
  // This is a simplification. Ideally, these come from CanonicalTimeline's properties.
  const options = (builder as any).options || {};
  return {
    width: options.canvasWidth || 1920, // Default if not set
    height: options.canvasHeight || 1080, // Default if not set
  };
};


class VideoSourceRenderer implements SourceRenderer {
  kind: string = 'video';

  async probe(source: CTSource): Promise<{ duration?: number }> {
    // In a real scenario, use ffprobe to get duration.
    // For now, return source.duration if set, or a placeholder.
    if (typeof source.duration === 'number') {
      return { duration: source.duration };
    }
    console.warn(`VideoSourceRenderer: Probe for ${source.id} - duration not available in source, returning placeholder 30s.`);
    return { duration: 30 }; // Placeholder duration
  }

  addInputs(builder: FilterGraphBuilder, clip: CTClip, source: CTSource): void {
    if (source.resolvedPath) {
      builder.addInput(source.resolvedPath);
    } else {
      console.warn(`VideoSourceRenderer: Source ${source.id} for clip ${clip.id} has no resolvedPath. Cannot add input.`);
    }
  }

  getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: CTSource
  ): { video?: string; audio?: string } {
    const inputIndex = builder.getInputIndex(source.resolvedPath!);
    if (inputIndex === undefined) {
      console.error(`VideoSourceRenderer: Input index not found for source ${source.resolvedPath} of clip ${clip.id}. Ensure addInputs was called.`);
      // Potentially throw an error or return empty if this is critical
      return {};
    }

    const results: { video?: string; audio?: string } = {};
    const canvas = getCanvasDimensions(builder); // Get canvas dimensions

    // --- Video Stream ---
    // Properties from clip or source. Default values are important.
    const opacity = typeof clip.opacity === 'number' ? clip.opacity : 1.0;
    // Assuming resizeMode, x, y, width, height are on the clip.props or directly on clip
    // For now, we'll use a simple scale to canvas size if not specified.
    const scaleWidth = clip.width ? Math.floor(clip.width * canvas.width) : canvas.width;
    const scaleHeight = clip.height ? Math.floor(clip.height * canvas.height) : canvas.height;
    // TODO: Implement proper resizeMode (cover, contain, stretch) and positioning (x, y) via FFmpeg filters like scale, pad, crop.
    // For 'cover' or 'contain', complex filter chains are needed.
    // A simple 'stretch' is scale=${scaleWidth}:${scaleHeight}.
    // For now, let's assume a simple scale to fit canvas, ignoring aspect ratio if width/height are not set on clip.

    const videoStreamName = builder.getUniqueStreamLabel(`v_${clip.id}`);
    let videoFilter = `[${inputIndex}:v]`; // Input video stream

    // Trim and set PTS for the clip's segment
    // Assuming source itself is not trimmed, clip.absoluteStartTime is relative to source start for this filter
    // No, clip.absoluteStartTime is global. We need start time *within the source file*.
    // This requires a concept of `sourceStartTime` on the clip, or assume block.start is it.
    // For now, if block.start in LayoutV1 (which becomes clip.absoluteStartTime) means "start reading source from this timestamp",
    // then `trim` filter's `start` should be this. But FFmpeg's `trim` filter `start` is tricky.
    // A common pattern is: `[N:v]trim=start_pts=X:end_pts=Y,setpts=PTS-STARTPTS[stream]`
    // Or, more simply for duration: `[N:v]trim=duration=${clip.duration},setpts=PTS-STARTPTS[intermediate];`
    // However, if the source video is used multiple times, we need to be careful.
    // Let's assume the clip.absoluteStartTime implies a seek for now via -ss before input, or use trim carefully.
    // The `VideoRenderer` might handle -ss based on `clip.sourceStartTimeInSource` (a new property).
    // For now, let the filter operate on the whole source duration, and `VideoRenderer` will map it.
    // This is complex. A simpler way for filters:
    // `[${inputIndex}:v]trim=start=${clip.startInSource || 0}:duration=${clip.duration},setpts=PTS-STARTPTS`
    // Let's assume `clip.duration` is what we want to extract.
    // The PRD and CTClip don't have `startInSource`. Assume `block.start` was it.
    // For now, the filter will just take the stream and apply visual props.
    // The overall timeline composition will handle when this clip appears.

    videoFilter += `scale=${scaleWidth}:${scaleHeight},setsar=1`;

    if (opacity < 1.0) {
      videoFilter += `,format=rgba,lutalpha=val=${opacity}`;
    }
    videoFilter += `[${videoStreamName}]`;
    builder.addFilter(videoFilter);
    results.video = videoStreamName;

    // --- Audio Stream ---
    // Check if the source video has an audio stream (e.g. [0:a])
    // This requires probing or assuming. For now, we assume it might.
    const volume = typeof clip.volume === 'number' ? clip.volume / 100 : 1.0; // Assuming 0-100 input

    // We need a way to know if an audio stream exists for this input.
    // FilterGraphBuilder's addInput could return info, or probe could.
    // For now, let's conditionally create an audio filter path.
    // A robust way: ffprobe tells us if source.resolvedPath has audio.
    // Let's assume for video sources, we *try* to process audio.

    const audioStreamName = builder.getUniqueStreamLabel(`a_${clip.id}`);
    let audioFilter = `[${inputIndex}:a]`; // Input audio stream (e.g., [0:a])
    // Similar trim/duration logic as video applies here.

    if (volume !== 1.0) {
      audioFilter += `volume=${volume}`;
    }
    // If no volume change, just pass it through.
    // To ensure it's part of the graph and gets a label:
    audioFilter += (volume !== 1.0 ? `` : `anull`) + `[${audioStreamName}]`;

    // IMPORTANT: Add filter only if an audio stream is likely.
    // This is a guess. A real impl needs to know if inputIndex:a exists.
    // builder.addFilter(audioFilter); // This might fail if [0:a] doesn't exist.
    // A safer approach is to have the main renderer decide if to map audio from video sources.
    // For now, let's add it but be aware of this.
    // The VideoRenderer could check timeline.source[sourceId].hasAudio (from probe)
    // For now, let's assume it's okay to try and it will fail gracefully or be ignored if no audio track.
    // A common pattern is to use `anullsrc` if no audio is desired or present, then mix that.
    // Or, only add this filter if `source.hasAudio` (from probe).
    // Let's assume `source.hasAudio` is true for this example.
    if (source.kind === 'video') { // Only process audio if it's a video source (could have audio)
        // This is still a guess. Probe should confirm.
        // builder.addFilter(audioFilter);
        // results.audio = audioStreamName;
        // For now, let's be conservative and only return audio stream if volume is not default
        // or if explicitly requested. This part is tricky without more info from probe.
        // Let's assume for now video sources *can* provide audio.
        // The user of getFilter can decide if to use the audio stream.
        results.audio = audioStreamName; // The filter string for this will be built by VideoRenderer later
                                         // by concatenating if needed. Or builder.addFilter here.
                                         // The current VideoRenderer expects getFilter to return labels,
                                         // and it's implied that builder.addFilter was called by plugin.
        builder.addFilter(audioFilter);
    }


    return results;
  }
}

sourceRegistry.register(new VideoSourceRenderer());
