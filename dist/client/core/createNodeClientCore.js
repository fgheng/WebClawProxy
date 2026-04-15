"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNodeClientCore = createNodeClientCore;
const WebClawClient_1 = require("../WebClawClient");
const model_provider_map_1 = require("./model-provider-map");
const WebClawClientCore_1 = require("./WebClawClientCore");
function createNodeClientCore(config, hostActions) {
    return new WebClawClientCore_1.WebClawClientCore({
        transport: new WebClawClient_1.WebClawClient(config),
        catalog: (0, model_provider_map_1.loadProviderModelCatalog)(),
        hostActions,
    });
}
//# sourceMappingURL=createNodeClientCore.js.map