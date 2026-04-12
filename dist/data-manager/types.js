"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataManagerError = exports.DataManagerErrorCode = void 0;
/**
 * 数据管理模块错误
 */
var DataManagerErrorCode;
(function (DataManagerErrorCode) {
    DataManagerErrorCode["HASH_COMPUTE_ERROR"] = "HASH_COMPUTE_ERROR";
    DataManagerErrorCode["DIRECTORY_CREATE_ERROR"] = "DIRECTORY_CREATE_ERROR";
    DataManagerErrorCode["FILE_READ_ERROR"] = "FILE_READ_ERROR";
    DataManagerErrorCode["FILE_WRITE_ERROR"] = "FILE_WRITE_ERROR";
    DataManagerErrorCode["MODEL_NOT_FOUND"] = "MODEL_NOT_FOUND";
    DataManagerErrorCode["DATA_PATH_NOT_INITIALIZED"] = "DATA_PATH_NOT_INITIALIZED";
})(DataManagerErrorCode || (exports.DataManagerErrorCode = DataManagerErrorCode = {}));
class DataManagerError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'DataManagerError';
    }
}
exports.DataManagerError = DataManagerError;
//# sourceMappingURL=types.js.map