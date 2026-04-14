import { WebClawClient } from '../WebClawClient';
import { loadProviderModelCatalog } from './model-provider-map';
import { WebClawClientCore } from './WebClawClientCore';
import { ClientCoreConfig, ClientCoreHostActions } from './types';

export function createNodeClientCore(
  config: ClientCoreConfig,
  hostActions?: ClientCoreHostActions
): WebClawClientCore {
  return new WebClawClientCore({
    transport: new WebClawClient(config),
    catalog: loadProviderModelCatalog(),
    hostActions,
  });
}
