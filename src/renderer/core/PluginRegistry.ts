import { SourceRenderer, EffectRenderer, TransitionRenderer } from '../types';

/**
 * A generic registry for plugins.
 * Plugins are stored by their 'kind' property.
 *
 * @template T The type of the plugin, expected to have a 'kind: string' property.
 */
export class PluginRegistry<T extends { kind: string }> {
  private plugins: Map<string, T> = new Map();

  /**
   * Registers a plugin.
   * If a plugin with the same kind already exists, it will be overwritten.
   * @param plugin The plugin instance to register.
   */
  register(plugin: T): void {
    this.plugins.set(plugin.kind, plugin);
    // console.log(`Registered ${plugin.constructor.name} with kind: ${plugin.kind}`);
  }

  /**
   * Retrieves a plugin by its kind.
   * @param kind The kind of the plugin to retrieve.
   * @returns The plugin instance, or undefined if not found.
   */
  get(kind: string): T | undefined {
    const plugin = this.plugins.get(kind);
    if (!plugin) {
      // console.warn(`Plugin not found for kind: ${kind}`);
    }
    return plugin;
  }

  /**
   * Retrieves all registered plugins.
   * @returns An array of all plugin instances.
   */
  getAll(): T[] {
    return Array.from(this.plugins.values());
  }
}

// Instantiate registries for different plugin types

/**
 * Registry for SourceRenderer plugins.
 * These plugins are responsible for rendering different types of sources (e.g., video, image, audio).
 */
export const sourceRegistry = new PluginRegistry<SourceRenderer>();

/**
 * Registry for EffectRenderer plugins.
 * These plugins apply visual or audio effects to media streams.
 */
export const effectRegistry = new PluginRegistry<EffectRenderer>();

/**
 * Registry for TransitionRenderer plugins.
 * These plugins create transitions between media clips.
 */
export const transitionRegistry = new PluginRegistry<TransitionRenderer>();
