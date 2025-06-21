import { LayoutV1, SourceV1, BlockV1 } from '../schema/layout-v1';

// --- Internal Types ---
export interface CTSource extends SourceV1 {
  resolvedPath?: string;
  uniqueId: string; // Added for linking
}

export interface CTEffect {
  id: string;
  kind: string;
  params: any;
}

export interface CTTransition {
  id: string;
  type: string;
  duration: number;
  between: [string, string];
  params?: Record<string, any>;
}

export interface CTClip {
  id: string;
  sourceIdRef: string;

  kind: CTSource['kind'];
  src: string;

  absoluteStartTime: number;
  duration: number;

  zIndex: number;

  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  resizeMode?: 'fit' | 'fill' | 'stretch';
  volume?: number;
  effects?: CTEffect[];
}

export interface CanonicalTimeline {
  version: 'v1';
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  processedSources: CTSource[];
  clips: CTClip[];
  transitions?: CTTransition[];
  canvasBackgroundColor?: string;
}

// --- Default Values ---
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
 */
export async function convertToCanonicalTimeline(doc: LayoutV1): Promise<CanonicalTimeline> {
  const clips: CTClip[] = [];
  const processedSources: CTSource[] = [];
  let sourceCounter = 0;

  let currentTime = 0;

  const Z_BACKGROUND = 0;
  const Z_BLOCK_BASE = 100;
  const Z_OVERLAY_BASE = 10000;
  // let currentBlockGlobalZ = Z_BLOCK_BASE; // Not used in current z-index logic per block

  // 1. Process Canvas
  const canvasWidth = doc.canvas.w;
  const canvasHeight = doc.canvas.h;
  const fps = doc.canvas.fps;
  const canvasBackgroundColor = doc.canvas.background_color;

  // Helper to process a SourceV1 into a CTSource and add to processedSources
  const processAndRegisterSource = (sourceV1: SourceV1, contextId?: string): CTSource => {
    const sourceUniqueId = sourceV1.id || `gen_source_${contextId || ''}_${sourceCounter++}`;
    const ctSource: CTSource = {
      ...sourceV1,
      uniqueId: sourceUniqueId,
      resolvedPath: sourceV1.src,
    };
    processedSources.push(ctSource);
    return ctSource;
  };

  // 2. Process Background
  if (doc.background) {
    const bgSourceV1 = doc.background;
    const processedBgSource = processAndRegisterSource(bgSourceV1, "bg");

    let bgDuration = processedBgSource.duration ?? DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;

    const clip: CTClip = {
      id: `clip_bg_${processedBgSource.uniqueId}`,
      sourceIdRef: processedBgSource.uniqueId,
      kind: processedBgSource.kind,
      src: processedBgSource.src,
      absoluteStartTime: 0,
      duration: bgDuration,
      zIndex: Z_BACKGROUND,
      opacity: processedBgSource.opacity ?? 100,
      resizeMode: processedBgSource.resize ?? 'fill',
    };
    mapSourcePropsToClip(clip, processedBgSource);
    clips.push(clip);
  }

  // 3. Process Blocks
  let accumulatedBlockTime = 0;

  for (const [blockIndex, blockDef] of doc.blocks.entries()) {
    const blockStartTime = accumulatedBlockTime;
    let maxEndTimeInBlock = blockStartTime;
    let blockExplicitDuration = blockDef.duration;

    const processBlockSourceElements = (elements: SourceV1[] | undefined, kindPrefix: string, baseZ: number) => {
      if (!elements) return;
      elements.forEach((sourceElV1, elIndex) => {
        const processedElementSource = processAndRegisterSource(sourceElV1, `${blockDef.id}_${kindPrefix}_${elIndex}`);
        const elStartTime = processedElementSource.at ?? 0;
        let elDuration = processedElementSource.duration;

        if (elDuration === undefined || elDuration === null || elDuration <= 0) {
          if (processedElementSource.kind === 'video' || processedElementSource.kind === 'audio') {
            if (processedElementSource.durationFromSource && processedElementSource.duration && processedElementSource.duration > 0) {
                elDuration = processedElementSource.duration;
            } else {
              if (blockExplicitDuration && (blockExplicitDuration - elStartTime) > 0) {
                elDuration = blockExplicitDuration - elStartTime;
              } else {
                console.warn(`Element ${processedElementSource.uniqueId} in block ${blockDef.id} is ${processedElementSource.kind} but has no duration, and block has no explicit duration. Skipping.`);
                return;
              }
            }
          } else { // image or colour
            elDuration = (blockExplicitDuration && (blockExplicitDuration - elStartTime) > 0)
                         ? (blockExplicitDuration - elStartTime)
                         : DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
          }
        }

        if (elDuration <=0) {
            console.warn(`Element ${processedElementSource.uniqueId} in block ${blockDef.id} has invalid duration ${elDuration}. Skipping.`);
            return;
        }

        const clip: CTClip = {
          id: processedElementSource.id || `${blockDef.id}_${kindPrefix}_clip_${elIndex}`,
          sourceIdRef: processedElementSource.uniqueId,
          kind: processedElementSource.kind,
          src: processedElementSource.src,
          absoluteStartTime: blockStartTime + elStartTime,
          duration: elDuration,
          zIndex: baseZ + elIndex,
          opacity: processedElementSource.opacity ?? 100,
          resizeMode: processedElementSource.resize ?? (processedElementSource.kind === 'video' || processedElementSource.kind === 'image' ? 'fill' : undefined),
          volume: processedElementSource.volume ?? 100,
        };
        mapSourcePropsToClip(clip, processedElementSource);
        clips.push(clip);
        maxEndTimeInBlock = Math.max(maxEndTimeInBlock, clip.absoluteStartTime + clip.duration);
      });
    };

    processBlockSourceElements(blockDef.visuals, 'vis', Z_BLOCK_BASE + blockIndex * 10); // Adjusted base Z for blocks
    processBlockSourceElements(blockDef.audio, 'aud', 0);

    if (blockExplicitDuration !== undefined && blockExplicitDuration !== null && blockExplicitDuration > 0) {
        accumulatedBlockTime = blockStartTime + blockExplicitDuration;
    } else {
        blockExplicitDuration = maxEndTimeInBlock - blockStartTime;
        if (blockExplicitDuration <= 0) {
            if((blockDef.visuals && blockDef.visuals.length > 0) || (blockDef.audio && blockDef.audio.length > 0)) {
                 blockExplicitDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
                 console.warn(`Block ${blockDef.id} had no explicit duration and its content resulted in zero or negative duration. Applied default block duration: ${blockExplicitDuration}s.`);
            } else {
                blockExplicitDuration = 0;
            }
        }
        accumulatedBlockTime = blockStartTime + blockExplicitDuration;
    }
    currentTime = Math.max(currentTime, accumulatedBlockTime);
  }

  // 4. Process Overlay
  if (doc.overlay) {
    const overlaySourceV1 = doc.overlay;
    const processedOverlaySource = processAndRegisterSource(overlaySourceV1, "overlay");

    const overlayStartTime = processedOverlaySource.at ?? 0;
    let overlayDuration = processedOverlaySource.duration;
    if (overlayDuration === undefined || overlayDuration === null || overlayDuration <= 0) {
        if (processedOverlaySource.kind === 'video' || processedOverlaySource.kind === 'audio') {
            if (processedOverlaySource.durationFromSource && processedOverlaySource.duration && processedOverlaySource.duration > 0) {
                overlayDuration = processedOverlaySource.duration;
            } else {
                 console.warn(`Overlay element ${processedOverlaySource.uniqueId} is ${processedOverlaySource.kind} but has no valid duration. Applying default.`);
                 overlayDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
            }
        } else { // image or colour
            overlayDuration = DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT;
        }
    }

    const clip: CTClip = {
      id: `clip_overlay_${processedOverlaySource.uniqueId}`,
      sourceIdRef: processedOverlaySource.uniqueId,
      kind: processedOverlaySource.kind,
      src: processedOverlaySource.src,
      absoluteStartTime: overlayStartTime,
      duration: overlayDuration,
      zIndex: Z_OVERLAY_BASE,
      opacity: processedOverlaySource.opacity ?? 100,
      resizeMode: processedOverlaySource.resize ?? 'fill',
    };
    mapSourcePropsToClip(clip, processedOverlaySource);
    clips.push(clip);
    currentTime = Math.max(currentTime, clip.absoluteStartTime + clip.duration);
  }

  const bgClip = clips.find(c => c.zIndex === Z_BACKGROUND);
  if (bgClip) {
    const bgSourceDefinition = doc.background;
    if (bgSourceDefinition && bgSourceDefinition.duration === undefined) {
        bgClip.duration = currentTime;
    } else if (bgClip.duration === DEFAULT_BLOCK_DURATION_FOR_STATIC_CONTENT && bgSourceDefinition && bgSourceDefinition.duration === undefined) {
        // This case specifically updates if bgClip got the default static duration AND original doc.background had no duration.
        bgClip.duration = currentTime;
    }
  }

  clips.sort((a, b) => {
    if (a.absoluteStartTime !== b.absoluteStartTime) {
      return a.absoluteStartTime - b.absoluteStartTime;
    }
    return a.zIndex - b.zIndex;
  });

  const processedTransitions: CTTransition[] = doc.transitions
    ? doc.transitions.map(t => ({
        id: t.id,
        type: t.type,
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
    processedSources,
    clips,
    transitions: processedTransitions.length > 0 ? processedTransitions : undefined,
  };
}
