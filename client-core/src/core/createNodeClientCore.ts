import { WebClawClient } from '../WebClawClient';
import { loadProviderModelCatalog } from './model-provider-map';
import { WebClawClientCore } from './WebClawClientCore';
import { ClientCoreConfig, ClientCoreHostActions } from './types';
import { FileClientSessionStore } from './session-store';

export function createNodeClientCore(
  config: ClientCoreConfig,
  hostActions?: ClientCoreHostActions
): WebClawClientCore {
  const sessionStore = new FileClientSessionStore();
  return new WebClawClientCore({
    transport: new WebClawClient(config),
    catalog: loadProviderModelCatalog(),
    hostActions,
    sessionStore,
  });
}
