export type LlmRole =
  | 'Extractor'
  | 'WorldMapper'
  | 'Planner'
  | 'Narrator'
  | 'Checker'
  | 'Summarizer';

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimated: boolean;
}

export interface LlmResponse {
  text: string;
  usage?: LlmUsage;
  requestId?: string;
}

export interface LlmRequest {
  role: LlmRole;
  system: string;
  user: string;
  maxOutputTokens: number;
  jsonMode?: boolean;
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmProviderCapabilities {
  supportsJson: boolean;
  supportsStreaming: boolean;
  reportsUsage: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ApiProfile {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  keyRef: string;
  capabilities: LlmProviderCapabilities;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface SecretStore {
  set(keyRef: string, secret: string): Promise<void>;
  get(keyRef: string): Promise<string | null>;
  delete(keyRef: string): Promise<void>;
}
