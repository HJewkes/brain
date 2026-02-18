import { Command } from '@commander-js/extra-typings';
import { loadConfig, saveConfig } from '../services/config.js';
import type { BrainConfig } from '../types.js';

type ConfigValue = string | number | boolean | Record<string, unknown>;

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: ConfigValue
): Record<string, unknown> {
  const parts = path.split('.');
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = current[part];
    if (typeof existing === 'object' && existing !== null) {
      current[part] = { ...(existing as Record<string, unknown>) };
    } else {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
  return result;
}

function parseValue(raw: string): ConfigValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;
  return raw;
}

function camelCase(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelCasePath(path: string): string {
  return path.split('.').map(camelCase).join('.');
}

const getSubcommand = new Command('get')
  .description('Get config value(s)')
  .argument('[key]', 'Config key (dot-notation for nested, e.g. fusion-weights.bm25)')
  .action((key) => {
    const config = loadConfig();

    if (!key) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    const camelKey = camelCasePath(key);
    const value = getNestedValue(config as unknown as Record<string, unknown>, camelKey);

    if (value === undefined) {
      console.error(`Error: unknown config key "${key}"`);
      process.exitCode = 1;
      return;
    }

    if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(String(value));
    }
  });

const setSubcommand = new Command('set')
  .description('Set a config value')
  .argument('<key>', 'Config key (dot-notation for nested)')
  .argument('<value>', 'Value to set')
  .action((key, rawValue) => {
    const camelKey = camelCasePath(key);
    const value = parseValue(rawValue);
    const config = loadConfig() as unknown as Record<string, unknown>;

    const existing = getNestedValue(config, camelKey);
    if (existing === undefined) {
      console.error(`Error: unknown config key "${key}"`);
      process.exitCode = 1;
      return;
    }

    if (existing !== null && typeof value !== typeof existing) {
      console.error(
        `Error: type mismatch for "${key}". Expected ${typeof existing}, got ${typeof value}`
      );
      process.exitCode = 1;
      return;
    }

    const updated = setNestedValue(config, camelKey, value);

    try {
      saveConfig(updated as unknown as Partial<BrainConfig>);
      console.log(`Set ${key} = ${String(value)}`);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

export const configCommand = new Command('config')
  .description('Get or set configuration values')
  .addCommand(getSubcommand)
  .addCommand(setSubcommand);
