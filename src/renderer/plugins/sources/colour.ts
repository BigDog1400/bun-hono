// src/renderer/plugins/sources/colour.ts
import type { SourceRenderer, CTClip, Source } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { sourceRegistry } from "../../core/PluginRegistry";

class ColorSourceRenderer implements SourceRenderer {
  public readonly kind = "colour";

  public async probe(source: Source): Promise<{ duration: number; hasAudio: boolean; hasVideo: boolean }> {
    // Solid colors, like images, have no intrinsic duration for timeline purposes.
    // Their duration is determined by the block they are in.
    // They provide video but no audio.
    return { duration: Infinity, hasAudio: false, hasVideo: true };
  }

  public addInputs(builder: FilterGraphBuilder, clip: CTClip, source: Source): void {
    // The 'color' source in FFmpeg doesn't require a separate '-i' input file.
    // It's generated directly within the filter graph.
    // So, this method can be a no-op for this specific plugin.
  }

  public getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: Source // The original source object from the layout
  ): { video?: string; audio?: string } {
    const canvas = builder.getCanvasDimensions();
    const clipProps = clip.props || {}; // props from CTClip

    // Resolve dimensions: use clip.props.w/h, then source.w/h, then canvas w/h
    const width = clipProps.w ?? source.w ?? canvas.w;
    const height = clipProps.h ?? source.h ?? canvas.h;

    // Duration for the color source filter: uses clip's duration.
    // FFmpeg's color filter needs a 'd' parameter for duration if it's not infinite.
    // However, when part of a complex filtergraph that's globally timed,
    // the color source can be treated as infinite and trimmed by later filters or overlays.
    // For simplicity in a filter chain, we can generate it with the clip's duration.
    const duration = clip.duration;

    // Opacity is a bit tricky with the 'color' source directly.
    // The 'color' source can take an alpha value (e.g., color=red@0.5).
    // FFmpeg color names or hex codes: source.src (e.g., "blue", "#FF0000")
    let colorSpec = source.src;
    if (source.opacity !== undefined && source.opacity < 1) {
      // Append alpha to the color string if not already there.
      // This assumes source.src doesn't already include an alpha.
      // FFmpeg format is color@opacity (e.g., blue@0.5, #RRGGBB@0.5)
      // If source.src is like #RRGGBBAA, this might need adjustment.
      // For now, assume src is color name or #RRGGBB.
      if (!colorSpec.includes('@')) {
        colorSpec = `${colorSpec}@${source.opacity}`;
      } else {
        // If colorSpec already has an alpha (e.g. from user input like 'red@0.8'),
        // we might want to multiply this by a general source.opacity if both are present.
        // For now, assume source.opacity is the definitive one if present.
        // This part might need more robust parsing of source.src if it can contain alpha.
        const parts = colorSpec.split('@');
        colorSpec = `${parts[0]}@${source.opacity}`;
      }
    }

    const colorStream = builder.getUniqueStreamLabel("v");

    // Construct the filter: color=c=<colorSpec>:s=<WxH>:d=<duration>
    // The 'd' (duration) parameter for the color source might not be strictly necessary
    // if this stream is used as an overlay input that is itself timed.
    // However, providing it makes the stream finite.
    // Using framerate from canvas options.
    const fps = canvas.fps;
    const filterString = `color=c=${colorSpec}:s=${width}x${height}:d=${duration}:r=${fps}${colorStream}`;

    builder.addFilter(filterString);

    return { video: colorStream };
  }
}

// Self-register the plugin
sourceRegistry.register("colour", new ColorSourceRenderer());
