import { expect, test, describe, beforeEach } from 'bun:test';
import { PluginRegistry } from '../../../src/renderer/core/PluginRegistry';

// Define a simple mock plugin type for testing
interface MockPlugin {
  kind: string;
  exec: () => string;
  someOtherProp?: string;
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry<MockPlugin>;

  // Mock plugins for testing
  const mockPlugin1: MockPlugin = {
    kind: 'test-plugin-1',
    exec: () => 'executed-1',
    someOtherProp: 'value1',
  };

  const mockPlugin2: MockPlugin = {
    kind: 'test-plugin-2',
    exec: () => 'executed-2',
  };

  const mockPlugin1Overwritten: MockPlugin = {
    kind: 'test-plugin-1', // Same kind as mockPlugin1
    exec: () => 'executed-1-overwritten',
    someOtherProp: 'newValue1',
  };

  beforeEach(() => {
    registry = new PluginRegistry<MockPlugin>();
  });

  test('should register a new plugin', () => {
    registry.register(mockPlugin1);
    const retrieved = registry.get('test-plugin-1');
    expect(retrieved).toBe(mockPlugin1);
    expect(retrieved?.exec()).toBe('executed-1');
  });

  test('should retrieve a registered plugin by its kind', () => {
    registry.register(mockPlugin1);
    registry.register(mockPlugin2);

    const retrieved1 = registry.get('test-plugin-1');
    expect(retrieved1).toBe(mockPlugin1);
    expect(retrieved1?.exec()).toBe('executed-1');
    expect(retrieved1?.someOtherProp).toBe('value1');

    const retrieved2 = registry.get('test-plugin-2');
    expect(retrieved2).toBe(mockPlugin2);
    expect(retrieved2?.exec()).toBe('executed-2');
  });

  test('should return undefined when retrieving a non-existent plugin', () => {
    registry.register(mockPlugin1);
    const retrieved = registry.get('non-existent-plugin');
    expect(retrieved).toBeUndefined();
  });

  test('should allow overwriting an existing plugin with the same kind', () => {
    // Spy on console.log if the registry logs a warning (it doesn't currently, but good practice)
    // const consoleSpy = spyOn(console, 'log');

    registry.register(mockPlugin1);
    const originalPlugin = registry.get('test-plugin-1');
    expect(originalPlugin?.exec()).toBe('executed-1');
    expect(originalPlugin?.someOtherProp).toBe('value1');

    registry.register(mockPlugin1Overwritten);
    const overwrittenPlugin = registry.get('test-plugin-1');
    expect(overwrittenPlugin).toBe(mockPlugin1Overwritten);
    expect(overwrittenPlugin?.exec()).toBe('executed-1-overwritten');
    expect(overwrittenPlugin?.someOtherProp).toBe('newValue1');

    // If it were to log:
    // expect(consoleSpy).toHaveBeenCalledWith(
    //   "Registered PluginClass with kind: test-plugin-1 (overwriting existing)"
    // );
    // consoleSpy.mockRestore();
  });

  test('should get all registered plugins', () => {
    registry.register(mockPlugin1);
    registry.register(mockPlugin2);

    const allPlugins = registry.getAll();
    expect(allPlugins).toBeArray();
    expect(allPlugins.length).toBe(2);
    // Order might not be guaranteed by Map.values(), so check for presence
    expect(allPlugins).toContain(mockPlugin1);
    expect(allPlugins).toContain(mockPlugin2);
  });

  test('getAll should return an empty array if no plugins are registered', () => {
    const allPlugins = registry.getAll();
    expect(allPlugins).toBeArray();
    expect(allPlugins.length).toBe(0);
  });

  test('get should still work after getAll is called', () => {
    registry.register(mockPlugin1);
    registry.getAll(); // Call getAll
    const retrieved = registry.get('test-plugin-1');
    expect(retrieved).toBe(mockPlugin1);
  });
});
