// src/renderer/schema/layout-v1.ts
import { z } from "zod";

const int = (label: string) =>
  z.number({ required_error: `${label} is required.` })
   .int({ message: `${label} must be an integer.` })
   .nonnegative({ message: `${label} must be non-negative.` })
   .describe(label);

const url = (label: string) =>
  z.string({ required_error: `${label} is required.` })
   .url({ message: `${label} must be a valid HTTP/S, S3, or data URI.` })
   .describe(label);

const seconds = (label: string) =>
  z.number({ required_error: `${label} is required.` })
   .nonnegative({ message: `${label} must be a non-negative number of seconds.` })
   .describe(label);

const ResizeMode = z.enum(["fit", "fill", "stretch"], {
  errorMap: (issue, ctx) => ({ message: `Invalid resize mode. Expected 'fit', 'fill', or 'stretch'.` })
});

const MediaKind = z.enum(["video", "image", "audio", "colour"], {
  errorMap: (issue, ctx) => ({ message: `Invalid media kind. Expected 'video', 'image', 'audio', or 'colour'.` })
});

const SubtitleEffect = z.enum(["classic", "progressive"], {
  errorMap: (issue, ctx) => ({ message: `Invalid subtitle effect. Expected 'classic' or 'progressive'.` })
});

export const SourceSchema = z.object({
    kind: MediaKind,
    src: z.string({ required_error: "Source src is required." })
         .describe("URL for media (video, image, audio), hex color string or color keyword for 'colour' kind."),
    x: z.number().optional().describe("Horizontal position from left in pixels."),
    y: z.number().optional().describe("Vertical position from top in pixels."),
    w: z.number().optional().describe("Width in pixels. If not provided, derived from media or canvas."),
    h: z.number().optional().describe("Height in pixels. If not provided, derived from media or canvas."),
    resize: ResizeMode.optional().describe("How to fit the media into specified w/h dimensions."),
    opacity: z.number().min(0, "Opacity must be between 0 and 1.")
                      .max(1, "Opacity must be between 0 and 1.")
                      .optional()
                      .describe("Opacity from 0 (transparent) to 1 (opaque)."),
}).strict("Unknown properties found in Source object.");

// Placeholder for SubtitleStyle, as it's mentioned as "defined previously" but not detailed in this PRD.
// For now, allow any object, but this should be defined if subtitle styling is implemented.
export const SubtitleStyleSchema = z.object({
    font: z.string().optional(),
    fontSize: z.number().optional(),
    color: z.string().optional(),
    // Add other style properties as needed
}).strict("Unknown properties found in SubtitleStyle object.").describe("Styling for subtitles.").optional();


export const SubtitleSpecSchema = z.object({
    auto: z.boolean({ required_error: "SubtitleSpec 'auto' is required." })
            .describe("If true, attempt to auto-transcribe audio from the block."),
    src: url("Subtitle src").optional().describe("URL to a subtitle file (e.g., .srt, .vtt). 'auto' must be false if src is provided."),
    effect: SubtitleEffect.default("classic").optional(),
    style: SubtitleStyleSchema,
}).strict("Unknown properties found in SubtitleSpec object.")
  .refine(data => !(data.auto && data.src), {
    message: "If 'auto' is true, 'src' for subtitles should not be provided.",
    path: ["src"],
  })
  .refine(data => !(!data.auto && !data.src), {
    message: "Either 'auto' must be true or a 'src' URL for subtitles must be provided.",
    path: ["auto"],
  });


export const EffectSchema = z.object({
    kind: z.literal("fade").describe("The type of effect, e.g., 'fade'"), // Initially only 'fade'
    // Fade-specific properties
    type: z.enum(["in", "out"]).optional().describe("Fade direction: 'in' or 'out'."),
    duration: seconds("Effect duration").optional().describe("Duration of the fade effect in seconds."),
}).strict("Unknown properties found in Effect object.");

export const BlockSchema = z.object({
    id: z.string().optional().describe("Optional unique ID for this block, used for transitions."),
    visuals: z.array(SourceSchema).optional().describe("Visual elements in this block (images, videos, colours)."),
    audio: SourceSchema.refine(s => s.kind === "audio", {message: "Block 'audio' source must be of kind 'audio'."}).optional().describe("Audio source for this block."),
    at: seconds("Block 'at' time").optional().describe("Absolute start time in seconds. If omitted, starts after the previous block or at t=0 for the first block."),
    duration: seconds("Block duration").optional().describe("Duration of the block in seconds. If omitted, attempts to infer from content (e.g., audio length, video length)."),
    subtitles: SubtitleSpecSchema.optional(),
    effects: z.array(EffectSchema).optional().describe("Effects to apply to this block."),
}).strict("Unknown properties found in Block object.");

export const TransitionSchema = z.object({
    between: z.tuple([
        z.string({ required_error: "First block ID for transition is required." }),
        z.string({ required_error: "Second block ID for transition is required." })
    ]).describe("Array of two block IDs to transition between. The first ID is the outgoing block, the second is the incoming block."),
    kind: z.literal("crossfade").describe("The transition effect to apply. Currently only 'crossfade' is supported."),
    duration: seconds("Transition duration"),
}).strict("Unknown properties found in Transition object.");

export const LayoutDocumentSchema = z.object({
    spec: z.literal("layout/v1").describe("Schema version identifier."),
    canvas: z.object({
        w: int("Canvas width"),
        h: int("Canvas height"),
        fps: int("Canvas fps").default(30),
        background: SourceSchema.refine(s => s.kind === "colour" || s.kind === "image", {message: "Canvas background source must be of kind 'colour' or 'image'."}).optional().describe("Global background color or image for the entire video."),
    }).strict("Unknown properties found in Canvas object."),
    // `background` in PRD was moved into `canvas.background` for clarity, PRD also has `overlay`
    // Assuming `overlay` are global layers on top of everything
    overlay: z.array(SourceSchema).optional().describe("Global overlay elements, rendered on top of all blocks."),
    blocks: z.array(BlockSchema).min(1, "At least one block is required in the layout."),
    transitions: z.array(TransitionSchema).optional(),
}).strict("Unknown properties found in LayoutDocument object.");

export type LayoutV1 = z.infer<typeof LayoutDocumentSchema>;

// Helper to provide more detailed error messages from Zod
export const validateLayoutV1 = (data: unknown): { success: true; data: LayoutV1 } | { success: false; error: z.ZodError<LayoutV1> } => {
  const result = LayoutDocumentSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
};
