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
exports.collectDiagnostics = collectDiagnostics;
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
        contextBlock = `# WORKSPACE\nNo project open in VS Code. Tell the user they need to open a project folder (File > Open Folder) before continuing.`;
    }
    else {
        contextBlock = `# WORKSPACE\nRoot folders: ${validRoots.join(', ')}\n`;
        if (openFiles.length > 0) {
            contextBlock += `Open files: ${openFiles.map(f => f.path).join(', ')}\n`;
        }
        contextBlock += `\nRules for creating/editing files:\n- Always use ABSOLUTE paths in filePath, e.g.: ${defaultRoot}/name.ts\n- Never use relative or empty paths.\n- To understand the structure: use list_directory, read_local_file, search_in_workspace.`;
    }
    return { roots, openFiles, contextBlock };
}
function getDefaultCwd(roots) {
    const valid = roots.filter(r => r !== '/' && r !== 'C:\\' && r.length > 3);
    return valid[0] ?? roots[0] ?? '/tmp';
}
function collectDiagnostics() {
    const all = vscode.languages.getDiagnostics();
    const lines = [];
    for (const [uri, diags] of all) {
        const rel = vscode.workspace.asRelativePath(uri.fsPath);
        for (const d of diags) {
            if (d.severity !== vscode.DiagnosticSeverity.Error && d.severity !== vscode.DiagnosticSeverity.Warning) {
                continue;
            }
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
            const line = d.range.start.line + 1;
            const col = d.range.start.character + 1;
            lines.push(`[${sev}] ${rel}:${line}:${col} — ${d.message}`);
            if (lines.length >= 30) {
                break;
            }
        }
        if (lines.length >= 30) {
            break;
        }
    }
    if (lines.length === 0) {
        return '';
    }
    return `# EDITOR DIAGNOSTICS\n${lines.join('\n')}`;
}
