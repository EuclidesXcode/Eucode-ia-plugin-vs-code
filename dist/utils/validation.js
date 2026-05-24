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
exports.validateFilePath = validateFilePath;
exports.resolveFilePath = resolveFilePath;
exports.isToolArgString = isToolArgString;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function validateFilePath(filePath, workspaceRoot) {
    if (!filePath || filePath.trim() === '') {
        const hint = workspaceRoot ?? '/tmp';
        return { ok: false, error: `filePath vazio. Use um caminho absoluto, ex: ${hint}/nome.ts` };
    }
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot ?? '/tmp', filePath);
    if (!path.extname(fullPath)) {
        return {
            ok: false,
            error: `filePath sem extensao — parece ser um diretorio: "${fullPath}". Informe o nome completo incluindo extensao, ex: ${fullPath}/index.ts`,
        };
    }
    try {
        if (fs.statSync(fullPath).isDirectory()) {
            return {
                ok: false,
                error: `"${fullPath}" e um diretorio. Informe o nome completo do arquivo, ex: ${fullPath}/index.ts`,
            };
        }
    }
    catch {
        // path does not exist yet — valid for writes
    }
    return { ok: true };
}
function resolveFilePath(filePath, workspaceRoot) {
    return path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot ?? '/tmp', filePath);
}
function isToolArgString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        return { ok: false, error: `Argumento "${name}" deve ser uma string nao vazia.` };
    }
    return { ok: true };
}
