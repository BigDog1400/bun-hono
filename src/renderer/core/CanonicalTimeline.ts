import { LayoutV1, Source as ZodSource, Block as ZodBlock, Transition as ZodTransition } from '../schema/layout-v1';
// Define other Zod types if needed, e.g., for effects if they are part of LayoutV1 schema

// --- Internal Types ---

/**
 * Represents a source after processing (e.g., with resolved URLs, default values).
 * Aligns with ZodSource but might have additional runtime properties.
 */
export interface CTSource extends ZodSource {
  // Potentially add resolvedPath or other processed fields here
  resolvedPath?: string;
}

/**
 * Represents an effect with its parameters for internal use.
 * This might be simpler or more detailed than a Zod schema for effects
 * if one were defined. For now, it's a placeholder.
 */
export interface CTEffect {
  id: string;
  kind: string; // e.g., "fade", "blur", "transform"
  // Parameters specific to the effect kind
  params: any;
  // Example for a "fade" effect:
  // params: {
  //   type: "in" | "out";
  //   duration: number; // in seconds
  //   color?: string; // for fade to/from color (video only)
  // }
  // Example for a "blur" effect:
  // params: {
  //   intensity: number; // 0-100
  // }
}

/**
 * Represents a transition with its parameters for internal use.
 * 'kind' will come from ZodTransition.type
 * 'duration' will come from ZodTransition.duration
 */
export interface CTTransition extends Omit<ZodTransition, 'type'> {
  kind: string; // Standardized from ZodTransition.type
  // Optional specific params if not covered by ZodTransition's root
  params?: {
    // For crossfade, duration is top-level in ZodTransition.
    // If other transitions need more, e.g., wipe direction:
    // direction?: 'left' | 'right';
    [key: string]: any;
  };
}

/**
 * Core internal representation of an item on the timeline.
 */
export interface CTClip {
  id: string;
  sourceId: string; // Reference to the original source definition
  kind: 'video' | 'image' | 'audio' | 'color' | 'silent'; // Extended with 'color', 'silent'
  src: string; // Resolved source path, color value (e.g. '#RRGGBBAA'), or 'silent'

  absoluteStartTime: number; // in seconds
  duration: number; // in seconds

  zIndex: number; // for layering

  // Props for visual elements (video, image, color)
  // These could be part of a nested 'visualProps' object if preferred
  x?: number; // 0-1 relative to canvas width
  y?: number; // 0-1 relative to canvas height
  width?: number; // 0-1 relative to canvas width
  height?: number; // 0-1 relative to canvas height
  opacity?: number; // 0-1
  resizeMode?: 'cover' | 'contain' | 'stretch'; // from ZodSource

  // Props for audio elements
  volume?: number; // 0-100

  effects?: CTEffect[]; // Effects applied directly to this clip

  // For future use with transitions
  // transitionIn?: CTTransition;
  // transitionOut?: CTTransition;
}

/**
 * The canonical timeline representation.
 * Contains a flat list of clips, sorted by time and then layer.
 */
export interface CanonicalTimeline {
  version: 'v1';
  // Default canvas dimensions, can be overridden by output settings
  canvasWidth: number;
  canvasHeight: number;
  fps: number; // Frames per second from input or default

  sources: CTSource[]; // Processed sources
  clips: CTClip[];
  // Global effects or audio mixes could go here
  // transitions: CTTransition[]; // If transitions are global or between specific clip IDs
}


// --- Default Values ---
const DEFAULT_FPS = 30;
const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;
// const DEFAULT_IMAGE_DURATION = 5; // This was used if block.duration and source.duration for image were missing
// const DEFAULT_COLOR_DURATION = 5; // This was for color block without explicit duration
const DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT = 2; // Used if a block of image/colour has no duration.


/**
 * Converts a validated LayoutDocument (LayoutV1) into a CanonicalTimeline.
 * This involves resolving timings, Z-indexing, and creating a flat list of CTClip objects.
 *
 * @param doc The validated LayoutV1 document.
 * @returns A Promise resolving to the CanonicalTimeline object.
 */
export async function convertToCanonicalTimeline(doc: LayoutV1): Promise<CanonicalTimeline> {
  const clips: CTClip[] = [];
  let currentTime = 0; // Tracks time for sequential blocks
  let currentZIndex = 0; // Tracks z-index

  const processedSources = doc.sources.map(s => ({
    ...s,
    // In a real scenario, we might resolve URLs or probe media here
    resolvedPath: s.url,
  })) as CTSource[];

  const sourceMap = new Map(processedSources.map(s => [s.id, s]));

  // FR-202: Background Block (Implicit)
  // Assuming a default black background if no explicit background block is defined
  // For now, let's assume background is handled by explicit blocks or not at all
  // If a 'background' field existed on `doc`, it would be processed here with zIndex = 0.

  currentZIndex = 1; // Start actual content blocks above a potential background

  // Process main blocks (FR-201: Media Blocks)
  for (const block of doc.blocks) {
    const source = sourceMap.get(block.sourceId);
    if (!source) {
      console.warn(`Source ID ${block.sourceId} not found for block ${block.id}. Skipping.`);
      continue;
    }

    // Determine timing
    // FR-105: Timing Control (Absolute and Sequential)
    // This is a simplified interpretation. "at" is not in ZodBlock.
    // Assuming 'block.start' is the 'at' if present, else sequential.
    const blockStartTime = block.start; // Using the 'start' from ZodBlock directly

    // Duration: FR-106 (Explicit), FR-107 (Implicit from Video/Audio)
    // For now, use explicit duration or source duration for media, or a default for images/colors.
    // This logic processes the simplified Block structure {id, sourceId, start, duration}
    // It does not yet process the PRD LayoutV1 structure with blocks[].visuals[] etc.

    let clipDuration: number | undefined = block.duration; // Explicit duration from the block definition

    if (clipDuration === undefined || clipDuration === null || clipDuration <= 0) {
      // Block duration is not specified or invalid, try to infer or use default
      if (source.kind === 'video' || source.kind === 'audio') {
        if (source.duration !== undefined && source.duration !== null && source.duration > 0) {
          clipDuration = source.duration;
        } else {
          // If block duration was explicitly invalid (e.g. 0 or negative), it's already caught by the outer if.
          // This path is for when block.duration was undefined/null.
          console.warn(`Block ${block.id} (source ${source.id}, kind ${source.kind}) has no explicit duration, and its media source also lacks a valid duration. Skipping.`);
          continue;
        }
      } else if (source.kind === 'image' || source.kind === 'colour') {
        // For images/colors, if block has no duration (or was invalid and thus reset to undefined by clipDuration init), apply a default.
        // source.duration for image/color is often Infinity or not set, so not useful here for block duration.
        const oldBlockDuration = block.duration; // Keep to check if it was explicitly invalid
        clipDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
        if (oldBlockDuration !== undefined && oldBlockDuration !== null && oldBlockDuration <=0) {
            console.warn(`Block ${block.id} (source ${source.id}, kind ${source.kind}) had invalid explicit duration ${oldBlockDuration}. Using default: ${clipDuration}s.`);
        } else {
            // console.log(`Block ${block.id} (source ${source.id}, kind ${source.kind}) has no explicit duration. Using default: ${clipDuration}s.`);
        }
      }
    }

    // Final check for any unresolved duration issues
    if (clipDuration === undefined || clipDuration === null || clipDuration <=0) {
        console.warn(`Skipping block ${block.id} (source ${source.id}, kind ${source.kind}) due to unresolved zero or invalid duration: ${clipDuration}.`);
        continue;
    }


    // Create CTClip
    const clip: CTClip = {
      id: block.id, // Or generate a new unique ID for the clip itself: `clip-${block.id}-${source.id}`
      sourceId: source.id,
      kind: source.kind as CTClip['kind'], // Assuming ZodSource.kind matches CTClip.kind
      src: source.resolvedPath!, // Assuming resolvedPath is set
      absoluteStartTime: blockStartTime,
      duration: clipDuration,
      zIndex: currentZIndex, // Each block gets its own z-index layer for now
      // FR-102: Visual Properties (Position, Size, Opacity)
      // These would come from block.properties or similar in a more complete schema
      // For now, using defaults or placeholders.
      x: 0, // block.x or default
      y: 0, // block.y or default
      width: 1, // block.width or default
      height: 1, // block.height or default
      opacity: 1, // block.opacity or default
      resizeMode: source.resizeMode || 'cover',
      volume: source.volume,
      effects: [], // Placeholder for effects processing (FR-301, FR-302)
    };
    clips.push(clip);

    // For purely sequential blocks (if `block.start` was relative or based on previous)
    // currentTime = blockStartTime + clipDuration;

    currentZIndex++; // Increment z-index for the next block
  }

  // FR-204: Overlay Elements (Implicitly higher Z-index)
  // If `doc.overlay` existed (e.g., an array of overlay blocks), process them here.
  // They would get `zIndex` values higher than the main blocks.
  // Example:
  // let overlayZIndex = currentZIndex + 100; // Ensure overlay is on top
  // for (const overlayItem of doc.overlay || []) { ... }

  // Sort clips: primary by absoluteStartTime, secondary by zIndex
  clips.sort((a, b) => {
    if (a.absoluteStartTime !== b.absoluteStartTime) {
      return a.absoluteStartTime - b.absoluteStartTime;
    }
    return a.zIndex - b.zIndex;
  });

  // FR-304: Transitions would be processed here or identified for the VideoRenderer.
  // This might involve creating special transition clips or modifying existing clips.
  // The `doc.transitions` array would be used.
  const processedTransitions: CTTransition[] = doc.transitions
    ? doc.transitions.map(t => ({
        ...t,
        kind: t.type, // Map Zod's 'type' to internal 'kind'
        // params: t.params || {} // Ensure params object exists if we add specific params
      }))
    : [];

  return {
    version: 'v1',
    canvasWidth: DEFAULT_CANVAS_WIDTH, // These could come from doc.metadata or doc.outputFormat
    canvasHeight: DEFAULT_CANVAS_HEIGHT,
    fps: DEFAULT_FPS,
    sources: processedSources,
    clips: clips,
    // transitions: processedTransitions, // If they are stored globally
  };
}
