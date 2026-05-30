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
exports.editLocalFile = editLocalFile;
exports.writeLocalFile = writeLocalFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../utils/constants");
const validation_1 = require("../utils/validation");
const ignore_1 = require("../utils/ignore");
async function listDirectory(dirPath, workspaceRoot) {
    try {
        const fullPath = path.resolve(dirPath);
        const root = workspaceRoot || fullPath;
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const lines = [];
        for (const entry of entries) {
            const relPath = path.relative(root, path.join(fullPath, entry.name));
            if ((0, ignore_1.isIgnored)(entry.name, relPath, root)) {
                continue;
            }
            if (entry.isDirectory()) {
                lines.push(`${entry.name}/`);
            }
            else {
                const ext = path.extname(entry.name).toLowerCase();
                if (!constants_1.BINARY_EXTS.has(ext)) {
                    lines.push(entry.name);
                }
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
async function editLocalFile(filePath, oldString, newString, workspaceRoot) {
    const fullPath = (0, validation_1.resolveFilePath)(filePath, workspaceRoot);
    let current;
    try {
        current = fs.readFileSync(fullPath, 'utf8');
    }
    catch (e) {
        return `[ERRO] Nao foi possivel ler "${filePath}": ${e instanceof Error ? e.message : String(e)}`;
    }
    const count = current.split(oldString).length - 1;
    if (count === 0) {
        // Show the first 200 chars of the file to help the model match
        const preview = current.slice(0, 200).replace(/\n/g, '\\n');
        return `[ERROR] old_string not found in "${path.basename(filePath)}". The text must match EXACTLY (whitespace, line breaks, quotes). File starts with: "${preview}...". To fix: call read_local_file first to get the exact current content, then retry edit_file with a string that exists literally in the file. Or use write_local_file to replace the entire file.`;
    }
    if (count > 1) {
        return `[ERROR] old_string appears ${count} times in "${path.basename(filePath)}". Provide a more specific and unique string — include surrounding lines (function signature, neighboring statements) to make it unique.`;
    }
    const updated = current.replace(oldString, newString);
    try {
        fs.writeFileSync(fullPath, updated, 'utf8');
        const oldLines = oldString.split('\n').length;
        const newLines = newString.split('\n').length;
        return `[OK] "${path.basename(filePath)}" edited: -${oldLines} line(s), +${newLines} line(s).`;
    }
    catch (e) {
        return `[ERRO] Falha ao gravar "${fullPath}": ${e instanceof Error ? e.message : String(e)}`;
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
