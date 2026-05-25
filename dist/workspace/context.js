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
exports.collectWorkspaceContext = collectWorkspaceContext;
exports.getDefaultCwd = getDefaultCwd;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const constants_1 = require("../utils/constants");
function collectWorkspaceContext() {
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const openFiles = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const uri = tab.input?.uri;
            if (!uri) {
                continue;
            }
            if (constants_1.BINARY_EXTS.has(path.extname(uri.fsPath).toLowerCase())) {
                continue;
            }
            openFiles.push({
                name: path.basename(uri.fsPath),
                path: vscode.workspace.asRelativePath(uri.fsPath),
            });
        }
    }
    const validRoots = roots.filter(r => r !== '/' && r !== 'C:\\' && r.length > 3);
    const defaultRoot = validRoots[0] ?? roots[0] ?? '/tmp';
    let contextBlock = '';
    if (validRoots.length === 0) {
        contextBlock = `# WORKSPACE\nNenhum projeto aberto no VS Code. Informe o usuario que ele precisa abrir uma pasta de projeto (File > Open Folder) antes de continuar.`;
    }
    else {
        contextBlock = `# WORKSPACE\nPastas raiz: ${validRoots.join(', ')}\n`;
        if (openFiles.length > 0) {
            contextBlock += `Arquivos abertos: ${openFiles.map(f => f.path).join(', ')}\n`;
        }
        contextBlock += `\nRegras para criar/editar arquivos:\n- Sempre use caminhos ABSOLUTOS no filePath, ex: ${defaultRoot}/nome.ts\n- Nunca use caminhos relativos ou vazios.\n- Para entender a estrutura: use list_directory, read_local_file, search_in_workspace.`;
    }
    return { roots, openFiles, contextBlock };
}
function getDefaultCwd(roots) {
    // Ignora raiz do sistema operacional — só aceita pastas reais de projeto
    const valid = roots.filter(r => r !== '/' && r !== 'C:\\' && r.length > 3);
    return valid[0] ?? roots[0] ?? '/tmp';
}
