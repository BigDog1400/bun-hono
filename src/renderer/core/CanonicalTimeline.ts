// src/renderer/core/CanonicalTimeline.ts
import { LayoutDocumentSchema, LayoutV1, SourceSchema, BlockSchema, EffectSchema, TransitionSchema } from "../schema/layout-v1";
import type { CTClip as ICTClip, Source as ISource, Effect as IEffect, Transition as ITransition, RendererOptions } from "../types"; // Renaming imports to avoid naming conflict

// Re-exporting and potentially refining types from types/index.ts or defining them if not fully done there.
// For now, we rely on the definitions in types/index.ts and ensure they are compatible.
export type CTClip = ICTClip;
export type Source = ISource;
export type Effect = IEffect;
export type Transition = ITransition;


export interface CanonicalTimeline {
  clips: CTClip[];
  duration: number; // Overall duration of the timeline in seconds
  canvas: { // Resolved canvas properties
    w: number;
    h: number;
    fps: number;
    background?: Source; // Optional resolved global background
  };
  // Other global properties derived from LayoutV1 if needed
}

// Helper function to probe media duration (placeholder)
// In a real scenario, this would involve ffprobe or similar tools
async function probeMediaDuration(source: Source): Promise<number> {
  // Mock implementation
  if (source.kind === 'video' || source.kind === 'audio') {
    // Simulate probing, e.g., return a fixed duration or a duration based on src
    if (source.src.includes("short")) return 5;
    if (source.src.includes("long")) return 20;
    return 10; // Default mock duration
  }
  return Infinity; // Images, colours have "infinite" duration until constrained by a block
}


export async function convertToCanonicalTimeline(
  doc: LayoutV1,
  options: RendererOptions // Renderer options might influence conversion (e.g. default FPS)
): Promise<CanonicalTimeline> {
  // Validate the input document using the Zod schema's parse method
  // The `render` method in VideoRenderer should ideally pass already validated data.
  // If not, or for direct use:
  const validationResult = LayoutDocumentSchema.safeParse(doc);
  if (!validationResult.success) {
    // This error should ideally be caught and handled before calling this function.
    // Throwing here to indicate that valid data is expected.
    throw new Error(`Invalid LayoutDocument: ${validationResult.error.format()}`);
  }
  const validDoc = validationResult.data;

  const clips: CTClip[] = [];
  let currentTime = 0;
  let blockIdCounter = 0; // For generating internal IDs if blocks don't have them

  const canvas = {
      w: validDoc.canvas.w,
      h: validDoc.canvas.h,
      fps: validDoc.canvas.fps,
      background: validDoc.canvas.background ? ({
          ...validDoc.canvas.background,
          // Ensure kind is correctly typed if it's a discriminated union
          kind: validDoc.canvas.background.kind as "colour" | "image",
      } as Source) : undefined,
  };

  // Process global overlays first - they might affect timeline duration or rendering layers
  // For now, placeholder logic. These would become CTClips spanning the whole timeline or specific durations.
  if (validDoc.overlay) {
    for (const overlaySource of validDoc.overlay) {
      // Logic to determine duration and timing for global overlays
      // This is a simplification; true global overlays might need special handling
      // or a designated track / layer.
      // clips.push({ ... convert Source to CTClip ...});
    }
  }


  // Process Blocks
  for (const block of validDoc.blocks) {
    const blockId = block.id || `block_${blockIdCounter++}`;
    let blockStartTime = block.at ?? currentTime;
    let blockDuration = block.duration; // Can be undefined

    // Store sources associated with this block to determine duration
    const blockSources: Source[] = [];
    if (block.visuals) blockSources.push(...block.visuals as Source[]);
    if (block.audio) blockSources.push(block.audio as Source);

    // Determine block duration if not specified
    if (blockDuration === undefined) {
      let maxSourceDuration = 0;
      for (const src of blockSources) {
        const sourceDuration = await probeMediaDuration(src);
        if (sourceDuration !== Infinity && sourceDuration > maxSourceDuration) {
          maxSourceDuration = sourceDuration;
        }
      }
      blockDuration = maxSourceDuration > 0 ? maxSourceDuration : 10; // Default duration if no content dictates it (e.g. 10s for a color block)
                                                                    // The PRD implies default to audio length. This needs refinement.
    }

    currentTime = blockStartTime + blockDuration;

    // Create CTClips from block.visuals
    if (block.visuals) {
      block.visuals.forEach((visual, index) => {
        clips.push({
          id: `${blockId}_visual_${index}`,
          kind: visual.kind as CTClip['kind'], // Ensure type compatibility
          src: visual.src,
          track: index, // Simple z-indexing for now, PRD: "Arbitrary Z-index compositing"
          start: blockStartTime,
          end: blockStartTime + blockDuration!, // blockDuration is now defined
          duration: blockDuration!,
          layerId: blockId, // Group clips by block
          props: {
            ...visual, // Spread all properties from SourceSchema
            // Default x,y to 0,0 if not provided
            x: visual.x ?? 0,
            y: visual.y ?? 0,
            // w, h might need to default to canvas size or be derived if not set
            w: visual.w ?? (visual.kind === 'colour' ? canvas.w : undefined), // Colour default to canvas width
            h: visual.h ?? (visual.kind === 'colour' ? canvas.h : undefined), // Colour default to canvas height
          },
          effects: block.effects as Effect[] || [], // Add effects
          // Transitions will be handled in a separate pass or later stage
        });
      });
    }

    // Create CTClip for block.audio
    if (block.audio) {
      clips.push({
        id: `${blockId}_audio`,
        kind: block.audio.kind as 'audio',
        src: block.audio.src,
        track: 0, // Audio tracks might not use z-index in the same way
        start: blockStartTime,
        end: blockStartTime + blockDuration!,
        duration: blockDuration!,
        layerId: blockId,
        props: { ...block.audio },
        effects: [], // Audio effects could be added here
      });
    }

    // TODO: Process block.subtitles (FR-303)
    // This would involve creating CTClips for subtitles or adding subtitle info to relevant video clips.
  }

  // TODO: Process Transitions (FR-304)
  // This step would involve finding the CTClips corresponding to block IDs in `validDoc.transitions`
  // and potentially modifying existing clips or creating new ones to represent the transition.
  // For example, a transition might adjust the end time of the 'from' clip and start time of the 'to' clip,
  // or insert special transition clips.

  // Calculate overall timeline duration
  const timelineDuration = clips.reduce((maxEnd, clip) => Math.max(maxEnd, clip.end), 0);

  // Sort clips by start time, then by track (z-index) as per PRD:
  // "time-sorted, and layer-sorted list of CTClip objects"
  clips.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.track - b.track; // Lower track numbers are "behind" higher ones.
  });

  return {
    clips,
    duration: timelineDuration,
    canvas,
  };
}
