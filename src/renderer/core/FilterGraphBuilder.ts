// src/renderer/core/FilterGraphBuilder.ts
import type { RendererOptions, CTClip } from "../types"; // Assuming CTClip is in types
import type { CanonicalTimeline } from "./CanonicalTimeline";
import { LayoutV1 } from "../schema/layout-v1";

interface StreamInfo {
  label: string;
  type: 'video' | 'audio';
  // Potentially add more metadata like resolution, framerate, etc. if needed for complex decisions
}

interface InputMapping {
  filePath: string;
  inputIndex: number; // The FFmpeg input index (0, 1, 2...)
  clipId: string; // The CTClip ID this input primarily belongs to
}

export class FilterGraphBuilder {
  private inputs: InputMapping[] = [];
  private complexFilterParts: string[] = [];
  private streamCounter: { [key: string]: number } = { v: 0, a: 0, s: 0, out: 0 };
  private finalVideoOutput?: string;
  private finalAudioOutput?: string;

  // To track the current output label of a clip's video/audio after effects
  private currentClipStreamLabels: Map<string, { video?: string; audio?: string }> = new Map();

  constructor(
    private timeline: CanonicalTimeline,
    private options: RendererOptions,
    private layout: LayoutV1
  ) {}

  public addInput(filePath: string, clipId: string): number {
    const inputIndex = this.inputs.length;
    this.inputs.push({ filePath, inputIndex, clipId });
    return inputIndex;
  }

  public getInputStringForIndex(inputIndex: number): string {
    // For direct use like [0:v], [1:a] by plugins if they know the input index
    return `${inputIndex}`;
  }

  public getInputFilePaths(): string[] {
    return this.inputs.map(input => `-i "${input.filePath}"`);
  }

  public getUniqueStreamLabel(prefix: 'v' | 'a' | 's' | 'out' = 's'): string {
    this.streamCounter[prefix]++;
    return `[${prefix}${this.streamCounter[prefix]}]`;
  }

  public addFilterSegment(filterString: string): void {
    this.complexFilterParts.push(filterString);
  }

  // Update the latest known stream label for a clip's video or audio
  public updateClipStreamOutput(clipId: string, type: 'video' | 'audio', streamLabel: string): void {
    const current = this.currentClipStreamLabels.get(clipId) || {};
    current[type] = streamLabel;
    this.currentClipStreamLabels.set(clipId, current);
  }

  // Get the latest known stream label for a clip's video or audio
  public getClipStreamOutput(clipId: string, type: 'video' | 'audio'): string | undefined {
    return this.currentClipStreamLabels.get(clipId)?.[type];
  }

  // Overlay a video stream onto a base video stream
  // Returns the label of the output stream from the overlay filter
  public overlayVideo(
    baseStream: string,
    overlayStream: string,
    x: number,
    y: number,
    isShortest: boolean = false // if true, overlay ends when the shortest input ends
  ): string {
    const outStream = this.getUniqueStreamLabel("v");
    // Basic overlay. More options: eof_action, eval_mode, etc.
    // Shortest=1 makes the overlay terminate when the shorter of the two inputs ends.
    // This is often desired for image overlays on video, or titles.
    const shortestOpt = isShortest ? ":shortest=1" : "";
    this.addFilterSegment(`${baseStream}${overlayStream}overlay=${x}:${y}${shortestOpt}${outStream}`);
    return outStream;
  }

  // Mix multiple audio streams
  // Returns the label of the mixed audio stream
  public mixAudio(audioStreams: string[], dropoutTransition?: number): string {
    if (audioStreams.length === 0) {
      throw new Error("No audio streams provided to mixAudio.");
    }
    if (audioStreams.length === 1) {
      return audioStreams[0]; // No mixing needed for a single stream
    }
    const outStream = this.getUniqueStreamLabel("a");
    const inputsPart = audioStreams.join('');
    // dropout_transition: time in seconds for volume normalization when an input stream ends.
    const dropoutOpt = dropoutTransition !== undefined ? `:dropout_transition=${dropoutTransition}` : '';
    this.addFilterSegment(`${inputsPart}amix=inputs=${audioStreams.length}:duration=longest${dropoutOpt}${outStream}`);
    return outStream;
  }

  public setFinalVideoOutput(streamLabel: string): void {
    this.finalVideoOutput = streamLabel;
  }

  public setFinalAudioOutput(streamLabel: string): void {
    this.finalAudioOutput = streamLabel;
  }

  public build(): { inputs: string[], complexFilter: string, maps: string[] } {
    const maps: string[] = [];
    if (this.finalVideoOutput) {
      maps.push(`-map "${this.finalVideoOutput}"`);
    } else {
      console.warn("FilterGraphBuilder: No final video output stream was set. Output may be empty or unexpected.");
    }

    if (this.finalAudioOutput) {
      maps.push(`-map "${this.finalAudioOutput}"`);
    } else {
      // This is not always an error; some videos might have no audio.
      console.log("FilterGraphBuilder: No final audio output stream was set.");
    }

    const complexFilter = this.complexFilterParts.length > 0 ? `-filter_complex "${this.complexFilterParts.join('; ')}"` : "";

    return {
      inputs: this.getInputFilePaths(),
      complexFilter: complexFilter,
      maps: maps
    };
  }

  public getCanvasDimensions(): { w: number; h: number; fps: number; background?: any } {
     return {
        w: this.layout.canvas.w,
        h: this.layout.canvas.h,
        fps: this.layout.canvas.fps,
        background: this.layout.canvas.background
     };
  }

  // FR-301: Compositing based on z-index (handled by VideoRenderer using overlayVideo)
  // FR-302: Audio Mixing (handled by VideoRenderer using mixAudio)
  // FR-304: Transitions (handled by VideoRenderer using TransitionPlugins which use this builder)
}
