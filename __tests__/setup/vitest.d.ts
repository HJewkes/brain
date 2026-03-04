declare module 'vitest' {
  export interface ProvidedContext {
    templateDbPath: string;
    schemaVersion: number;
  }
}
