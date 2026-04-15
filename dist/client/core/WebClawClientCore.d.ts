import { ClientCoreOptions, ClientCoreResult, ClientCoreState, ClientTransport } from './types';
export declare class WebClawClientCore {
    private readonly client;
    private readonly catalog;
    private readonly hostActions?;
    private provider;
    constructor(options: ClientCoreOptions);
    getTransport(): ClientTransport;
    getState(): ClientCoreState;
    executeInput(input: string): Promise<ClientCoreResult>;
    private syncProviderWithModel;
    private emitEvent;
    private formatHistory;
}
//# sourceMappingURL=WebClawClientCore.d.ts.map