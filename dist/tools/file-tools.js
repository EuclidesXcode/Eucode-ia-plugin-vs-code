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
exports.listDirectory = listDirectory;
exports.readLocalFile = readLocalFile;
exports.writeLocalFile = writeLocalFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../utils/constants");
const validation_1 = require("../utils/validation");
async function listDirectory(dirPath) {
    try {
        const fullPath = path.resolve(dirPath);
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const lines = [];
        for (const entry of entries) {
            if (constants_1.IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            if (entry.isDirectory()) {
                lines.push(`${entry.name}/`);
            }
            else if (!constants_1.BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) {
                lines.push(entry.name);
            }
        }
        return lines.length > 0 ? lines.join('\n') : '(pasta vazia)';
    }
    catch (e) {
        return `[ERRO] Nao foi possivel listar ${dirPath}: ${e instanceof Error ? e.message : String(e)}`;
    }
}
async function readLocalFile(filePath, workspaceRoot) {
    try {
        const fullPath = (0, validation_1.resolveFilePath)(filePath, workspaceRoot);
        return fs.readFileSync(fullPath, 'utf8');
    }
    catch (e) {
        return `[ERRO] Nao foi possivel ler ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
    }
}
async function writeLocalFile(filePath, content, workspaceRoot) {
    const validation = (0, validation_1.validateFilePath)(filePath, workspaceRoot);
    if (!validation.ok) {
        return `[ERRO] ${validation.error}`;
    }
    const fullPath = (0, validation_1.resolveFilePath)(filePath, workspaceRoot);
    try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        return `[OK] Arquivo gravado: ${fullPath}`;
    }
    catch (e) {
        return `[ERRO] Falha ao gravar "${fullPath}": ${e instanceof Error ? e.message : String(e)}`;
    }
}
