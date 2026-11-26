export type PluginWorkerOrcaApi = {
  host: {
    call(method: string, params?: unknown): Promise<unknown>
    has(method: string): boolean
  }
  panels: {
    handle(name: string, handler: (input: unknown) => unknown): unknown
  }
  secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
}
