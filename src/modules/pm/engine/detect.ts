import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import type { DetectedComponent, ComponentType } from '../data/onboard-types.js';

const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '.next', '.turbo',
  '__pycache__', '.venv', 'venv', 'target', 'coverage', '.cache',
]);

const MANIFEST_FILES: Record<string, ComponentType> = {
  'package.json': 'node',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'pom.xml': 'java',
};

const ENTRY_PATTERNS: Record<ComponentType, string[]> = {
  'node': ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'index.ts', 'index.js'],
  'react-native': ['src/App.tsx', 'App.tsx', 'src/App.js', 'App.js', 'src/index.ts', 'index.js'],
  'go': ['main.go', 'cmd/main.go'],
  'rust': ['src/main.rs', 'src/lib.rs'],
  'python': ['src/main.py', 'main.py', '__main__.py', 'app.py'],
  'java': ['src/main/java'],
  'unknown': [],
};

function detectType(dir: string): ComponentType {
  for (const [file, type] of Object.entries(MANIFEST_FILES)) {
    if (existsSync(join(dir, file))) {
      if (file === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps['react-native']) return 'react-native';
        } catch { /* ignore malformed package.json */ }
      }
      return type;
    }
  }
  return 'unknown';
}

function findEntryPoints(componentPath: string, type: ComponentType): string[] {
  const patterns = ENTRY_PATTERNS[type] ?? [];
  return patterns.filter(p => existsSync(join(componentPath, p)));
}

function findDocPaths(componentPath: string): string[] {
  const docs: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        docs.push(relative(componentPath, full));
      }
    }
  }

  walk(componentPath);
  return docs.sort();
}

function resolveWorkspaceGlobs(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const parent = join(rootDir, base);
      if (!existsSync(parent)) continue;
      try {
        for (const entry of readdirSync(parent)) {
          const full = join(parent, entry);
          try {
            if (statSync(full).isDirectory()) dirs.push(full);
          } catch { continue; }
        }
      } catch { continue; }
    } else {
      const full = join(rootDir, pattern);
      if (existsSync(full)) dirs.push(full);
    }
  }
  return dirs;
}

function resolveComponentName(dir: string, relPath: string, rootDir: string): string {
  if (relPath === '.') return basename(rootDir);

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return (pkg.name as string)?.replace(/^@[^/]+\//, '') ?? basename(dir);
    } catch { /* fall through */ }
  }
  return basename(dir);
}

function buildComponent(dir: string, rootDir: string): DetectedComponent {
  const type = detectType(dir);
  const relPath = relative(rootDir, dir) || '.';
  const docPaths = findDocPaths(dir);
  const name = resolveComponentName(dir, relPath, rootDir);

  return {
    name,
    path: relPath,
    type,
    entryPoints: findEntryPoints(dir, type),
    docPaths,
    docCount: docPaths.length,
  };
}

export function detectComponents(rootDir: string): DetectedComponent[] {
  // 1. Check for monorepo workspaces
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;
      if (workspaces && workspaces.length > 0) {
        const dirs = resolveWorkspaceGlobs(rootDir, workspaces);
        if (dirs.length > 0) {
          return dirs
            .map(d => buildComponent(d, rootDir))
            .sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    } catch { /* fall through */ }
  }

  // 2. Check for multi-language siblings (subdirs with their own manifest files)
  const siblings: string[] = [];
  try {
    for (const entry of readdirSync(rootDir)) {
      if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(rootDir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch { continue; }
      if (detectType(full) !== 'unknown') {
        siblings.push(full);
      }
    }
  } catch { /* fall through */ }

  if (siblings.length >= 2) {
    return siblings
      .map(d => buildComponent(d, rootDir))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // 3. Fallback: single component from root
  return [buildComponent(rootDir, rootDir)];
}
