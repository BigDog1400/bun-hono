// src/renderer/core/VideoRenderer.ts
import { LayoutV1, validateLayoutV1 } from "../schema/layout-v1";
import { convertToCanonicalTimeline, CanonicalTimeline, CTClip } from "./CanonicalTimeline";
import { FilterGraphBuilder } from "./FilterGraphBuilder";
import { sourceRegistry, effectRegistry, transitionRegistry } from "./PluginRegistry";
import type { RendererOptions, RenderResult, Source, Effect, Transition as TSchemaTransition } from "../types"; // TSchemaTransition to avoid conflict
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

export class VideoRenderer {
  constructor(private options: RendererOptions) {}

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create output directory: ${this.options.outputDir}`, error);
      throw error;
    }
  }

  public async render(doc: unknown): Promise<RenderResult> {
    try {
      console.log("VideoRenderer: Starting render process...");
      await this.ensureOutputDirectory();

      const validationResult = validateLayoutV1(doc);
      if (!validationResult.success) {
        console.error("VideoRenderer: Input schema validation failed.", validationResult.error.format());
        return { success: false, error: `Input validation failed: ${JSON.stringify(validationResult.error.format())}` };
      }
      const layoutDoc = validationResult.data;
      console.log("VideoRenderer: Input schema validated successfully.");

      console.log("VideoRenderer: Converting to Canonical Timeline...");
      const timeline: CanonicalTimeline = await convertToCanonicalTimeline(layoutDoc, this.options);
      console.log(`VideoRenderer: Conversion to Canonical Timeline complete. ${timeline.clips.length} clips generated.`);

      console.log("VideoRenderer: Building FFmpeg filter graph...");
      const builder = new FilterGraphBuilder(timeline, this.options, layoutDoc);

      // 1. Process all sources and their initial filters
      for (const clip of timeline.clips) {
        const sourcePlugin = sourceRegistry.get(clip.kind);
        // The 'props' in CTClip should be the original Source schema object or compatible
        const sourceData = { kind: clip.kind, src: clip.src, ...clip.props } as Source;

        // Source plugin adds its -i input. For 'colour' this is a no-op.
        // For other sources, this adds to builder.inputs
        if (sourcePlugin.addInputs) { // Check if addInputs method exists
             sourcePlugin.addInputs(builder, clip, sourceData);
        }

        const sourceOutputStreams = sourcePlugin.getFilter(builder, clip, sourceData); // Source plugin defines its initial filter chain

        if (sourceOutputStreams.video) {
          builder.updateClipStreamOutput(clip.id, 'video', sourceOutputStreams.video);
        }
        if (sourceOutputStreams.audio) {
          builder.updateClipStreamOutput(clip.id, 'audio', sourceOutputStreams.audio);
        }
      }

      // 2. Apply effects to each clip
      for (const clip of timeline.clips) {
        if (clip.effects && clip.effects.length > 0) {
          let currentVideoOutput = builder.getClipStreamOutput(clip.id, 'video');
          let currentAudioOutput = builder.getClipStreamOutput(clip.id, 'audio');

          for (const effect of clip.effects) {
            const effectPlugin = effectRegistry.get(effect.kind);
            const effectInputStreams = { video: currentVideoOutput, audio: currentAudioOutput };
            const effectedStreams = effectPlugin.apply(builder, clip, effect as Effect, effectInputStreams);

            currentVideoOutput = effectedStreams.video; // Update for next effect in chain
            currentAudioOutput = effectedStreams.audio;
          }
          // Update builder with the final stream labels for this clip after all effects
          if (currentVideoOutput) builder.updateClipStreamOutput(clip.id, 'video', currentVideoOutput);
          if (currentAudioOutput) builder.updateClipStreamOutput(clip.id, 'audio', currentAudioOutput);
        }
      }

      // 3. Video Compositing and Transitions (Simplified initial pass)
      // This is highly complex. For now:
      // - Create a base canvas if background is defined.
      // - Overlay video clips one by one based on time and track.
      // - Transitions are not handled in this pass yet.

      let currentTimelineVideoOutput: string | undefined;
      const canvasDetails = builder.getCanvasDimensions();

      // Create a base black canvas or use canvas.background
      if (canvasDetails.background) {
          const bgSource = canvasDetails.background as Source;
          const bgClipId = "canvas_background_clip";

          let bgStream: string;
          if (bgSource.kind === 'colour') {
              const colorPlugin = sourceRegistry.get('colour');
              const bgCtClip: CTClip = {
                  id: bgClipId, kind: 'colour', src: bgSource.src, track: 0, start: 0, end: timeline.duration, duration: timeline.duration, layerId: 'canvas',
                  props: { ...bgSource, w: canvasDetails.w, h: canvasDetails.h }
              };
              // Color plugin's getFilter generates the color stream. addInputs is a no-op.
              bgStream = colorPlugin.getFilter(builder, bgCtClip, bgSource).video!;
          } else { // image background
              const imagePlugin = sourceRegistry.get('image');
               const bgCtClip: CTClip = {
                  id: bgClipId, kind: 'image', src: bgSource.src, track: 0, start: 0, end: timeline.duration, duration: timeline.duration, layerId: 'canvas',
                  props: { ...bgSource, w: canvasDetails.w, h: canvasDetails.h, resize: 'stretch' }
              };
              // Image plugin's addInputs IS called.
              imagePlugin.addInputs(builder, bgCtClip, bgSource);
              bgStream = imagePlugin.getFilter(builder, bgCtClip, bgSource).video!;
          }
          currentTimelineVideoOutput = bgStream;

      } else {
        // Create a base black screen to overlay things upon if no background.
        // This stream needs to span the whole timeline duration.
        const baseBlack = builder.getUniqueStreamLabel("v");
        builder.addFilterSegment(`color=c=black:s=${canvasDetails.w}x${canvasDetails.h}:d=${timeline.duration}:r=${canvasDetails.fps}${baseBlack}`);
        currentTimelineVideoOutput = baseBlack;
      }

      // Simplified overlaying: Iterate through clips sorted by time, then track.
      // This doesn't handle complex overlaps perfectly but is a starting point.
      // A more robust approach would involve segmenting the timeline and processing layers for each segment.
      const videoClips = timeline.clips.filter(c => builder.getClipStreamOutput(c.id, 'video') && c.kind !== 'audio')
                                     .sort((a,b) => { // Ensure sort by start time, then track
                                        if (a.start !== b.start) return a.start - b.start;
                                        return a.track - b.track;
                                     });

      for (const clip of videoClips) {
        const clipVideoStream = builder.getClipStreamOutput(clip.id, 'video');
        if (clipVideoStream && currentTimelineVideoOutput) {
          // We need to make sure overlay happens only during clip's lifetime.
          // The `overlay` filter has `enable='between(t,start,end)'`
          // This is a simplified overlay; true timeline compositing is harder.
          // For now, this will overlay the *entire* clipStream onto the currentTimelineVideoOutput.
          // This is not correct for sequential clips, only for layers starting at the same time.
          // This section needs significant rework for proper timeline compositing.
          // Let's assume for now we are just overlaying clips that are meant to be layered globally.
          // This is a placeholder for a more complex layering engine.

          // A very basic approach: each clip is overlaid onto the current base.
          // This will be problematic for sequential clips.
          // For now, let's assume this stage is mostly about visual effects on individual clips
          // and the final compositing/transition logic is yet to be built.
          // The `overlayVideo` function uses x,y from clip.props.
          const x = clip.props?.x ?? 0;
          const y = clip.props?.y ?? 0;

          // This simplified logic will just overlay everything on top of each other.
          // This is okay if clips are full screen and sequential (transitions would handle fades).
          // Or if they are explicitly positioned smaller items.
          // The `isShortest=true` is important for overlays like titles or images on video.
          // For full frame video clips, this might not be what we want.
          // Let's assume `isShortest` should be true if the overlaying clip is not a 'video' kind.
          const isOverlayShortest = clip.kind !== 'video';

          // This is still not quite right for a general timeline.
          // A real compositor would need to manage segments of the timeline.
          // For now, we'll just update the currentTimelineVideoOutput sequentially.
          // This implies that later clips in the sorted list are "on top" if they overlap in time AND space.
          // This part of the code is the most hand-wavy currently.
          // TODO: Implement proper timeline segmentation and conditional overlaying
          // For now, this logic assumes clips are full-duration overlays or require specific handling during transitions.
          // A truly sequential composition requires segmenting and then concatenating or transitioning.
          // Let's assume for this pass that any clip processed here is intended to be layered globally,
          // or its sequencing is handled by how its stream is (or isn't) used later.
          if (clip.track > 0) { // Simple heuristic: track 0 might be a base, higher tracks are overlays.
                                // This doesn't account for time.
            // console.log(`Overlaying clip ${clip.id} (${clipVideoStream}) onto ${currentTimelineVideoOutput} at ${x},${y}`);
            currentTimelineVideoOutput = builder.overlayVideo(currentTimelineVideoOutput, clipVideoStream, x, y, isOverlayShortest);
          } else if (!currentTimelineVideoOutput && clip.track === 0) { // First base visual track
             currentTimelineVideoOutput = clipVideoStream;
          }
          // Note: This simplified loop doesn't build a sequence of clips for the main track.
          // It more or less assumes all video clips are layers on the initial base.
          // Proper sequential compositing (concatenation/transitions) is missing.
        } else if (clipVideoStream && !currentTimelineVideoOutput) {
            currentTimelineVideoOutput = clipVideoStream; // First video clip becomes the base
        }
      }

      if (currentTimelineVideoOutput) {
         builder.setFinalVideoOutput(currentTimelineVideoOutput);
      } else if (timeline.clips.some(c => c.kind !== 'audio' && c.kind !== 'colour' && c.kind !== 'image')) { // Check if there was any actual video clip
        // If there were visual clips but no final output, create a silent black screen.
        console.warn("VideoRenderer: No final video stream established despite visual clips. Outputting black screen.");
        const blackScreen = builder.getUniqueStreamLabel("v");
        builder.addFilterSegment(`color=c=black:s=${canvasDetails.w}x${canvasDetails.h}:d=${timeline.duration}:r=${canvasDetails.fps}${blackScreen}`);
        builder.setFinalVideoOutput(blackScreen);
      } else if (!currentTimelineVideoOutput && canvasDetails.background) {
        // This case means only a canvas background was defined, no other visuals.
        // currentTimelineVideoOutput should already be set from canvas background processing.
        // If it's not, it implies an issue in canvas background handling.
        // However, if it *is* set, we don't need to do anything extra here.
        // This else-if might be redundant if canvas background guarantees currentTimelineVideoOutput.
         console.log("VideoRenderer: Only canvas background present. Setting as final video output.");
         builder.setFinalVideoOutput(currentTimelineVideoOutput!); // It should be non-null if canvas.background was processed
      }


      // 4. Audio Processing: Mix all audio streams
      const audioStreamsToMix: string[] = [];
      for (const clip of timeline.clips) {
        const clipAudioStream = builder.getClipStreamOutput(clip.id, 'audio');
        if (clipAudioStream) {
          audioStreamsToMix.push(clipAudioStream);
        }
      }

      if (audioStreamsToMix.length > 0) {
        const mixedAudio = builder.mixAudio(audioStreamsToMix, 0.5); // 0.5s dropout transition
        builder.setFinalAudioOutput(mixedAudio);
      } else {
        console.log("VideoRenderer: No audio streams found to mix for the final output.");
        // No need to set final audio output if there's no audio.
      }

      console.log("VideoRenderer: Filter graph construction complete.");

      const { inputs, complexFilter, maps } = builder.build();
      const outputFilename = `output-${Date.now()}.mp4`;
      const outputPath = path.join(this.options.outputDir, outputFilename);

      // Basic output options: use h264 for video, aac for audio.
      // These should be configurable via RendererOptions.
      const ffmpegOutputOptions = [
        '-c:v', 'libx264',          // Video codec
        '-preset', 'medium',        // Encoding speed/quality trade-off
        '-crf', '23',               // Constant Rate Factor (quality, lower is better, 18-28 is common)
        '-pix_fmt', 'yuv420p',      // Pixel format for broad compatibility
        '-c:a', 'aac',              // Audio codec
        '-b:a', '192k',             // Audio bitrate
        // Add more options like -shortest, -y (overwrite) as needed
        '-y', // Overwrite output files without asking
      ];


      const ffmpegArgs = [...inputs, complexFilter, ...maps, ...ffmpegOutputOptions, outputPath].filter(arg => arg); // Filter out empty strings

      // Only run if there's something to map (either video or audio)
      if (maps.length > 0) {
        console.log("VideoRenderer: Executing FFmpeg command...");
        const result = await this.runFFmpeg(ffmpegArgs, outputPath); // Pass outputPath explicitly
        if (result.success) {
          return { success: true, outputPath: result.outputPath };
        } else {
          return { success: false, error: result.error };
        }
      } else {
        console.warn("VideoRenderer: No streams to map to output. FFmpeg command not executed.");
        return { success: false, error: "No content to render (no video or audio streams mapped)." };
      }

    } catch (error: any) {
      console.error("VideoRenderer: Rendering failed.", error);
      return { success: false, error: error.message || "An unknown error occurred during rendering." };
    }
  }

  private async runFFmpeg(args: string[], outputPath: string): Promise<{success: boolean, outputPath?: string, error?: string}> {
    return new Promise(async (resolve) => {
      const ffmpegPath = this.options.ffmpegPath || "ffmpeg";

      console.log(`Executing FFmpeg: ${ffmpegPath} ${args.filter(arg => typeof arg === 'string' && arg.length < 200).join(" ")}`); // Avoid logging huge base64 strings or filter_complex
      if (args.find(arg => typeof arg === 'string' && arg.length >= 200)) console.log(" (some long arguments omitted from log)");


      const outputDir = path.dirname(outputPath);
      try {
        await fs.mkdir(outputDir, { recursive: true });
      } catch(dirError) {
        console.error(`Failed to create directory for output file ${outputPath}:`, dirError);
        return resolve({ success: false, error: `Failed to create output directory: ${(dirError as Error).message}` });
      }

      const ffmpeg = spawn(ffmpegPath, args.filter(arg => typeof arg === 'string' && arg)); // Filter out empty/null strings
      let stderr = "";
      let stdout = "";
      let progressBuffer = "";


      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
        // console.log(`FFmpeg stdout: ${data}`); // Can be very verbose
      });

      ffmpeg.stderr.on('data', (data) => {
        const dataStr = data.toString();
        stderr += dataStr;
        progressBuffer += dataStr;

        let lineEndIndex;
        while((lineEndIndex = progressBuffer.indexOf('\n')) >=0 || (lineEndIndex = progressBuffer.indexOf('\r')) >=0) {
            const line = progressBuffer.substring(0, lineEndIndex);
            progressBuffer = progressBuffer.substring(lineEndIndex + 1);
            if (line.startsWith("frame=")) {
                 process.stdout.write(`\rFFmpeg Progress: ${line.trim()}`);
            }
        }
      });

      ffmpeg.on('close', (code) => {
        process.stdout.write('\n'); // New line after progress
        if (stdout) console.log("FFmpeg stdout:", stdout.substring(0, 2000) + (stdout.length > 2000 ? "..." : ""));

        if (code === 0) {
          if (stderr) console.log("FFmpeg stderr (warnings/info):", stderr.substring(0, 2000) + (stderr.length > 2000 ? "..." : ""));
          console.log(`FFmpeg execution successful for ${outputPath}`);
          resolve({ success: true, outputPath });
        } else {
          console.error("FFmpeg stderr (full on error):", stderr);
          console.error(`FFmpeg execution failed with code ${code}`);
          resolve({ success: false, error: `FFmpeg failed with code ${code}. Stderr: ${stderr}` });
        }
      });

      ffmpeg.on('error', (err) => {
        process.stdout.write('\n'); // New line after progress
        console.error('Failed to start FFmpeg process.', err);
        resolve({ success: false, error: `Failed to start FFmpeg: ${err.message}` });
      });
    });
  }
}
