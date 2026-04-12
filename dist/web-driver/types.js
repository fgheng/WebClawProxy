"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebDriverError = exports.WebDriverErrorCode = void 0;
/**
 * Web 驱动错误类型
 */
var WebDriverErrorCode;
(function (WebDriverErrorCode) {
    WebDriverErrorCode["NOT_LOGGED_IN"] = "NOT_LOGGED_IN";
    WebDriverErrorCode["DIALOG_BLOCKED"] = "DIALOG_BLOCKED";
    WebDriverErrorCode["INVALID_SESSION_URL"] = "INVALID_SESSION_URL";
    WebDriverErrorCode["RESPONSE_TIMEOUT"] = "RESPONSE_TIMEOUT";
    WebDriverErrorCode["RESPONSE_EXTRACTION_FAILED"] = "RESPONSE_EXTRACTION_FAILED";
    WebDriverErrorCode["NEW_CONVERSATION_FAILED"] = "NEW_CONVERSATION_FAILED";
    WebDriverErrorCode["SEND_MESSAGE_FAILED"] = "SEND_MESSAGE_FAILED";
    WebDriverErrorCode["BROWSER_NOT_INITIALIZED"] = "BROWSER_NOT_INITIALIZED";
    WebDriverErrorCode["UNKNOWN_SITE"] = "UNKNOWN_SITE";
})(WebDriverErrorCode || (exports.WebDriverErrorCode = WebDriverErrorCode = {}));
/**
 * Web 驱动错误
 */
class WebDriverError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'WebDriverError';
    }
}
exports.WebDriverError = WebDriverError;
//# sourceMappingURL=types.js.map