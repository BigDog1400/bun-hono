import { LayoutV1, SourceV1, BlockV1 } from '../schema/layout-v1';
// Note: CTTransition is defined here but not used in this refactor of convertToCanonicalTimeline

// --- Internal Types (CT interfaces remain the same) ---
export interface CTSource extends SourceV1 { // CTSource now directly extends Zod's SourceV1
  resolvedPath?: string; // Keep this for potential future path resolution logic
  // Inherits id?, kind, src, x?, y?, w?, h?, opacity?, resize?, volume?, at?, duration?, durationFromSource?
}

export interface CTEffect { // As defined before
  id: string;
  kind: string;
  params: any;
}

export interface CTTransition extends Omit<LayoutV1['transitions'][0], 'type' | 'between'> { // Assuming transitions array is not empty
  kind: string;
  // between: [string, string]; // block IDs. This was in CTTransition before.
                               // For now, let's assume CTTransition passed to plugins will have this.
                               // But convertToCanonicalTimeline's output `timeline.transitions` might just store them as is.
  // For this refactor, we are not deeply processing transitions into CTClips,
  // so CTTransition can be simpler or just align with ZodTransition directly for what's stored on CanonicalTimeline.
  // Let's align it with ZodTransition for now.
  id: string;
  type: string; // from Zod
  duration: number; // from Zod
  between: [string, string]; // from Zod
  params?: Record<string, any>; // from Zod
}


export interface CTClip {
  id: string;
  sourceIdRef?: string; // Optional reference to the original SourceV1's 'id' if it had one

  kind: CTSource['kind']; // 'video' | 'image' | 'audio' | 'colour'
  src: string; // Resolved source path, color value, or 'silent'

  absoluteStartTime: number; // in seconds
  duration: number; // in seconds

  zIndex: number; // for layering

  // Visual props
  x?: number; // 0-100 percent of canvas width
  y?: number; // 0-100 percent of canvas height
  width?: number; // 0-100 percent of canvas width
  height?: number; // 0-100 percent of canvas height
  opacity?: number; // 0-100 percent
  resizeMode?: 'fit' | 'fill' | 'stretch';

  // Audio props
  volume?: number; // 0-100 percent

  effects?: CTEffect[];
  // No transition fields on CTClip directly for now. Transitions are separate.
}

export interface CanonicalTimeline {
  version: 'v1';
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  // Sources are now part of clips directly, or resolved by renderer.
  // No global 'processedSources' list on CanonicalTimeline itself needed for now.
  // The renderer can maintain its own map if needed.
  clips: CTClip[];
  transitions?: CTTransition[]; // Store processed transitions
  // Default canvas background color from LayoutV1.canvas.background_color
  canvasBackgroundColor?: string;
}

// --- Default Values ---
const DEFAULT_FPS = 30;
const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;
const DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT = 2; // Used if a block/source of image/colour has no duration.

// Helper to map SourceV1 props to CTClip props
function mapSourcePropsToClip(clipProps: Partial<CTClip>, source: SourceV1): void {
  if (source.x !== undefined) clipProps.x = source.x;
  if (source.y !== undefined) clipProps.y = source.y;
  if (source.w !== undefined) clipProps.width = source.w;
  if (source.h !== undefined) clipProps.height = source.h;
  if (source.opacity !== undefined) clipProps.opacity = source.opacity;
  if (source.resize !== undefined) clipProps.resizeMode = source.resize;
  if (source.volume !== undefined) clipProps.volume = source.volume;
}


/**
 * Converts a validated LayoutDocument (LayoutV1 from PRD) into a CanonicalTimeline.
 * This involves resolving timings, Z-indexing, and creating a flat list of CTClip objects.
 *
 * @param doc The validated LayoutV1 document.
 * @returns A Promise resolving to the CanonicalTimeline object.
 */
export async function convertToCanonicalTimeline(doc: LayoutV1): Promise<CanonicalTimeline> {
  const clips: CTClip[] = [];
  let currentTime = 0; // Tracks end time of the last processed block for sequential timing

  // Z-index categories
  const Z_BACKGROUND = 0;
  const Z_BLOCK_BASE = 100; // Base for first block's content
  const Z_OVERLAY_BASE = 10000; // Base for overlay content

  let currentBlockGlobalZ = Z_BLOCK_BASE;


  // 1. Process Canvas
  const canvasWidth = doc.canvas.w;
  const canvasHeight = doc.canvas.h;
  const fps = doc.canvas.fps;
  const canvasBackgroundColor = doc.canvas.background_color;

  // 2. Process Background
  if (doc.background) {
    const bgSource = doc.background;
    const bgDuration = bgSource.duration ?? DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT; // Needs better calculation
    // For now, background duration needs to be specified or it's default.
    // Ideally, it spans the whole timeline duration, which needs to be pre-calculated or dynamically set.
    // Let's make a simple assumption: if blocks exist, it's total block time, else a default.
    // This duration calculation for background is still a placeholder.

    const clip: CTClip = {
      id: bgSource.id || `background_global_${Date.now()}`,
      sourceIdRef: bgSource.id,
      kind: bgSource.kind,
      src: bgSource.src, // Assuming src is already resolved for colors, or path for media
      absoluteStartTime: 0,
      duration: bgDuration, // Placeholder: this needs to be the total timeline duration
      zIndex: Z_BACKGROUND,
      opacity: bgSource.opacity ?? 100, // Default to 100 if not set
      resizeMode: bgSource.resize ?? 'fill', // Default resize mode
    };
    mapSourcePropsToClip(clip, bgSource); // Map x,y,w,h etc.
    clips.push(clip);
  }

  // 3. Process Blocks
  let accumulatedBlockTime = 0; // For sequential block placement if block.at is not used

  for (const [blockIndex, blockDef] of doc.blocks.entries()) {
    // Determine block start time: PRD doesn't specify 'at' for blocks, implies sequential.
    // We'll use accumulated time.
    const blockStartTime = accumulatedBlockTime;
    let maxEndTimeInBlock = blockStartTime;

    // Determine block duration:
    // If blockDef.duration is set, use it.
    // Otherwise, it's the time from blockStartTime to the end of the latest finishing visual or audio element within it.
    let blockExplicitDuration = blockDef.duration;

    const processSourceElements = (elements: SourceV1[] | undefined, kindPrefix: string, baseZ: number) => {
      if (!elements) return;
      elements.forEach((sourceEl, elIndex) => {
        const elStartTime = sourceEl.at ?? 0; // 'at' is relative to blockStartTime
        let elDuration = sourceEl.duration;

        if (!elDuration) { // If sourceEl.duration is undefined, null, or 0
          if (sourceEl.kind === 'video' || sourceEl.kind === 'audio') {
            if (sourceEl.durationFromSource && sourceEl.duration) { // Assuming source.duration was pre-filled by a probe if durationFromSource
                elDuration = sourceEl.duration;
            } else {
              // If block has explicit duration, element can inherit it if it's shorter
              // Otherwise, for video/audio without duration, it's problematic without probing.
              // For now, if element is video/audio and has no duration, and block has no duration, it's an issue.
              // If block has duration, element can take that.
              if (blockExplicitDuration && (blockExplicitDuration - elStartTime) > 0) {
                elDuration = blockExplicitDuration - elStartTime; // Element fills remaining block time from its start
              } else {
                console.warn(`Element ${sourceEl.id || (kindPrefix+elIndex)} in block ${blockDef.id} is ${sourceEl.kind} but has no duration, and block has no explicit duration. Skipping.`);
                return; // Skips this source element
              }
            }
          } else { // image or colour
            // If block has explicit duration, element can take that (minus its own start time 'at').
            // Otherwise, it should take DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT.
            elDuration = (blockExplicitDuration && (blockExplicitDuration - elStartTime) > 0)
                         ? (blockExplicitDuration - elStartTime)
                         : DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
          }
        }

        if (elDuration <=0) { // Check after attempting to set/default
            console.warn(`Element ${sourceEl.id || (kindPrefix+elIndex)} in block ${blockDef.id} has invalid duration ${elDuration}. Skipping.`);
            return;
        }

        const clip: CTClip = {
          id: sourceEl.id || `${blockDef.id}_${kindPrefix}_${elIndex}`,
          sourceIdRef: sourceEl.id,
          kind: sourceEl.kind,
          src: sourceEl.src,
          absoluteStartTime: blockStartTime + elStartTime,
          duration: elDuration,
          // Layering within block: visuals use elIndex, audio doesn't usually have zIndex.
          // Add block's base Z + visual index.
          zIndex: baseZ + elIndex,
          opacity: sourceEl.opacity ?? 100,
          resizeMode: sourceEl.resize ?? (sourceEl.kind === 'video' || sourceEl.kind === 'image' ? 'fill' : undefined),
          volume: sourceEl.volume ?? 100,
        };
        mapSourcePropsToClip(clip, sourceEl);
        clips.push(clip);
        maxEndTimeInBlock = Math.max(maxEndTimeInBlock, clip.absoluteStartTime + clip.duration);
      });
    };

    // Process visuals for the current block
    processSourceElements(blockDef.visuals, 'vis', currentBlockGlobalZ + blockIndex * 10); // Increment Z for each block
    // Process audio for the current block
    processSourceElements(blockDef.audio, 'aud', 0); // Audio zIndex typically not used for visual layering output

    if (blockExplicitDuration !== undefined && blockExplicitDuration !== null) {
        accumulatedBlockTime = blockStartTime + blockExplicitDuration;
    } else {
        // If block duration was not explicit, it's now determined by its content
        blockExplicitDuration = maxEndTimeInBlock - blockStartTime;
        if (blockExplicitDuration <= 0 && (blockDef.visuals?.length || blockDef.audio?.length)) {
            // This block had content definitions, but they resulted in no positive duration for the block.
            // This could happen if all elements were skipped or had zero duration.
            if((blockDef.visuals && blockDef.visuals.length > 0) || (blockDef.audio && blockDef.audio.length > 0)) {
                 blockExplicitDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT; // Fallback for blocks with content that failed to get duration
                 console.warn(`Block ${blockDef.id} had no explicit duration and its content resulted in zero or negative duration. Applied default block duration: ${blockExplicitDuration}s.`);
            } else {
                blockExplicitDuration = 0; // Truly empty block (no visual/audio defs)
            }
        }
        accumulatedBlockTime = blockStartTime + blockExplicitDuration;
    }
    currentTime = Math.max(currentTime, accumulatedBlockTime); // Update overall timeline current time
  }


  // 4. Process Overlay
  if (doc.overlay) {
    const overlaySource = doc.overlay;
    // Overlay 'at' is global. Duration from source or default.
    const overlayStartTime = overlaySource.at ?? 0;
    const overlayDuration = overlaySource.duration ?? DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
    // As with background, overlay duration might ideally span timeline or be explicitly set.

    const clip: CTClip = {
      id: overlaySource.id || `overlay_global_${Date.now()}`,
      sourceIdRef: overlaySource.id,
      kind: overlaySource.kind,
      src: overlaySource.src,
      absoluteStartTime: overlayStartTime,
      duration: overlayDuration,
      zIndex: Z_OVERLAY_BASE, // Simple single overlay zIndex for now
      opacity: overlaySource.opacity ?? 100,
      resizeMode: overlaySource.resize ?? 'fill',
    };
    mapSourcePropsToClip(clip, overlaySource);
    clips.push(clip);
    currentTime = Math.max(currentTime, clip.absoluteStartTime + clip.duration);
  }

  // Update background duration to match total timeline duration if it was default/placeholder
  const bgClip = clips.find(c => c.zIndex === Z_BACKGROUND);
  if (bgClip && bgClip.duration === DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT) {
    // Only update if it used the placeholder and wasn't explicitly set via source.duration
    // This check might be too simple if doc.background.duration was exactly DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT
    // A better way: mark if duration was defaulted. For now, this is an approximation.
    if (doc.background && doc.background.duration === undefined) {
        bgClip.duration = currentTime; // currentTime is now the max end time of all content
    }
  }


  // 5. Sort Clips
  clips.sort((a, b) => {
    if (a.absoluteStartTime !== b.absoluteStartTime) {
      return a.absoluteStartTime - b.absoluteStartTime;
    }
    return a.zIndex - b.zIndex;
  });

  // 6. Process Transitions (just store them for now)
  const processedTransitions: CTTransition[] = doc.transitions
    ? doc.transitions.map(t => ({
        id: t.id,
        type: t.type, // This is the 'kind' for the plugin system
        duration: t.duration,
        between: t.between,
        params: t.params,
      }))
    : [];


  return {
    version: 'v1',
    canvasWidth,
    canvasHeight,
    fps,
    canvasBackgroundColor,
    clips,
    transitions: processedTransitions.length > 0 ? processedTransitions : undefined,
  };
}


// --- Previous Simplified convertToCanonicalTimeline (for reference during transition) ---
// This was the version before the major refactor to support full LayoutV1
/*
export async function convertToCanonicalTimeline_OLD(doc: LayoutV1_old_structure): Promise<CanonicalTimeline> {
  const clips: CTClip[] = [];
  let currentTime = 0;
  let currentZIndex = 0;

  // This assumes doc.sources is a top-level array, which is not per PRD LayoutV1
  const processedSources = doc.sources.map(s => ({
    ...s,
    resolvedPath: s.url,
  })) as CTSource[];
  const sourceMap = new Map(processedSources.map(s => [s.id, s]));

  currentZIndex = 1;

  for (const block of doc.blocks) { // This 'block' is the simplified { sourceId, start, duration }
    const source = sourceMap.get(block.sourceId);
    if (!source) {
      console.warn(`Source ID ${block.sourceId} not found for block ${block.id}. Skipping.`);
      continue;
    }
    const blockStartTime = block.start;
    let clipDuration: number | undefined = block.duration;

    if (clipDuration === undefined || clipDuration === null || clipDuration <= 0) {
      if (source.kind === 'video' || source.kind === 'audio') {
        if (source.duration !== undefined && source.duration !== null && source.duration > 0) {
          clipDuration = source.duration;
        } else {
          console.warn(`Block ${block.id} (source ${source.id}, kind ${source.kind}) has no explicit duration, and its media source also lacks a valid duration. Skipping.`);
          continue;
        }
      } else if (source.kind === 'image' || source.kind === 'colour') {
        const oldBlockDuration = block.duration;
        clipDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
        if (oldBlockDuration !== undefined && oldBlockDuration !== null && oldBlockDuration <=0) {
            console.warn(`Block ${block.id} (source ${source.id}, kind ${source.kind}) had invalid explicit duration ${oldBlockDuration}. Using default: ${clipDuration}s.`);
        }
      }
    }

    if (clipDuration === undefined || clipDuration === null || clipDuration <=0) {
        console.warn(`Skipping block ${block.id} (source ${source.id}, kind ${source.kind}) due to unresolved zero or invalid duration: ${clipDuration}.`);
        continue;
    }

    const clip: CTClip = {
      id: block.id,
      sourceIdRef: source.id,
      kind: source.kind as CTClip['kind'],
      src: source.resolvedPath!,
      absoluteStartTime: blockStartTime,
      duration: clipDuration,
      zIndex: currentZIndex,
      x: (block as any).x !== undefined ? (block as any).x * 100 : 0, // Assuming props might be on block
      y: (block as any).y !== undefined ? (block as any).y * 100 : 0,
      width: (block as any).width !== undefined ? (block as any).width * 100 : 100,
      height: (block as any).height !== undefined ? (block as any).height * 100 : 100,
      opacity: (block as any).opacity !== undefined ? (block as any).opacity * 100 : 100,
      resizeMode: source.resizeMode || 'cover',
      volume: source.volume,
      effects: (block as any).effects || [],
    };
    clips.push(clip);
    currentZIndex++;
  }

  clips.sort((a, b) => {
    if (a.absoluteStartTime !== b.absoluteStartTime) {
      return a.absoluteStartTime - b.absoluteStartTime;
    }
    return a.zIndex - b.zIndex;
  });

  const processedTransitionsOld: CTTransition[] = (doc.transitions || []).map(t => ({
    id: t.id,
    type: t.type,
    duration: t.duration,
    // Assuming 'between' was correctly on the old ZodTransition
    between: (t as any).between || ["",""], // Placeholder if not present
    params: (t as any).params,
  }));

  return {
    version: 'v1',
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    canvasHeight: DEFAULT_CANVAS_HEIGHT,
    fps: DEFAULT_FPS,
    clips: clips,
    transitions: processedTransitionsOld.length > 0 ? processedTransitionsOld : undefined,
  };
}
*/
