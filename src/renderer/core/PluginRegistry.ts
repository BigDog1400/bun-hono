// src/renderer/core/PluginRegistry.ts
import type { SourceRenderer, EffectRenderer, TransitionRenderer } from "../types";

export class PluginRegistry<T> {
  private plugins = new Map<string, T>();

  public register(kind: string, plugin: T): void {
    if (this.plugins.has(kind)) {
      // In a real application, you might want a more robust warning system
      // or even throw an error, depending on desired behavior.
      console.warn(`PluginRegistry: Plugin with kind "${kind}" is being overwritten.`);
    }
    this.plugins.set(kind, plugin);
  }

  public get(kind: string): T {
    const plugin = this.plugins.get(kind);
    if (!plugin) {
      // Consider the severity of this error. For a renderer, not finding a plugin
      // is likely a critical issue.
      throw new Error(`PluginRegistry: No plugin registered for kind "${kind}". Available kinds: ${Array.from(this.plugins.keys()).join(", ")}`);
    }
    return plugin;
  }

  public getAll(): T[] {
    return Array.from(this.plugins.values());
  }

  public getRegisteredKinds(): string[] {
    return Array.from(this.plugins.keys());
  }
}

// Instantiate specific registries for different plugin types.
// These will be imported by the VideoRenderer and by the plugins themselves for self-registration.

export const sourceRegistry = new PluginRegistry<SourceRenderer>();
export const effectRegistry = new PluginRegistry<EffectRenderer>();
export const transitionRegistry = new PluginRegistry<TransitionRenderer>();
