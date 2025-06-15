// src/renderer/core/VideoRenderer.ts
import { LayoutDocumentSchema, LayoutV1, validateLayoutV1 } from "../schema/layout-v1";
import { convertToCanonicalTimeline, CanonicalTimeline } from "./CanonicalTimeline";
import { FilterGraphBuilder } from "./FilterGraphBuilder";
import { sourceRegistry, effectRegistry, transitionRegistry } from "./PluginRegistry";
import type { RendererOptions, RenderResult, SourceRenderer, Source } from "../types"; // Added Source
import { spawn } from 'child_process'; // For actual FFmpeg execution later
import * as path from 'path'; // For path manipulation
import * as fs from 'fs/promises'; // For filesystem operations (e.g. creating output dir)

export class VideoRenderer {
  constructor(private options: RendererOptions) {
    // Ensure output directory exists
    // This is a side effect in constructor, sometimes debated, but practical here.
    // fs.mkdirSync(this.options.outputDir, { recursive: true });
    // Using async version in an async init method or first render call is cleaner.
    // For now, let's assume outputDir will be ensured before actual ffmpeg call.
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create output directory: ${this.options.outputDir}`, error);
      throw error; // Re-throw to be caught by the render method
    }
  }

  public async render(doc: unknown): Promise<RenderResult> {
    try {
      console.log("VideoRenderer: Starting render process...");
      await this.ensureOutputDirectory();

      // 1. Validate and Parse Input
      console.log("VideoRenderer: Validating input schema...");
      const validationResult = validateLayoutV1(doc);
      if (!validationResult.success) {
        console.error("VideoRenderer: Input schema validation failed.", validationResult.error.format());
        return {
          success: false,
          error: `Input validation failed: ${JSON.stringify(validationResult.error.format())}`
        };
      }
      const layoutDoc = validationResult.data;
      console.log("VideoRenderer: Input schema validated successfully.");

      // 2. Convert to Canonical Timeline
      console.log("VideoRenderer: Converting to Canonical Timeline...");
      const timeline: CanonicalTimeline = await convertToCanonicalTimeline(layoutDoc, this.options);
      console.log(`VideoRenderer: Conversion to Canonical Timeline complete. ${timeline.clips.length} clips generated.`);

      // 3. Build Filter Graph
      console.log("VideoRenderer: Building FFmpeg filter graph...");
      const builder = new FilterGraphBuilder(timeline, this.options, layoutDoc);

      // --- Plugin Interaction ---
      // This is a simplified initial pass. Actual effect/transition application is more complex.

      // Add inputs and get initial filter chains from source plugins
      for (const clip of timeline.clips) {
        // TODO: Differentiate handling based on clip.kind (video, audio, image, etc.)
        // This basic loop assumes all clips are simple sources for now.
        // More complex logic will be needed for overlays, effects, transitions.

        // The 'props' in CTClip should ideally be the 'Source' schema object itself
        // or a derivative that SourceRenderer can understand.
        // Assuming clip.props is compatible with what SourceRenderer expects for a Source.
        const sourceData: Source = { // Explicitly type as Source
            kind: clip.kind as Source['kind'], // Ensure kind is compatible
            src: clip.src,
            // Spread other properties from SourceSchema, ensuring they are valid for Source type
            ...(clip.props as Omit<Source, 'kind' | 'src'> || {})
        };

        try {
            const sourcePlugin = sourceRegistry.get(clip.kind);

            // Add FFmpeg -i inputs
            // The sourceData here should conform to what addInputs expects (likely the original Source schema object)
            sourcePlugin.addInputs(builder, clip, sourceData);

            // Get filter string for this source
            // const filterOutputStreams = sourcePlugin.getFilter(builder, clip, sourceData);
            // builder.addFilter(filterOutputStreams.video || filterOutputStreams.audio);
            // This part needs to be more sophisticated: getFilter returns stream labels.
            // These labels are then used to construct the main filter graph (e.g. overlay, amix).
            // For now, this is a placeholder for where that logic will go.

        } catch (pluginError) {
            console.error(`VideoRenderer: Error processing clip ${clip.id} with plugin ${clip.kind}`, pluginError);
            throw pluginError; // Propagate to main catch
        }
      }

      // TODO: Implement actual graph building logic:
      // - Iterate through clips in time order.
      // - Apply effects.
      // - Handle layering (overlay filter).
      // - Handle transitions between clips/blocks.
      // - Mix audio (amix filter).
      // - Set final output streams on the builder.
      // This is the core of the rendering engine and will be built out iteratively.
      // For now, we'll just try to build whatever the plugins added.
      // A very basic placeholder for the final output streams:
      // builder.setOutputStreams("[final_v]", "[final_a]"); // These need to be actual stream labels from the graph

      console.log("VideoRenderer: FFmpeg filter graph construction placeholder complete.");

      // const { inputs, complexFilter, maps } = builder.build();
      const commandArgs = builder.build(); // Will be empty/minimal for now

      // 4. Execute FFmpeg (Placeholder)
      console.log("VideoRenderer: Executing FFmpeg command (placeholder)...");
      // console.log("FFmpeg Inputs:", commandArgs.inputs.join(" "));
      // console.log("FFmpeg Filter:", commandArgs.complexFilter);
      // console.log("FFmpeg Maps:", commandArgs.maps.join(" "));
      // const outputPath = path.join(this.options.outputDir, `output-${Date.now()}.mp4`);
      // const ffmpegArgs = [...commandArgs.inputs, commandArgs.complexFilter, ...commandArgs.maps, outputPath];
      // const result = await this.runFFmpeg(ffmpegArgs);


      // 5. Return result (Placeholder)
      console.log("VideoRenderer: Render process (placeholder) finished.");
      // if (result.success) {
      //   return { success: true, outputPath: result.outputPath };
      // } else {
      //   return { success: false, error: result.error };
      // }
      return { success: true, outputPath: "placeholder/output.mp4" };


    } catch (error: any) {
      console.error("VideoRenderer: Rendering failed.", error);
      return { success: false, error: error.message || "An unknown error occurred during rendering." };
    }
  }

  // Placeholder for actual FFmpeg execution
  private async runFFmpeg(args: string[]): Promise<{success: boolean, outputPath?: string, error?: string}> {
    return new Promise(async (resolve) => {
      const ffmpegPath = this.options.ffmpegPath || "ffmpeg";
      const outputPath = args[args.length -1]; // Convention: last arg is output path

      console.log(`Executing FFmpeg: ${ffmpegPath} ${args.join(" ")}`);

      // Ensure output directory exists for the specific output file
      const outputDir = path.dirname(outputPath);
      try {
        await fs.mkdir(outputDir, { recursive: true });
      } catch(dirError) {
        console.error(`Failed to create directory for output file ${outputPath}:`, dirError);
        return resolve({ success: false, error: `Failed to create output directory: ${(dirError as Error).message}` });
      }

      const ffmpeg = spawn(ffmpegPath, args);
      let stderr = "";

      ffmpeg.stdout.on('data', (data) => {
        console.log(`FFmpeg stdout: ${data}`);
      });

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`FFmpeg stderr: ${data}`);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`FFmpeg execution successful for ${outputPath}`);
          resolve({ success: true, outputPath });
        } else {
          console.error(`FFmpeg execution failed with code ${code}`);
          resolve({ success: false, error: `FFmpeg failed with code ${code}. Stderr: ${stderr}` });
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('Failed to start FFmpeg process.', err);
        resolve({ success: false, error: `Failed to start FFmpeg: ${err.message}` });
      });
    });
  }
}
