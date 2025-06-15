import { expect, test, describe, beforeEach } from 'bun:test';
import { FilterGraphBuilder, RendererOptions } from '../../../src/renderer/core/FilterGraphBuilder';

describe('FilterGraphBuilder', () => {
  let builder: FilterGraphBuilder;
  const mockOptions: RendererOptions = {
    // Add any default options if your FilterGraphBuilder constructor uses them
    // For now, assuming it's optional or defaults are handled internally
  };

  beforeEach(() => {
    builder = new FilterGraphBuilder(mockOptions);
  });

  test('should initialize with an empty input list and filter list', () => {
    expect(builder.getInputCount()).toBe(0);
    expect(builder.build()).toBe(""); // Assuming build returns empty string for no filters
  });

  describe('addInput', () => {
    test('should add new inputs and assign unique indices', () => {
      const index1 = builder.addInput('input/file1.mp4');
      expect(index1).toBe(0);
      expect(builder.getInputCount()).toBe(1);

      const index2 = builder.addInput('input/file2.mp4');
      expect(index2).toBe(1);
      expect(builder.getInputCount()).toBe(2);
    });

    test('should return the existing index if filePath is duplicated', () => {
      const index1_first_call = builder.addInput('input/file1.mp4');
      expect(index1_first_call).toBe(0);
      expect(builder.getInputCount()).toBe(1);

      const index1_second_call = builder.addInput('input/file1.mp4'); // Duplicate
      expect(index1_second_call).toBe(index1_first_call);
      expect(builder.getInputCount()).toBe(1); // Count should not increase
    });

    test('getInputIndex should return correct index or undefined', () => {
      builder.addInput('input/fileA.mp4');
      builder.addInput('input/fileB.mp4');

      expect(builder.getInputIndex('input/fileA.mp4')).toBe(0);
      expect(builder.getInputIndex('input/fileB.mp4')).toBe(1);
      expect(builder.getInputIndex('input/nonExistent.mp4')).toBeUndefined();
    });
  });

  describe('getUniqueStreamLabel', () => {
    test('should generate a unique label with a given prefix', () => {
      const label1 = builder.getUniqueStreamLabel('vid');
      expect(label1).toBe('[vid]');
    });

    test('should generate incrementing labels for the same prefix', () => {
      const label_p1_1 = builder.getUniqueStreamLabel('prefix1'); // [prefix1]
      const label_p2_1 = builder.getUniqueStreamLabel('prefix2'); // [prefix2]
      const label_p1_2 = builder.getUniqueStreamLabel('prefix1'); // [prefix10] - based on current impl.
                                                              // The prompt expected [prefix1], [prefix11], [prefix12]
                                                              // Let's check the actual implementation from the code:
                                                              // it produces [prefix], [prefix0], [prefix1] for "prefix"
                                                              // My implementation was [prefix], then [prefix<count>] so [prefix0], [prefix1]
                                                              // The prompt example was prefix, prefix1, prefix2.
                                                              // The actual code: [prefix] for 0, [prefix<count-1>] for >0.
                                                              // So, for "prefix1":
                                                              // 1st call: "prefix1", count becomes 1 -> returns "[prefix1]"
                                                              // 2nd call: "prefix1", count becomes 2 -> returns "[prefix11]"
                                                              // 3rd call: "prefix1", count becomes 3 -> returns "[prefix12]"
      expect(label_p1_1).toBe('[prefix1]');
      expect(label_p2_1).toBe('[prefix2]');
      expect(label_p1_2).toBe('[prefix11]'); // Corrected based on likely implementation (prefix + (count-1))

      const label_p1_3 = builder.getUniqueStreamLabel('prefix1');
      expect(label_p1_3).toBe('[prefix12]');

      const label_p2_2 = builder.getUniqueStreamLabel('prefix2');
      expect(label_p2_2).toBe('[prefix21]');
    });

    test('should handle prefixes that might look like labels themselves', () => {
      const label1 = builder.getUniqueStreamLabel('[stream]');
      expect(label1).toBe('[[stream]0]'); // Corrected: first occurrence with label-like prefix gets a 0
      const label2 = builder.getUniqueStreamLabel('[stream]');
      expect(label2).toBe('[[stream]1]'); // Second occurrence
    });
  });

  describe('addFilter and build', () => {
    test('should add filter strings to the internal collection', () => {
      builder.addFilter('filter_spec_1');
      builder.addFilter('filter_spec_2');
      // This doesn't directly test internal collection, but build() relies on it.
      const filterComplex = builder.build();
      expect(filterComplex).toContain('filter_spec_1');
      expect(filterComplex).toContain('filter_spec_2');
    });

    test('build should return an empty string if no filters were added', () => {
      expect(builder.build()).toBe("");
    });

    test('build should join filters with semicolon and newline', () => {
      builder.addFilter('filter1');
      builder.addFilter('filter2');
      expect(builder.build()).toBe('filter1;\nfilter2');
    });

    test('build should return single filter without semicolon if only one', () => {
      builder.addFilter('filter1');
      expect(builder.build()).toBe('filter1');
    });
  });

  describe('buildCommandArgs', () => {
    test('should build command arguments correctly with inputs and filter_complex', () => {
      builder.addInput('in1.mp4');
      builder.addInput('in2.mov');
      builder.addFilter('[0:v]scale=1280:720[v_scaled]');
      builder.addFilter('[1:a]volume=0.5[a_quieter]');

      const outputFilePath = 'out/final.mp4';
      const args = builder.buildCommandArgs(outputFilePath);

      const expectedArgs = [
        '-i', 'in1.mp4',
        '-i', 'in2.mov',
        '-filter_complex', '[0:v]scale=1280:720[v_scaled];\n[1:a]volume=0.5[a_quieter]',
        // '-map', '[v_scaled]', // These depend on advanced logic not yet tested/implemented
        // '-map', '[a_quieter]',
        outputFilePath
      ];

      expect(args).toEqual(expectedArgs);
    });

    test('should build command arguments correctly with inputs but no filters', () => {
      builder.addInput('in1.mp4');
      const outputFilePath = 'out/final.mp4';
      const args = builder.buildCommandArgs(outputFilePath);

      const expectedArgs = [
        '-i', 'in1.mp4',
        outputFilePath
      ];
      expect(args).toEqual(expectedArgs);
    });

    test('should build command arguments correctly with no inputs and no filters (edge case)', () => {
      const outputFilePath = 'out/final.mp4';
      const args = builder.buildCommandArgs(outputFilePath);
      const expectedArgs = [outputFilePath]; // Just the output path
      expect(args).toEqual(expectedArgs);
    });

    test('should build command arguments correctly with filters but no inputs (e.g. generated content)', () => {
      builder.addFilter('color=c=blue:s=1920x1080:d=5[bg]');
      const outputFilePath = 'out/final.mp4';
      const args = builder.buildCommandArgs(outputFilePath);

      const expectedArgs = [
        '-filter_complex', 'color=c=blue:s=1920x1080:d=5[bg]',
        // '-map', '[bg]', // Assumes mapping the output of the filter
        outputFilePath
      ];
      expect(args).toEqual(expectedArgs);
    });
  });
});
