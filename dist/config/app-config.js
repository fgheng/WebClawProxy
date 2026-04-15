"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAppConfig = loadAppConfig;
exports.getAppConfigPath = getAppConfigPath;
exports.getPromptsRoot = getPromptsRoot;
exports.clearAppConfigCache = clearAppConfigCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prompt_loader_1 = require("./prompt-loader");
const configPath = path.join(process.cwd(), 'config', 'default.json');
const promptsRoot = path.join(process.cwd(), 'prompts');
let cachedConfig = null;
function loadAppConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cachedConfig = (0, prompt_loader_1.resolvePromptRefsInValue)(raw, promptsRoot);
    return cachedConfig;
}
function getAppConfigPath() {
    return configPath;
}
function getPromptsRoot() {
    return promptsRoot;
}
function clearAppConfigCache() {
    cachedConfig = null;
}
//# sourceMappingURL=app-config.js.map