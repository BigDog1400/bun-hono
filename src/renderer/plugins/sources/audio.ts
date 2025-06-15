import { SourceRenderer } from '../../types';
import { FilterGraphBuilder } from '../../core/FilterGraphBuilder';
import { CTClip, CTSource } from '../../core/CanonicalTimeline';
import { sourceRegistry } from '../../core/PluginRegistry';

class AudioSourceRenderer implements SourceRenderer {
  kind: string = 'audio';

  async probe(source: CTSource): Promise<{ duration?: number }> {
    // Similar to video, ideally use ffprobe.
    if (typeof source.duration === 'number') {
      return { duration: source.duration };
    }
    console.warn(`AudioSourceRenderer: Probe for ${source.id} - duration not available in source, returning placeholder 60s.`);
    return { duration: 60 }; // Placeholder duration
  }

  addInputs(builder: FilterGraphBuilder, clip: CTClip, source: CTSource): void {
    if (source.resolvedPath) {
      builder.addInput(source.resolvedPath);
    } else {
      console.warn(`AudioSourceRenderer: Source ${source.id} for clip ${clip.id} has no resolvedPath. Cannot add input.`);
    }
  }

  getFilter(
    builder: FilterGraphBuilder,
    clip: CTClip,
    source: CTSource
  ): { video?: string; audio?: string } {
    const inputIndex = builder.getInputIndex(source.resolvedPath!);
    if (inputIndex === undefined) {
      console.error(`AudioSourceRenderer: Input index not found for source ${source.resolvedPath} of clip ${clip.id}.`);
      return {};
    }

    const audioStreamName = builder.getUniqueStreamLabel(`a_${clip.id}`);

    // Similar to video, duration/trimming needs careful handling.
    // Assuming for now the filter operates on the whole source and timeline composition handles timing.
    // `[${inputIndex}:a]atrim=duration=${clip.duration},asetpts=PTS-STARTPTS` could be one way.
    let audioFilter = `[${inputIndex}:a]`;

    const volume = typeof clip.volume === 'number' ? clip.volume / 100 : 1.0; // Assuming 0-100 input

    // Apply volume if not default. If default, use 'anull' to ensure the stream can be linked.
    if (volume !== 1.0) {
      audioFilter += `volume=${volume}`;
    } else {
      audioFilter += `anull`; // anull filter passes audio through unchanged, useful for creating a named link.
    }

    audioFilter += `[${audioStreamName}]`;
    builder.addFilter(audioFilter);

    // Audio sources don't produce video.
    return { audio: audioStreamName };
  }
}

sourceRegistry.register(new AudioSourceRenderer());
