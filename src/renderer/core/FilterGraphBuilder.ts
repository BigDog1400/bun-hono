/**
 * Placeholder for RendererOptions.
 * This type can be expanded later with actual options.
 */
export interface RendererOptions {
  // Example option:
  // framerate?: number;
  // outputPath?: string;
  // verbose?: boolean;
}

/**
 * Builds an FFmpeg filter graph string (`-filter_complex`).
 * This class is stateful and accumulates inputs and filter specifications.
 */
export class FilterGraphBuilder {
  private inputs: string[] = [];
  private filters: string[] = [];
  private streamLabelCounter: Map<string, number> = new Map();
  // private options: RendererOptions; // Store options if needed

  /**
   * Constructs a new FilterGraphBuilder.
   * @param options Optional parameters for rendering.
   */
  constructor(options?: RendererOptions) {
    // this.options = options || {}; // Store options if provided
    // Initialization logic if any, based on options
  }

  /**
   * Adds an input file to the FFmpeg command.
   * These are referenced by their index in the filter graph (e.g., [0:v], [1:a]).
   * @param filePath The path to the input file.
   * @returns The index of the added input.
   */
  private inputMap: Map<string, number> = new Map(); // filePath to index

  /**
   * Adds an input file to the FFmpeg command if not already added.
   * These are referenced by their index in the filter graph (e.g., [0:v], [1:a]).
   * @param filePath The path to the input file.
   * @returns The index of the input (either newly added or existing).
   */
  addInput(filePath: string): number {
    if (this.inputMap.has(filePath)) {
      return this.inputMap.get(filePath)!;
    }
    this.inputs.push(filePath);
    const inputIndex = this.inputs.length - 1;
    this.inputMap.set(filePath, inputIndex);
    return inputIndex;
  }

  /**
   * Retrieves the index for a previously added input file path.
   * @param filePath The path to the input file.
   * @returns The index of the input, or undefined if not found.
   */
  getInputIndex(filePath: string): number | undefined {
    return this.inputMap.get(filePath);
  }

  /**
   * Gets the current number of input files added.
   * @returns The count of inputs.
   */
  getInputCount(): number {
    return this.inputs.length;
  }

  /**
   * Generates a unique stream label with a given prefix.
   * Ensures that labels like [prefix], [prefix1], [prefix2] are unique.
   * If the prefix is used for the first time, it returns `[prefix]`.
   * Subsequent calls with the same prefix will append a number (e.g., `[prefix1]`, `[prefix2]`).
   * @param prefix The base name for the stream label.
   * @returns A unique stream label string (e.g., "[out]", "[v_processed1]").
   */
  getUniqueStreamLabel(prefix: string): string {
    const currentCount = this.streamLabelCounter.get(prefix) || 0;
    this.streamLabelCounter.set(prefix, currentCount + 1);
    if (currentCount === 0 && !prefix.startsWith('[') && !prefix.endsWith(']')) { // Avoid double bracketing if prefix is already a label
        // Check if a label like `[prefix]` already exists from a different source/logic if necessary
        // For now, assume if count is 0, `[prefix]` is unique for this prefix.
        return `[${prefix}]`;
    }
    return `[${prefix}${currentCount}]`;
  }

  /**
   * Adds a filter definition to the filter graph.
   * @param filterSpec The filter string (e.g., "scale=1280:720").
   *                   This should include input and output stream labels.
   *                   Example: "[0:v]scale=1280:720[scaled_v]"
   */
  addFilter(filterSpec: string): void {
    this.filters.push(filterSpec);
  }

  /**
   * Builds the complete FFmpeg command string or the filter_complex part.
   * For now, it will return just the filter_complex string.
   * @returns The FFmpeg filter_complex string.
   */
  build(): string {
    if (this.filters.length === 0) {
      return ""; // Return empty if no filters were added
    }
    return this.filters.join(';\n'); // Join filters with semicolon and newline for readability
  }

  /**
   * Builds the full FFmpeg command arguments list.
   * (This is a more complete version for future use)
   * @param outputFilePath The path for the output file.
   * @returns An array of strings representing the FFmpeg command and its arguments.
   */
  buildCommandArgs(outputFilePath: string): string[] {
    const commandArgs: string[] = [];
    this.inputs.forEach(input => {
      commandArgs.push('-i', input);
    });

    if (this.filters.length > 0) {
      commandArgs.push('-filter_complex', this.build());
    }

    // Add other options like -map, codec settings, etc.
    // For example, to map the last output of the filter graph:
    // if (this.filters.length > 0) {
    //   // This assumes the last filter's output is what we want to map.
    //   // A more robust way would be to track the final output stream label.
    //   const lastFilter = this.filters[this.filters.length - 1];
    //   const match = lastFilter.match(/\[([^\]]+)\]$/);
    //   if (match) {
    //     commandArgs.push('-map', `${match[0]}`);
    //   }
    // }

    commandArgs.push(outputFilePath);
    return commandArgs;
  }
}
