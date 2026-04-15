import { AssistantResponse, ChatMessage, ClientConfig } from '../types';
import { ProviderKey, ProviderModelCatalog } from './provider-models';
export interface ClientTransport {
    sendMessage(userContent: string): Promise<AssistantResponse>;
    clearHistory(): void;
    getHistory(): ChatMessage[];
    getConfig(): Required<ClientConfig>;
    setModel(model: string): void;
    setSystem(system: string): void;
    setStream(enabled: boolean): void;
    setTraceEnabled(enabled: boolean): void;
    healthCheck(): Promise<boolean>;
}
export type ClientCoreState = {
    model: string;
    provider: ProviderKey;
    stream: boolean;
    systemPrompt?: string;
    history: ChatMessage[];
};
export type ClientCoreResult = {
    kind: 'chat';
    userInput: string;
    response: AssistantResponse;
    provider: ProviderKey;
    model: string;
} | {
    kind: 'command';
    command: string;
    lines: string[];
    state: ClientCoreState;
    shouldExit?: boolean;
};
export type ClientCoreEvents = {
    type: 'provider-change' | 'state-change';
    provider?: ProviderKey;
    model?: string;
};
export type ClientCoreHostActions = {
    onEvent?: (event: ClientCoreEvents) => void;
};
export type ClientCoreConfig = ClientConfig;
export type ClientCoreOptions = {
    transport: ClientTransport;
    catalog?: ProviderModelCatalog;
    hostActions?: ClientCoreHostActions;
};
//# sourceMappingURL=types.d.ts.map