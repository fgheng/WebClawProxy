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
exports.resolvePromptRefsInValue = resolvePromptRefsInValue;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PROMPT_REF_RE = /\[\[([^[\]\r\n]+)\]\]/g;
function resolvePromptRefsInValue(value, promptsRoot) {
    return resolveDeep(value, {
        promptsRoot,
        stack: [],
    });
}
function resolveDeep(value, context) {
    if (typeof value === 'string') {
        return resolvePromptRefsInString(value, context);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveDeep(item, context));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveDeep(val, context)]));
    }
    return value;
}
function resolvePromptRefsInString(input, context) {
    return input.replace(PROMPT_REF_RE, (_whole, rawRef) => {
        const ref = rawRef.trim();
        if (!ref)
            return '';
        const absolute = path.resolve(context.promptsRoot, ref);
        if (!isPathInsideRoot(absolute, context.promptsRoot)) {
            throw new Error(`提示词引用越界: [[${ref}]]，仅允许引用 prompts 目录内文件`);
        }
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            throw new Error(`提示词文件不存在: [[${ref}]] -> ${absolute}`);
        }
        if (context.stack.includes(absolute)) {
            const chain = [...context.stack, absolute].map((item) => path.relative(context.promptsRoot, item)).join(' -> ');
            throw new Error(`提示词引用存在循环: ${chain}`);
        }
        const content = fs.readFileSync(absolute, 'utf-8');
        return resolvePromptRefsInString(content, {
            promptsRoot: context.promptsRoot,
            stack: [...context.stack, absolute],
        });
    });
}
function isPathInsideRoot(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
//# sourceMappingURL=prompt-loader.js.map