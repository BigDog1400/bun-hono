import { LayoutV1, LayoutDocument } from '../schema/layout-v1';
import { convertToCanonicalTimeline, CanonicalTimeline, CTClip } from './CanonicalTimeline';
import { FilterGraphBuilder, RendererOptions as FGRendererOptions } from './FilterGraphBuilder';
import { sourceRegistry, effectRegistry, transitionRegistry } from './PluginRegistry';
import { SourceRenderer, EffectRenderer, TransitionRenderer } from '../types';
import { executeFFmpegCommand, FFmpegExecuteResult } from '../utils/ffmpeg-executor'; // Import the new executor

// --- Types ---

/**
 * Options for the VideoRenderer.
 * Extends FilterGraphBuilder's RendererOptions and adds output specifics.
 */
export interface RendererOptions extends FGRendererOptions {
  outputDir: string;
  outputFile: string;
  ffmpegPath?: string; // Optional: path to ffmpeg executable
  // Add other options like progress reporting callbacks, etc.
  enableVerboseLogging?: boolean;
}

/**
 * Result of a rendering operation.
 */
export interface RenderResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  details?: any; // For more detailed error info or stats
}

// --- VideoRenderer Class ---

/**
 * Main class responsible for orchestrating the video rendering process.
 * It converts the input document to a canonical timeline, builds an FFmpeg
 * filter graph using registered plugins, and then executes FFmpeg.
 */
export class VideoRenderer {
  private options: RendererOptions;

  constructor(options: RendererOptions) {
    this.options = {
      ffmpegPath: 'ffmpeg', // Default ffmpeg command
      ...options,
    };
  }

  /**
   * Renders a video based on the provided LayoutV1 document.
   * @param doc The LayoutV1 document describing the video.
   * @returns A Promise resolving to a RenderResult.
   */
  public async render(doc: LayoutV1): Promise<RenderResult> {
    if (this.options.enableVerboseLogging) {
      console.log('VideoRenderer: Starting render process...');
      console.log('VideoRenderer: Input document:', JSON.stringify(doc, null, 2));
    }

    try {
      // 1. Validate Input (Zod does this on type hint for LayoutV1)
      // For extra robustness, explicit parsing can be done:
      // const parseResult = LayoutDocument.safeParse(doc);
      // if (!parseResult.success) {
      //   return { success: false, error: 'Invalid input document', details: parseResult.error.issues };
      // }
      // const validatedDoc = parseResult.data;

      // 2. Convert to Canonical Timeline
      // Assuming convertToCanonicalTimeline is adapted to handle LayoutV1 structure correctly.
      if (this.options.enableVerboseLogging) console.log('VideoRenderer: Converting to Canonical Timeline...');
      const timeline: CanonicalTimeline = await convertToCanonicalTimeline(doc);
      if (this.options.enableVerboseLogging) {
        console.log('VideoRenderer: Canonical Timeline:', JSON.stringify(timeline, null, 2));
      }

      if (!timeline.clips || timeline.clips.length === 0) {
        console.warn('VideoRenderer: No clips found in the canonical timeline. Output might be empty.');
        // Potentially return success with an empty/short video or an error.
        // For now, we'll proceed and let FFmpeg potentially fail or produce an empty file.
      }

      // 3. Build Filter Graph
      if (this.options.enableVerboseLogging) console.log('VideoRenderer: Building Filter Graph...');
      const builder = new FilterGraphBuilder({ /* pass relevant options from this.options if needed */ });

      // Add all sources from the timeline as inputs to FFmpeg
      // This ensures FFmpeg knows about all files referenced by sources.
      // The SourceRenderer will then use the input index.
      const sourceInputMap = new Map<string, number>(); // Map source.id to input index
      for (const source of timeline.sources) {
        // Assuming source.resolvedPath is the actual file path or resolvable URL
        if (source.resolvedPath) {
          const inputIndex = builder.addInput(source.resolvedPath);
          sourceInputMap.set(source.id, inputIndex);
        } else {
          console.warn(`VideoRenderer: Source ${source.id} has no resolvedPath. It might be a non-file source (e.g. color) or an error.`);
        }
      }

      // Store output stream labels for each clip
      const clipStreamLabels = new Map<string, string>(); // clip.id -> streamLabel

      // Process clips to generate filter segments
      for (const clip of timeline.clips) {
        const source = timeline.sources.find(s => s.id === clip.sourceId);
        if (!source) {
          console.warn(`VideoRenderer: Source with ID ${clip.sourceId} not found for clip ${clip.id}. Skipping clip.`);
          continue;
        }

        const sourcePlugin = sourceRegistry.get(source.kind); // or clip.kind if more specific
        if (!sourcePlugin) {
          return { success: false, error: `SourceRenderer not found for kind: ${source.kind} (for clip ${clip.id})` };
        }

        // The SourceRenderer's render method is responsible for adding necessary inputs
        // (if not already added globally like above) and generating its part of the filter graph.
        // It should use the inputIndex provided by the builder for its specific source file.
        // We need to pass the specific source object (CTSource) to the renderer,
        // and the clip object (CTClip) for context like timing, props.
        // The `render` method of SourceRenderer might need to be:
        // render(builder: FilterGraphBuilder, source: CTSource, clip: CTClip, inputIndex: number | undefined): string;
        // For now, adapting to current SourceRenderer.render(builder, source): string
        // This implies SourceRenderer needs to find its input via builder by path, or we pass more context.
        // Let's assume for now the SourceRenderer's `render` takes the `clip` and can find its `source` info.
        // A better approach: SourceRenderer.render(builder, clip, timeline.sources)
        // Or: SourceRenderer.render(builder, clip, sourceMap.get(clip.sourceId), sourceInputMap.get(clip.sourceId))

        // Current SourceRenderer interface is: render(builder: FilterGraphBuilder, source: Source /* CTSource */): string;
        // This is problematic as it doesn't know the clip's specific timing/props or its input index.
        // Let's *assume* for this step that SourceRenderer's `render` is more like:
        // render(builder: FilterGraphBuilder, clip: CTClip, allSources: CTSource[]): string
        // And it internally finds its source and adds inputs if needed.
        // For the purpose of this subtask, we'll call it with the source object associated with the clip.
        // The actual graph building logic within plugins and FilterGraphBuilder will need refinement.

        // Simplified call based on current SourceRenderer:
        // const outputStream = sourcePlugin.render(builder, source);
        // This isn't quite right. The plugin needs the CLIP data.
        // Let's imagine a revised SourceRenderer for now:
        // export interface SourceRenderer {
        //   kind: string;
        //   render(builder: FilterGraphBuilder, clip: CTClip, source: CTSource, inputIndex?: number): string;
        // }
        // And we'd call:
        // const inputIndex = sourceInputMap.get(source.id);
        // const outputStreamLabel = sourcePlugin.render(builder, clip, source, inputIndex);
        // clipStreamLabels.set(clip.id, outputStreamLabel);

        // For now, let's stick to the PRD's skeleton which implies a simpler interaction loop,
        // and the complexity is inside plugins or builder.
        // The PRD Appendix A.3 (SourceRenderer) has `render(builder, source): string`.
        // This means the builder or plugin must handle the context of *which* clip uses this source.
        // This is a gap. Let's proceed by *logging* what we would do.

        if (this.options.enableVerboseLogging) {
            console.log(`VideoRenderer: Processing clip ${clip.id}, source ${source.id} (kind: ${source.kind}) with plugin ${sourcePlugin.kind}`);
        }
        // This is where the filter for *this specific clip instance* would be generated.
        // For example: `[${inputIndex}:v]trim=start=${clip.absoluteStartTime}:duration=${clip.duration},setpts=PTS-STARTPTS[${clip.id}_v];`
        // The actual filter generation will be complex and happen within plugins / builder.
        // For now, we'll just log that we'd ask the plugin to render this clip.
        // builder.addFilter(...); // This would be called by the plugin or here based on plugin output.

        // Placeholder: Assume each clip processing step adds to the filter graph via the builder.
        // The current `SourceRenderer` interface `render(builder, source)` is insufficient alone.
        // It needs clip-specific context.
        // Let's simulate that the builder gets this context somehow or plugins are more complex.
        // For this step, we'll assume the builder is being correctly populated by these calls.
        // A more realistic loop might involve:
        // 1. Primary streams (from sources)
        // 2. Effects on those streams
        // 3. Transitions between streams
        // 4. Compositing/Mixing streams

        // For now, let's assume a high-level call per clip that the builder will handle:
        builder.addClipToGraph(clip, timeline.sources, sourceRegistry, effectRegistry, transitionRegistry);

      } // End of clips loop

      // After all clips are processed, the builder would finalize the graph (e.g. complex compositing, audio mixing)
      // This might involve calling builder.compositeAndMix(timeline.clips, clipStreamLabels);

      // 4. Execute FFmpeg
      const ffmpegCommandArgs = builder.buildCommandArgs(
        `${this.options.outputDir}/${this.options.outputFile}`
      );

      const ffmpegFullCommand = `${this.options.ffmpegPath} ${ffmpegCommandArgs.join(' ')}`;

      if (this.options.enableVerboseLogging) {
        console.log('VideoRenderer: Generated FFmpeg command:');
        console.log(ffmpegFullCommand);
      }

      // Placeholder for actual FFmpeg execution:
      // For now, just log the command and return success. // This comment is now outdated by the change below
      // In a real implementation: // This is now done in ffmpeg-executor.ts

      // Execute FFmpeg command
      const ffmpegResult: FFmpegExecuteResult = await executeFFmpegCommand(ffmpegCommandArgs, {
        ffmpegPath: this.options.ffmpegPath,
        enableVerboseLogging: this.options.enableVerboseLogging,
      });

      if (ffmpegResult.success) {
        return {
          success: true,
          outputPath: `${this.options.outputDir}/${this.options.outputFile}`,
        };
      } else {
        console.error('VideoRenderer: FFmpeg execution failed.');
        if (ffmpegResult.errorLog) {
          // console.error('VideoRenderer: FFmpeg stderr:\n', ffmpegResult.errorLog); // Already logged by executor if verbose
        }
        return {
          success: false,
          error: `FFmpeg execution failed: ${ffmpegResult.details || 'Unknown FFmpeg error'}`,
          details: ffmpegResult.errorLog,
        };
      }

    } catch (error: any) {
      // This catch block now handles errors from earlier stages (timeline, graph building)
      // or errors from executeFFmpegCommand if it throws (though it's designed to return a result object).
      console.error('VideoRenderer: Error during rendering orchestration', error);
      return {
        success: false,
        error: error.message || 'Unknown error during rendering',
        details: error.stack,
      };
    }
  }
}

// Example of how FilterGraphBuilder might be extended:
declare module './FilterGraphBuilder' {
  interface FilterGraphBuilder {
    addClipToGraph(
      clip: CTClip,
      allSources: CanonicalTimeline['sources'],
      sourceRegistry: typeof sourceRegistry,
      effectRegistry: typeof effectRegistry,
      transitionRegistry: typeof transitionRegistry
    ): void;
  }
}

FilterGraphBuilder.prototype.addClipToGraph = function(
  this: FilterGraphBuilder,
  clip,
  allSources,
  sourceReg,
  effectReg,
  transitionReg
) {
  // This is a placeholder where the actual logic for processing a clip would go.
  // It would:
  // 1. Find the source for the clip.
  // 2. Get the input index for that source file.
  // 3. Call the appropriate SourceRenderer to get the base stream for the clip (e.g., trim, scale).
  //    - const source = allSources.find(s => s.id === clip.sourceId);
  //    - const sourcePlugin = sourceReg.get(source.kind);
  //    - let stream = sourcePlugin.render(this, clip, source, this.getInputIndex(source.resolvedPath));
  // 4. Apply effects to this stream.
  //    - for (const effect of clip.effects) { effectPlugin = effectReg.get(effect.kind); stream = effectPlugin.apply(this, stream, effect); }
  // 5. Store this stream label. If it's part of a transition, handle that.
  // 6. Later, all final streams would be composited/mixed.
  console.log(`FilterGraphBuilder.addClipToGraph called for clip ${clip.id} (Source: ${clip.sourceId})`);
  // Example: this.addFilter(`[${this.getInputCount()-1}:v] trim=... [${clip.id}_v]`); // Highly simplified
};
