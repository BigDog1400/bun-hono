import { z } from 'zod';

// Primitives
const int = z.number().int();
const url = z.string().url();
const seconds = z.number().nonnegative();
const ResizeMode = z.enum(['cover', 'contain', 'stretch']);
const MediaKind = z.enum(['video', 'image', 'audio']);
const SubtitleEffect = z.enum(['none', 'outline', 'drop-shadow']);

// Source object
export const Source = z.object({
  id: z.string(),
  url: url,
  kind: MediaKind,
  duration: seconds.optional(),
  resizeMode: ResizeMode.optional().default('cover'),
  volume: int.min(0).max(100).optional().default(100),
  // metadata: z.record(z.any()).optional(), // Assuming metadata can be any structure
});

// SubtitleStyle object (placeholder as per instructions)
const SubtitleStyle = z.object({
  fontFamily: z.string().optional(),
  fontSize: int.optional(),
  color: z.string().optional(), // Assuming color is a string like '#RRGGBBAA' or 'red'
  backgroundColor: z.string().optional(),
  effect: SubtitleEffect.optional().default('none'),
  // More style properties can be added here
});

// SubtitleSpec object
const SubtitleSpec = z.object({
  id: z.string(),
  url: url,
  style: SubtitleStyle.optional(),
  start: seconds.optional().default(0),
  end: seconds.optional(),
});

// Block object
export const Block = z.object({
  id: z.string(),
  sourceId: z.string(),
  start: seconds.default(0),
  duration: seconds,
  // keyframes: z.record(z.any()).optional(), // Assuming keyframes can be complex
  subtitles: z.array(SubtitleSpec).optional(),
});

// Transition object
export const Transition = z.object({
  id: z.string(),
  type: z.string(), // Could be an enum if specific transition types are predefined
  duration: seconds,
  // params: z.record(z.any()).optional(), // Assuming params can be any structure
});

// LayoutDocument object (the main export)
export const LayoutDocument = z.object({
  version: z.literal('v1'),
  // metadata: z.record(z.any()).optional(),
  sources: z.array(Source),
  blocks: z.array(Block),
  transitions: z.array(Transition).optional(),
  // audioMix: z.record(z.any()).optional(), // Assuming audioMix can be complex
  // outputFormat: z.record(z.any()).optional(), // Assuming outputFormat can be complex
});

// Inferred type for LayoutV1
export type LayoutV1 = z.infer<typeof LayoutDocument>;
