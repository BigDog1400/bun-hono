// src/renderer/plugins/sources/audio.ts
import type { SourceRenderer, CTClip, Source } from "../../types";
import type { FilterGraphBuilder } from "../../core/FilterGraphBuilder";
import { sourceRegistry } from "../../core/PluginRegistry";
// We might need ffprobe-wasm or a similar utility for actual probing in the future.
// For now, probe returns a fixed value or relies on pre-supplied metadata if available.

class AudioSourceRenderer implements SourceRenderer {
  public readonly kind = "audio";

  public async probe(source: Source): Promise<{ duration: number; hasAudio: boolean; hasVideo: boolean }> {
    // Actual duration would be determined by ffprobe.
    // For this skeleton, we'll assume a placeholder duration or expect it to be
    // provided if `source.duration` (not standard in Source schema, but CTClip has it)
    // or block duration constrains it.
    // PRD implies duration can be inferred: "If omitted, defaults to audio length." (Block.duration)
    // This probe is for the intrinsic duration of the source file.

    // Placeholder: In a real scenario, call ffprobe here.
    // const probedDuration = await someFFprobeFunction(source.src);
    const PREDETERMINED_AUDIO_DURATION = 10.0; // seconds, replace with actual probing

    return { duration: PREDETERMINED_AUDIO_DURATION, hasAudio: true, hasVideo: false };
  }

  public addInputs(builder: FilterGraphBuilder, clip: CTClip, source: Source): void {
    // Add the audio file as an FFmpeg input.
    builder.addInput(source.src);
  }

  public getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: Source
  ): { video?: string; audio?: string } {
    const inputIndex = builder.getInputCount() - 1;
    let audioStreamLabel = `[${inputIndex}:a]`; // Selects the audio stream from the input

    // Audio sources typically don't have complex visual filters like scaling or opacity by default.
    // However, they might have audio-specific filters (e.g., volume, fade, equalization).
    // For now, we'll just pass the raw audio stream.
    // Effects like "Fade In/Out" (FR-304) will be handled by EffectRenderers later,
    // which will take this initial stream label as input.

    // Example of a simple volume adjustment if it were part of the source properties:
    // if (source.volume !== undefined && source.volume !== 1.0) { // Assuming 'volume' could be a prop in Source for audio
    //   const volumeAdjustedStream = builder.getUniqueStreamLabel("a");
    //   builder.addFilter(`${audioStreamLabel}volume=${source.volume}${volumeAdjustedStream}`);
    //   audioStreamLabel = volumeAdjustedStream;
    // }

    // No complex filter chain is built here by default for a basic audio source.
    // The stream is made available for mixing or direct mapping by the FilterGraphBuilder.
    // If the audio clip has effects (e.g. fade in/out), those will be applied
    // by an EffectRenderer in the VideoRenderer's main loop, taking this `audioStreamLabel` as input.

    // Unlike video sources that might build a chain like "[0:v]scale[scaled];[scaled]format[final]",
    // audio often just passes its input stream label directly if no source-specific modifications
    // are defined directly on the source object (effects are separate).
    // So, we don't call builder.addFilter() here unless there's a filter intrinsic to this source's definition.

    return { audio: audioStreamLabel };
  }
}

// Self-register the plugin
sourceRegistry.register("audio", new AudioSourceRenderer());
