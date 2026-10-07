// What the preload exposes on window.repodeck (see src/preload/index.ts).

export interface RepoDeckBridge {
  call<T = unknown>(method: string, args?: unknown): Promise<T>
  on(name: string, fn: (data: unknown) => void): () => void
  host: {
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<string>
    openInEditor(path: string, file?: string): Promise<void>
    chooseFolders(): Promise<string[]>
    initialFolders(): Promise<string[]>
    pathForFile(file: File): string
    installUpdate(): Promise<void>
  }
  platform: string
}

declare global {
  interface Window {
    repodeck: RepoDeckBridge
  }
}
