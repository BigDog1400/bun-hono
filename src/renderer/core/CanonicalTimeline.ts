// src/renderer/core/CanonicalTimeline.ts
import { LayoutDocumentSchema, LayoutV1, SourceSchema, BlockSchema } from "../schema/layout-v1";
import type { CTClip as ICTClip, Source as ISource, Effect as IEffect, Transition as ITransition, RendererOptions } from "../types";
import { EffectSchema, TransitionSchema } from "../schema/layout-v1"; // Import if needed for CTClip population

export type CTClip = ICTClip;
export type Source = ISource; // This is the schema type for a source
export type Effect = IEffect; // Schema type for an effect
export type Transition = ITransition; // Schema type for a transition

export interface ProbedSourceData {
  duration: number; // in seconds, Infinity for images/colors unless specified by block
  width?: number;    // pixels
  height?: number;   // pixels
  hasAudio?: boolean;
  hasVideo?: boolean;
  // Other relevant metadata ffprobe might return
}

// Placeholder for actual ffprobe functionality
async function probeSource(source: Source, blockDuration?: number): Promise<ProbedSourceData> {
  // In a real implementation, this would call ffprobe-wasm or an ffprobe service.
  // console.log(`Probing: ${source.src} (kind: ${source.kind})`);
  switch (source.kind) {
    case "video":
      // Simulate ffprobe output for video
      // Real probing would get actual duration, w, h, and stream info.
      return {
        duration: source.src.includes("long") ? 20 : (source.src.includes("short") ? 5 : 10), // Mock based on name
        width: source.src.includes("hd") ? 1920 : 1280,
        height: source.src.includes("hd") ? 1080 : 720,
        hasAudio: !source.src.includes("noaudio"),
        hasVideo: true,
      };
    case "audio":
      return {
        duration: source.src.includes("long_audio") ? 60 : (source.src.includes("short_audio") ? 15 : 30),
        hasAudio: true,
        hasVideo: false,
      };
    case "image":
      return {
        duration: blockDuration ?? Infinity, // Image duration is determined by context or block
        width: source.src.includes("large_image") ? 1920 : 800,
        height: source.src.includes("large_image") ? 1080 : 600,
        hasAudio: false,
        hasVideo: true,
      };
    case "colour":
      return {
        duration: blockDuration ?? Infinity, // Color duration is determined by context or block
        width: undefined, // Will default to canvas or explicit source.w
        height: undefined, // Will default to canvas or explicit source.h
        hasAudio: false,
        hasVideo: true,
      };
    default:
      console.warn(`Unknown source kind to probe: ${source.kind}`);
      return { duration: 0, hasAudio: false, hasVideo: false };
  }
}


export interface CanonicalTimeline {
  clips: CTClip[];
  duration: number;
  canvas: {
    w: number;
    h: number;
    fps: number;
    background?: Source; // Resolved global background
  };
}

export async function convertToCanonicalTimeline(
  doc: LayoutV1, // Expect validated doc
  rendererOptions: RendererOptions // For things like default FPS, etc.
): Promise<CanonicalTimeline> {
  const clips: CTClip[] = [];
  let currentTime = 0; // Tracks the end time of the last processed block for sequential layout
  let blockCounter = 0; // For unique block IDs if not provided

  const canvas = {
    w: doc.canvas.w,
    h: doc.canvas.h,
    fps: doc.canvas.fps,
    background: doc.canvas.background ? ({
        ...doc.canvas.background,
        kind: doc.canvas.background.kind as "colour" | "image",
    } as Source) : undefined,
  };

  // TODO: Process Global Background into a CTClip if present
  // This would be a CTClip at track 0, spanning the entire timeline duration.

  // Process Blocks
  for (const block of doc.blocks) {
    blockCounter++;
    const blockId = block.id || `block_${blockCounter}`;

    const blockStartTime = block.at ?? currentTime;
    let calculatedBlockDuration = block.duration; // User specified duration for the block

    // If block duration is not specified, calculate it based on content.
    // PRD: "If omitted, defaults to audio length."
    // If no audio, then longest video. If neither, then what? (e.g. image/color only block) -> default 1s?
    if (calculatedBlockDuration === undefined) {
      let audioDuration = 0;
      let videoDuration = 0;

      if (block.audio) {
        const audioProbe = await probeSource(block.audio as Source);
        audioDuration = audioProbe.duration;
      }
      if (audioDuration > 0 && audioDuration !== Infinity) { // Check for Infinity
        calculatedBlockDuration = audioDuration;
      } else if (block.visuals && block.visuals.length > 0) {
        // If no audio, find the longest video source in this block
        for (const visualSource of block.visuals) {
          if (visualSource.kind === "video") {
            const videoProbe = await probeSource(visualSource as Source);
            if (videoProbe.duration !== Infinity && videoProbe.duration > videoDuration) { // Check for Infinity
              videoDuration = videoProbe.duration;
            }
          }
        }
        if (videoDuration > 0) {
          calculatedBlockDuration = videoDuration;
        } else {
          // No audio, no video, must be image/color only. Default duration for such a block.
          calculatedBlockDuration = 5; // Default to 5 seconds for static blocks
        }
      } else {
        // Block has no audio and no visuals (empty block?)
        calculatedBlockDuration = 1; // Default to 1 second for an empty block
      }
    }

    const blockEndTime = blockStartTime + calculatedBlockDuration;
    currentTime = block.at === undefined ? blockEndTime : currentTime; // Only advance sequential time if 'at' was not used

    // Create CTClips from block.visuals
    if (block.visuals) {
      // Use Promise.all to handle asynchronous probing of multiple visuals concurrently
      await Promise.all(block.visuals.map(async (visualSource, index) => {
        const visualProbe = await probeSource(visualSource as Source, calculatedBlockDuration);
        const clipDuration = (visualSource.kind === 'image' || visualSource.kind === 'colour')
                             ? calculatedBlockDuration // Static visuals fill the block duration
                             : Math.min(visualProbe.duration === Infinity ? calculatedBlockDuration : visualProbe.duration, calculatedBlockDuration); // Media is trimmed by block duration

        clips.push({
          id: `${blockId}_visual_${index}`,
          kind: visualSource.kind as CTClip['kind'],
          src: visualSource.src,
          track: index + 1, // Z-index within the block (1-based for visuals)
                           // Track 0 could be reserved for block-level background or global canvas background
          start: blockStartTime,
          end: blockStartTime + clipDuration, // Clip might be shorter than block if source is shorter
          duration: clipDuration,
          layerId: blockId,
          props: { // Apply defaults and overrides
            x: visualSource.x ?? 0,
            y: visualSource.y ?? 0,
            w: visualSource.w ?? visualProbe.width ?? canvas.w, // source -> probe -> canvas
            h: visualSource.h ?? visualProbe.height ?? canvas.h, // source -> probe -> canvas
            resize: visualSource.resize ?? "stretch",
            opacity: visualSource.opacity ?? 1.0,
            // specific props from visualSource
            ...visualSource
          },
          effects: (block.effects?.map(e => ({...e} as Effect))) || [],
          // Transitions will be resolved in a separate pass after all clips are generated
        });
      }));
    }

    // Create CTClip for block.audio
    if (block.audio) {
      const audioProbe = await probeSource(block.audio as Source, calculatedBlockDuration);
      const audioClipDuration = Math.min(audioProbe.duration === Infinity ? calculatedBlockDuration : audioProbe.duration, calculatedBlockDuration);

      clips.push({
        id: `${blockId}_audio`,
        kind: block.audio.kind as 'audio',
        src: block.audio.src,
        track: 0, // Audio doesn't use visual z-index; could be used for ordering if multiple audios in block
        start: blockStartTime,
        end: blockStartTime + audioClipDuration,
        duration: audioClipDuration,
        layerId: blockId,
        props: {
            opacity: block.audio.opacity ?? 1.0, // Though opacity on audio is unusual, schema allows
            ...block.audio
        },
        effects: (block.effects?.filter(e => e.kind === 'fade') // Only apply fade to audio? Or more generic?
                    .map(e => ({...e} as Effect))) || [],
      });
    }

    // TODO: Process block.subtitles (FR-303)
  }

  // TODO: Process doc.overlay into CTClips. These will need high track numbers
  // or a separate compositing pass. They span the entire timeline or specific durations.

  // TODO: Resolve Transitions (FR-304)
  // This pass would:
  // 1. Find `fromClip` and `toClip` (likely the last visual clip of a block and first of next).
  // 2. Adjust end/start times of these clips to accommodate the transition duration.
  // 3. Insert special `CTClip` objects of kind 'transition' or similar,
  //    or attach transition info to the existing clips.
  //    The PRD's `TransitionRenderer` interface suggests it gets `fromClip` and `toClip`.

  // Calculate overall timeline duration based on the maximum end time of all clips.
  // This needs to be re-evaluated after transitions are handled, as they might extend total duration.
  const timelineDuration = clips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.end), 0);
  if (doc.overlay && doc.overlay.length > 0) {
      // If global overlays exist and are meant to define total duration, adjust here.
      // This logic is simplified.
  }


  // Sort clips: primary by start time, secondary by track (z-index)
  clips.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.track - b.track; // Lower track numbers are "behind"
  });

  return {
    clips,
    duration: timelineDuration,
    canvas,
  };
}
