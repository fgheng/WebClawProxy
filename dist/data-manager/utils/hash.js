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
exports.computeSystemHash = computeSystemHash;
exports.computeHistoryHash = computeHistoryHash;
exports.computeToolsHash = computeToolsHash;
exports.computeHashKey = computeHashKey;
const crypto = __importStar(require("crypto"));
/**
 * 计算字符串的 SHA256 哈希值（取前 16 位）
 */
function sha256Short(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex').substring(0, 16);
}
/**
 * 计算 system 提示词的 hash
 */
function computeSystemHash(system) {
    return sha256Short(system);
}
/**
 * 计算 history 列表的 rolling hash
 * 逐条累积：hash = sha256(hash + canonicalize(message))
 */
function computeHistoryHash(history) {
    if (history.length === 0) {
        return sha256Short('');
    }
    let rollingHash = '';
    for (const msg of history) {
        const canonical = canonicalizeMessage(msg);
        rollingHash = sha256Short(rollingHash + canonical);
    }
    return rollingHash;
}
/**
 * 计算 tools 列表的 hash
 * 1. 先按 function.name 排序
 * 2. 序列化为 canonical JSON
 * 3. 计算 SHA256
 */
function computeToolsHash(tools) {
    if (tools.length === 0) {
        return sha256Short('');
    }
    const sorted = [...tools].sort((a, b) => (a.function?.name ?? '').localeCompare(b.function?.name ?? ''));
    const canonical = JSON.stringify(sorted);
    return sha256Short(canonical);
}
/**
 * 计算完整的 HASH_KEY
 * 格式：systemHash_historyHash_toolsHash
 */
function computeHashKey(system, history, tools) {
    const systemHash = computeSystemHash(system);
    const historyHash = computeHistoryHash(history);
    const toolsHash = computeToolsHash(tools);
    return `${systemHash}_${historyHash}_${toolsHash}`;
}
/**
 * 将消息对象序列化为规范化字符串（用于 hash 计算）
 */
function canonicalizeMessage(msg) {
    // 对 content 进行规范化处理
    let content;
    if (typeof msg.content === 'string') {
        content = msg.content;
    }
    else if (Array.isArray(msg.content)) {
        // 数组格式：保持原始顺序（对话顺序敏感）
        content = msg.content;
    }
    else {
        content = msg.content ?? '';
    }
    const tool_calls = Array.isArray(msg.tool_calls)
        ? msg.tool_calls.map((tc) => ({
            index: tc.index,
            id: tc.id,
            type: tc.type,
            function: tc.function,
        }))
        : undefined;
    return JSON.stringify({ role: msg.role, content, tool_calls });
}
//# sourceMappingURL=hash.js.map