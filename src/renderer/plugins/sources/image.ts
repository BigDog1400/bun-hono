import { SourceRenderer } from '../../types';
import { FilterGraphBuilder } from '../../core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../core/CanonicalTimeline';
import { sourceRegistry } from '../../core/PluginRegistry';

// Helper to get canvas dimensions (same as in video.ts)
const getCanvasDimensions = (builder: FilterGraphBuilder) => {
  const options = (builder as any).options || {};
  return {
    width: options.canvasWidth || 1920,
    height: options.canvasHeight || 1080,
    fps: options.fps || 30, // FPS needed for image loop duration
  };
};

class ImageSourceRenderer implements SourceRenderer {
  kind: string = 'image';

  async probe(source: CTSource): Promise<{ duration?: number }> {
    // Images themselves don't have an intrinsic duration for video purposes.
    // Duration is determined by how long they are shown on the timeline (clip.duration).
    return { duration: Infinity }; // As per Appendix A.5
  }

  addInputs(builder: FilterGraphBuilder, clip: CTClip, source: CTSource): void {
    if (source.resolvedPath) {
      builder.addInput(source.resolvedPath);
    } else {
      console.warn(`ImageSourceRenderer: Source ${source.id} for clip ${clip.id} has no resolvedPath. Cannot add input.`);
    }
  }

  getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: CTSource
  ): { video?: string; audio?: string } {
    const inputIndex = builder.getInputIndex(source.resolvedPath!);
    if (inputIndex === undefined) {
      console.error(`ImageSourceRenderer: Input index not found for source ${source.resolvedPath} of clip ${clip.id}.`);
      return {};
    }

    const canvas = getCanvasDimensions(builder);
    const clipDuration = clip.duration; // seconds

    if (!clipDuration || clipDuration <= 0) {
      console.warn(`ImageSourceRenderer: Clip ${clip.id} has invalid duration (${clipDuration}). Cannot generate filter.`);
      return {};
    }

    const videoStreamName = builder.getUniqueStreamLabel(`v_${clip.id}`);

    // To make an image behave like a video of `clip.duration`:
    // Loop the image (it's 1 frame), trim to duration, set PTS.
    // `loop=loop=-1:size=1` makes the image loop indefinitely (size=1 frame).
    // `trim=duration=${clip.duration}` takes the specified duration from this infinite stream.
    // `setpts=PTS-STARTPTS` resets timestamps for this segment.
    let videoFilter = `[${inputIndex}:v]loop=loop=-1:size=1,trim=duration=${clipDuration},setpts=PTS-STARTPTS`;

    // Scaling and Opacity (similar to video)
    const opacity = typeof clip.opacity === 'number' ? clip.opacity : 1.0;
    const scaleWidth = clip.width ? Math.floor(clip.width * canvas.width) : canvas.width;
    const scaleHeight = clip.height ? Math.floor(clip.height * canvas.height) : canvas.height;
    // TODO: Implement proper resizeMode (cover, contain, stretch) and positioning (x, y)

    videoFilter += `,scale=${scaleWidth}:${scaleHeight},setsar=1`;

    if (opacity < 1.0) {
      videoFilter += `,format=rgba,lutalpha=val=${opacity}`;
    }

    videoFilter += `[${videoStreamName}]`;
    builder.addFilter(videoFilter);

    // Images typically don't have audio.
    // If a silent audio track is needed for this duration, it should be handled by the main renderer
    // or a separate 'silent audio' source type.
    return { video: videoStreamName };
  }
}

sourceRegistry.register(new ImageSourceRenderer());
