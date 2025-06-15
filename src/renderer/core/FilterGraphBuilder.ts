// src/renderer/core/FilterGraphBuilder.ts
import type { RendererOptions, CTClip } from "../types"; // CTClip is now imported from types
// import type { CanonicalTimeline } from "./CanonicalTimeline"; // Assuming these types will be defined here - This will be uncommented later
import { LayoutV1 } from "../schema/layout-v1"; // To access canvas dimensions

// Placeholder for CanonicalTimeline, assuming it will be in a separate file
// and structured appropriately. For now, using 'any' to avoid TS errors.
// This will be replaced once CanonicalTimeline.ts is implemented.
export interface CanonicalTimeline {
  clips: CTClip[];
  // other properties like global duration, etc.
}

export class FilterGraphBuilder {
  private inputCount: number = 0;
  private complexFilterParts: string[] = [];
  private streamCounter: { [key: string]: number } = { v: 0, a: 0, s: 0 }; // video, audio, subtitle streams from filters
  private outputStreamLabels: { video?: string; audio?: string } = {};
  private inputs: string[] = []; // To store -i flags

  constructor(
    private timeline: CanonicalTimeline, // This will be the fully resolved timeline
    private options: RendererOptions,
    private layout: LayoutV1 // Pass the original layout for global settings like canvas
  ) {
    // Initialize with canvas dimensions if available
    // This might be used to set up initial scale filters or background
    // For now, just storing them.
  }

  // Method to add an input file (e.g., -i video.mp4)
  public addInput(filePath: string): number {
    this.inputs.push(`-i "${filePath}"`); // Basic sanitization: ensure paths with spaces are quoted. More robust sanitization needed for user inputs.
    return this.inputCount++; // Return the index of this input
  }

  // Get the current count of inputs, useful for plugins to know their input index
  public getInputCount(): number {
    return this.inputCount;
  }

  // Method to add a filter segment to the complex filter graph
  public addFilter(filterString: string): void {
    this.complexFilterParts.push(filterString);
  }

  // Generates a unique stream label (e.g., [v_out1], [a_mix2])
  public getUniqueStreamLabel(prefix: 'v' | 'a' | 's' = 's'): string {
    this.streamCounter[prefix]++;
    return `[${prefix}_${this.streamCounter[prefix]}]`;
  }

  // Sets the final output stream labels that will be mapped
  public setOutputStreams(videoLabel?: string, audioLabel?: string): void {
    if (videoLabel) this.outputStreamLabels.video = videoLabel;
    if (audioLabel) this.outputStreamLabels.audio = audioLabel;
  }

  // Builds the final FFmpeg command arguments
  public build(): { inputs: string[], complexFilter: string, maps: string[] } {
    if (this.complexFilterParts.length === 0 && (!this.outputStreamLabels.video && !this.outputStreamLabels.audio)) {
      // If there's no complex filter and no explicit output streams from plugins,
      // we might be dealing with a very simple case (e.g. just one input video to output).
      // This needs to be handled by ensuring plugins always set an output stream,
      // or by adding logic here to map the last input directly if no filters.
      // For now, let's assume plugins will call setOutputStreams.
    }

    const complexFilter = this.complexFilterParts.join('; ');
    const maps: string[] = [];

    if (this.outputStreamLabels.video) {
      maps.push(`-map "${this.outputStreamLabels.video}"`);
    } else {
      // Potentially map the last video input if no explicit video output and only one video input.
      // This requires more sophisticated logic based on timeline content.
      // For now, an error or warning if no video output is set for a video render.
      console.warn("FilterGraphBuilder: No final video output stream label was set.");
    }

    if (this.outputStreamLabels.audio) {
      maps.push(`-map "${this.outputStreamLabels.audio}"`);
    } else {
      // Similar to video, could map last audio input or remain silent if no audio expected.
      console.warn("FilterGraphBuilder: No final audio output stream label was set.");
    }

    // Basic command structure, will need more options (codec, bitrate, etc.)
    return {
        inputs: this.inputs,
        complexFilter: complexFilter ? `-filter_complex "${complexFilter}"` : "",
        maps: maps
    };
  }

  // Helper to get canvas dimensions
  public getCanvasDimensions(): { w: number; h: number; fps: number } {
    return this.layout.canvas;
  }
}
