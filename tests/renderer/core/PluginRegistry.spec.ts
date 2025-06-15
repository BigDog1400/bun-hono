// tests/renderer/core/PluginRegistry.spec.ts
import { PluginRegistry } from '../../../src/renderer/core/PluginRegistry';

interface MockPlugin {
  kind: string;
  doSomething: () => string;
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry<MockPlugin>;

  beforeEach(() => {
    registry = new PluginRegistry<MockPlugin>();
  });

  it('should correctly register a plugin', () => {
    const plugin: MockPlugin = { kind: 'test', doSomething: () => 'test_output' };
    registry.register('test', plugin);
    expect(registry.get('test')).toBe(plugin);
  });

  it('should throw an error when getting a non-existent plugin', () => {
    expect(() => registry.get('nonexistent')).toThrow('PluginRegistry: No plugin registered for kind "nonexistent"');
  });

  it('should overwrite an existing plugin if registered with the same kind and log a warning', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const plugin1: MockPlugin = { kind: 'test', doSomething: () => 'output1' };
    const plugin2: MockPlugin = { kind: 'test', doSomething: () => 'output2' };

    registry.register('test', plugin1);
    registry.register('test', plugin2);

    expect(registry.get('test')).toBe(plugin2);
    expect(consoleWarnSpy).toHaveBeenCalledWith('PluginRegistry: Plugin with kind "test" is being overwritten.');

    consoleWarnSpy.mockRestore();
  });

  it('should return all registered plugins', () => {
    const plugin1: MockPlugin = { kind: 'test1', doSomething: () => 'output1' };
    const plugin2: MockPlugin = { kind: 'test2', doSomething: () => 'output2' };
    registry.register('test1', plugin1);
    registry.register('test2', plugin2);

    const allPlugins = registry.getAll();
    expect(allPlugins).toHaveLength(2);
    expect(allPlugins).toContain(plugin1);
    expect(allPlugins).toContain(plugin2);
  });

  it('should return all registered kinds', () => {
    registry.register('test1', { kind: 'test1', doSomething: () => 'output1' });
    registry.register('test2', { kind: 'test2', doSomething: () => 'output2' });

    const kinds = registry.getRegisteredKinds();
    expect(kinds).toHaveLength(2);
    expect(kinds).toContain('test1');
    expect(kinds).toContain('test2');
    expect(kinds.sort()).toEqual(['test1', 'test2'].sort());
  });
});
