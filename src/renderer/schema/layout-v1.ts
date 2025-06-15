import { z } from 'zod';

// Primitives from PRD Section 8.1
const int = z.number().int();
const float = z.number();
const seconds = z.number().nonnegative();
const percent = int.min(0).max(100); // Assuming percent is 0-100 integer
const literalId = z.string(); // "Literal ID string for identifying elements"
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color code"); // #RRGGBB
// For color names or rgba, z.string() might be more flexible, or a union.
// PRD says "hex or keyword". Let's use z.string() for src when kind is 'colour'.

// Enums from PRD Section 8.2
const MediaKind = z.enum(['video', 'image', 'audio', 'colour']);
const ResizeMode = z.enum(['fit', 'fill', 'stretch']); // PRD uses these values for 'resize'

// Source Object (PRD Section 8.3)
// "Defines a media source, which can be visual or audio."
const Source = z.object({
  id: literalId.optional().describe("Optional unique ID for this source instance"), // Making id optional as per PRD examples sometimes omitting it
  kind: MediaKind,
  src: z.string().describe("URL for media (video, image, audio), hex/keyword for colour"),
  // Visual properties (optional)
  x: percent.optional().describe("Horizontal position from left, in percent of canvas width"),
  y: percent.optional().describe("Vertical position from top, in percent of canvas height"),
  w: percent.optional().describe("Width, in percent of canvas width"),
  h: percent.optional().describe("Height, in percent of canvas height"),
  opacity: percent.optional().default(100).describe("Opacity in percent (0-100)"),
  resize: ResizeMode.optional().default('fill').describe("Resize mode for image/video"),
  // Audio properties (optional)
  volume: percent.optional().default(100).describe("Volume in percent (0-100)"),
  // Timings for source if it's part of a sequence within a block (not explicitly in PRD Source, but implied by block visuals/audio arrays)
  at: seconds.optional().describe("Start time in seconds, relative to parent block or global if in background/overlay"),
  duration: seconds.optional().describe("Duration in seconds"),
  // Added from previous schema, seems useful
  durationFromSource: z.boolean().optional().default(false).describe("If true, attempt to use source's intrinsic duration"),
}).strict("Unknown keys not allowed in Source");


// Block Object (PRD Section 8.4)
// "A container for media elements, defining a segment of the timeline."
const Block = z.object({
  id: literalId.describe("Unique ID for the block"),
  duration: seconds.optional().describe("Duration of the block in seconds. If omitted, may be inferred from content."),
  // Visual content (layers, bottom to top)
  visuals: z.array(Source).optional().describe("Visual layers, rendered in order (bottom to top)"),
  // Audio content (mixed)
  audio: z.array(Source).optional().describe("Audio tracks, mixed together"),
  // Effects are NOT part of LayoutV1 schema per PRD. Handled in Canonical Timeline / Renderer.
}).strict("Unknown keys not allowed in Block");


// Transition Object (PRD Section 8.5)
const Transition = z.object({
  id: literalId.describe("Unique ID for the transition"),
  type: z.string().describe("Type of transition (e.g., 'crossfade', 'wipe_left')"), // Plugin kind
  duration: seconds.describe("Duration of the transition in seconds"),
  between: z.tuple([literalId, literalId]).describe("Array of two block IDs [from_block_id, to_block_id]"),
  params: z.record(z.any()).optional().describe("Additional parameters for the transition type"),
}).strict("Unknown keys not allowed in Transition");

// Canvas Object (PRD Section 8.6)
const Canvas = z.object({
  w: int.positive().describe("Width of the canvas in pixels"),
  h: int.positive().describe("Height of the canvas in pixels"),
  fps: int.positive().describe("Frames per second for the output video"),
  background_color: z.string().optional().describe("Default background color for canvas (hex or keyword), overridden by 'background' source"),
}).strict("Unknown keys not allowed in Canvas");

// Metadata Object (PRD Section 8.7)
const Metadata = z.object({
  title: z.string().optional().describe("Title of the video project"),
  author: z.string().optional().describe("Author of the video project"),
  description: z.string().optional().describe("Description of the video project"),
  // "Any other relevant metadata as key-value pairs"
}).catchall(z.any());


// LayoutDocument Object (Main Schema - PRD Section 8)
export const LayoutDocument = z.object({
  spec: z.literal("layout/v1").describe("Specification version"),
  meta: Metadata.optional().describe("Metadata for the project"),
  canvas: Canvas.describe("Canvas properties"),
  // Global Layers
  background: Source.optional().describe("A single source defining the global background, below all blocks"),
  blocks: z.array(Block).describe("Timeline blocks, rendered in order unless 'at' times dictate otherwise"),
  overlay: Source.optional().describe("A single source defining a global overlay, above all blocks"),
  // Transitions between blocks
  transitions: z.array(Transition).optional().describe("Transitions between blocks"),
}).strict("Unknown keys not allowed in LayoutDocument");

// Inferred type for LayoutV1
export type LayoutV1 = z.infer<typeof LayoutDocument>;
// Export Source type if needed by CanonicalTimeline conversion (it was used before)
export type SourceV1 = z.infer<typeof Source>;
export type BlockV1 = z.infer<typeof Block>;
export type TransitionV1 = z.infer<typeof Transition>;

// --- Previous Schema (for reference before deletion/major refactor) ---
// (The old schema was significantly different and has been replaced by the PRD-aligned one above)
// const int_old = z.number().int();
// const url_old = z.string().url(); // Kept for Block.audio if it must be URL
// const seconds_old = z.number().nonnegative();
// const ResizeMode_old = z.enum(['cover', 'contain', 'stretch']);
// const MediaKind_old = z.enum(['video', 'image', 'audio']); // Missing 'colour'
// const SubtitleEffect_old = z.enum(['none', 'outline', 'drop-shadow']);

// const Source_old = z.object({
//   id: z.string(),
//   url: url_old, // Problematic for 'colour' kind
//   kind: MediaKind_old,
//   duration: seconds_old.optional(),
//   resizeMode: ResizeMode_old.optional().default('cover'),
//   volume: int_old.min(0).max(100).optional().default(100),
// });

// const SubtitleStyle_old = z.object({ /* ... */ });
// const SubtitleSpec_old = z.object({ /* ... */ });

// const Block_old = z.object({
//   id: z.string(),
//   sourceId: z.string(), // This was the simplified model
//   start: seconds_old.default(0),
//   duration: seconds_old,
//   subtitles: z.array(SubtitleSpec_old).optional(),
//   // Effects were here in one of the comments, but not in Zod
//   effects: z.array(z.object({ id: z.string(), kind: z.string(), params: z.any() })).optional(),
// });

// const Transition_old = z.object({ /* ... */ });

// export const LayoutDocument_old = z.object({
//   version: z.literal('v1'),
//   sources: z.array(Source_old), // Top-level sources array
//   blocks: z.array(Block_old),   // Simplified blocks
//   transitions: z.array(Transition_old).optional(),
//   // Missing canvas, meta, background, overlay from PRD
// });
// export type LayoutV1_old = z.infer<typeof LayoutDocument_old>;
