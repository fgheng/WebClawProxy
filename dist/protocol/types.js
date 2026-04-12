"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolParseError = exports.ProtocolType = void 0;
/**
 * 协议类型枚举
 */
var ProtocolType;
(function (ProtocolType) {
    ProtocolType["OPENAI"] = "openai";
    ProtocolType["ANTHROPIC"] = "anthropic";
    ProtocolType["GEMINI"] = "gemini";
    ProtocolType["LLAMA"] = "llama";
})(ProtocolType || (exports.ProtocolType = ProtocolType = {}));
/**
 * 协议解析错误
 */
class ProtocolParseError extends Error {
    constructor(protocol, message, cause) {
        super(message);
        this.protocol = protocol;
        this.cause = cause;
        this.name = 'ProtocolParseError';
    }
}
exports.ProtocolParseError = ProtocolParseError;
//# sourceMappingURL=types.js.map