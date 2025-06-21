# AGENTS.md: AI and Developer Guide

This document provides essential guidelines for AI agents and human developers working on this video renderer codebase. Its primary goal is to ensure consistency, prevent common errors, and streamline development, with a strong focus on our testing methodology.

## Project Structure

The codebase is organized to separate core logic, plugins, and schemas. Tests should be colocated with the files they are testing, following the same directory structure.

-   `/src/renderer/core/`: Contains the main orchestration logic (`VideoRenderer`), the `FilterGraphBuilder`, `PluginRegistry`, and `CanonicalTimeline` definitions.
-   `/src/renderer/plugins/`: Houses all plugins, categorized by type. This is where most of the modular logic for rendering different sources, effects, and transitions resides.
    -   `/effects/`
    -   `/sources/`
    -   `/transitions/`
-   `/src/renderer/schema/`: Defines the Zod schemas for validating input documents (`layout-v1.ts`).
-   `/src/renderer/types/`: Contains shared TypeScript interfaces for plugins.
-   `/src/renderer/utils/`: Includes utility functions, such as the `ffmpeg-executor`.
-   **Tests:** Test files must be named `[filename].test.ts` and live alongside the file they are testing.

## Testing with `bun:test`

This project exclusively uses the native APIs from `bun:test`. All new tests must adhere to these standards to maintain a clean, fast, and consistent test suite.

### The Golden Rule: Avoid the `jest` Compatibility Object

The single most important convention is to **avoid using the `jest` compatibility object**. While `bun:test` provides it for easier migration, we will not use it in this project.

| Do This (Correct)                             | Don't Do This (Incorrect)                         |
| :-------------------------------------------- | :------------------------------------------------ |
| `import { mock } from 'bun:test';`           | `import { jest } from 'bun:test';`                |
| `const myMock = mock();`                      | `const myMock = jest.fn();`                       |
| `(myFunc as Mock).mockClear();`               | `jest.mocked(myFunc).mockClear();`                |
| `import { spyOn } from 'bun:test';`           | `const spy = jest.spyOn(...)`                     |
| `type MyMock = Mock<...>;`                    | `type MyMock = jest.Mock<...>;`                   |

### The Correct Pattern for Mocking Complex Objects

Our tests frequently mock complex objects like `FilterGraphBuilder`. To do this correctly without TypeScript errors, follow this three-step pattern:

1.  **Declare the variable with its full, real type.**
2.  **Instantiate a partial mock object** using `mock()` for the functions you need to control.
3.  **Cast the partial object to the full type** a single time upon assignment.

```typescript
// 1. Declare with the real type
let mockBuilder: FilterGraphBuilder;

beforeEach(() => {
  // 2. Create the partial mock
  const partialMock = {
    addFilter: mock((spec: string) => {}),
    getUniqueStreamLabel: mock((prefix: string) => `[${prefix}_mock]`),
    // ...only include other methods needed for the test
  };

  // 3. Cast the partial mock to the full type ONCE
  mockBuilder = partialMock as FilterGraphBuilder;
});
```

When you need to access mock-specific properties like `.mock` on a function within the casted object, you must perform a one-time cast on that function:

```typescript
// To check calls on a mock function within the typed mock object:
const filterCall = (mockBuilder.addFilter as Mock).mock.calls[0][0];

// To set a return value for a mock function within the typed mock object:
(mockBuilder.getUniqueStreamLabel as Mock).mockReturnValue('[fixed_label]');
```

### Mocking Modules

For testing units like `VideoRenderer` that have hard dependencies, use `mock.module()` to replace the dependency entirely. This must be done at the top level of the test file.

```typescript
// Example from VideoRenderer.test.ts
import { type Mock, mock } from 'bun:test';

// Define the mock function with its type
const mockExecuteFFmpegCommand: Mock<(...) => Promise<...>> = mock();

// Use mock.module to replace the real implementation
mock.module('../../../src/renderer/utils/ffmpeg-executor', () => ({
  executeFFmpegCommand: mockExecuteFFmpegCommand,
}));
```

## Running Tests

Use the `bun test` command to run the test suite.

```bash
# Run all tests
bun test

# Run a specific test file
bun test src/renderer/plugins/sources/video.test.ts
```

## Pull Request Guidelines

1.  **Clear Description:** The PR description must clearly explain the purpose of the changes.
2.  **Reference Issues:** Link any relevant issues being addressed.
3.  **Tests Must Pass:** All existing and new tests must pass.
4.  **Add New Tests:** Any new feature or bug fix must be accompanied by corresponding tests that follow the patterns in this document.
5.  **Focused PRs:** Keep pull requests small and focused on a single feature or bug fix.

## Programmatic Checks

Before committing or opening a pull request, run the following commands to ensure code quality:

```bash
# Run all linter checks
bun run lint

# Run TypeScript type-checker
bun run type-check
```

Adherence to these guidelines is mandatory for all contributions. This ensures the project remains maintainable, robust, and easy to work with for everyone.