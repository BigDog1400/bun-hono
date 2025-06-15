// src/renderer/plugins/sources/image.ts
import type { SourceRenderer, CTClip, Source } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { sourceRegistry } from "../../core/PluginRegistry";
import { LayoutV1 } from "../../schema/layout-v1"; // For canvas dimensions if needed

class ImageSourceRenderer implements SourceRenderer {
  public readonly kind = "image";

  public async probe(source: Source): Promise<{ duration: number; hasAudio: boolean; hasVideo: boolean }> {
    // Images have no intrinsic duration from FFmpeg's perspective for a timeline,
    // their duration is determined by the block they are in.
    // They also don't have audio. They do have video.
    return { duration: Infinity, hasAudio: false, hasVideo: true };
  }

  public addInputs(builder: FilterGraphBuilder, clip: CTClip, source: Source): void {
    // Add the image file as an FFmpeg input.
    // The 'src' here is the direct path/URL to the image.
    builder.addInput(source.src);
  }

  public getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: Source // The original source object from the layout
  ): { video?: string; audio?: string } {
    // The input stream for this image will be based on the order it was added.
    // builder.getInputCount() gives total inputs *before* this one was potentially added by another call,
    // so if addInputs is always called right before getFilter for the same source,
    // then `builder.getInputCount() - 1` is the correct index.
    const inputIndex = builder.getInputCount() - 1;
    let filterChain = `[${inputIndex}:v]`; // Selects the video stream from the last added input

    const canvas = builder.getCanvasDimensions();
    const clipProps = clip.props || {}; // props from CTClip, which should include resolved values

    // Default to canvas dimensions if w/h are not specified on the source
    const targetWidth = clipProps.w ?? canvas.w;
    const targetHeight = clipProps.h ?? canvas.h;

    // Scaling and Padding/Cropping (ResizeMode)
    // This is a simplified example. Real 'fit' and 'fill' might involve complex filter chains
    // with scale, crop, pad, setsar, etc. to handle aspect ratios correctly.
    // For 'fill' (crop to fit) and 'fit' (letterbox/pillarbox), we need to calculate aspect ratios.
    // Example: scale to target width, then pad/crop height, or vice-versa.
    // FFmpeg's scale filter: scale=w:h:force_original_aspect_ratio=[increase|decrease]
    // For now, a simple scale.

    // Intermediate stream for scaling
    const scaledStreamLabel = builder.getUniqueStreamLabel("v");
    let scaleFilter = `scale=${targetWidth}:${targetHeight}`;

    if (source.resize === 'fit') {
        // Letterbox/pillarbox: scale to fit within target dimensions while preserving aspect ratio
        // then pad to target dimensions.
        scaleFilter += `:force_original_aspect_ratio=decrease`;
        // Padding would be a separate filter if exact dimensions are needed after this scaling.
        // e.g., ...,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black
        // For simplicity, this example assumes 'fit' primarily means preserving aspect ratio within the box.
    } else if (source.resize === 'fill') {
        // Crop to fill: scale to cover target dimensions while preserving aspect ratio, then crop.
        scaleFilter += `:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;
    } else if (source.resize === 'stretch') {
        // Default behavior of scale is stretch if no aspect ratio options given and w/h are explicit.
    }
    // If no resize mode, or 'stretch', it just scales to targetWidth:targetHeight.

    filterChain += `${scaleFilter}${scaledStreamLabel}`;
    let currentVideoOutput = scaledStreamLabel;

    // Opacity: Handled by the 'format' filter for images, or 'lutalpha' for video streams
    // This needs to be applied after scaling.
    if (source.opacity !== undefined && source.opacity < 1) {
      const opacityStreamLabel = builder.getUniqueStreamLabel("v");
      // Ensure the image has an alpha channel first, then apply opacity.
      // For PNGs with alpha, this should work. For JPEGs, they need an alpha channel added.
      // 'format=rgba' or 'format=yuva420p' (depending on desired pixel format for video pipeline)
      // then apply 'colorchannelmixer' or 'lutalpha'.
      // Simplification: Assume 'lutalpha' can work if previous filters output alpha.
      // format=pix_fmts=yuva420p is good for video pipeline compatibility.
      // Using format=rgba and then colorchannelmixer.
      // Note: The stream currentVideoOutput already has the stream label in it (e.g. [v_1])
      filterChain += `;${currentVideoOutput}format=rgba,colorchannelmixer=aa=${source.opacity}${opacityStreamLabel}`;
      currentVideoOutput = opacityStreamLabel;
    }

    // Positioning (x, y) is handled during overlaying, not by the source filter itself.
    // The source filter just prepares the stream at the correct size and opacity.
    // The FilterGraphBuilder or VideoRenderer will later use this output stream
    // in an overlay filter like: `[base][overlay]overlay=x:y[out]`

    builder.addFilter(filterChain);

    return { video: currentVideoOutput };
  }
}

// Self-register the plugin when this file is imported.
// This ensures that if this module is loaded, the plugin becomes available.
sourceRegistry.register("image", new ImageSourceRenderer());
