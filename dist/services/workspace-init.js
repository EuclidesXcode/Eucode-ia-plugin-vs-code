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
exports.EUCODE_GITIGNORE_FILENAME = exports.EUCODE_MEMORY_SUBDIR = exports.EUCODE_COMMANDS_FILENAME = exports.EUCODE_IGNORE_FILENAME = exports.EUCODE_DIR = void 0;
exports.getEucodeDir = getEucodeDir;
exports.getEucodePath = getEucodePath;
exports.ensureEucodeWorkspace = ensureEucodeWorkspace;
exports.revealEucodeDir = revealEucodeDir;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Single source of truth for all plugin files inside the workspace.
// Everything lives under .eucode/ — never scattered at the project root.
//
// Layout:
//   .eucode/
//     .gitignore          // ignores memory/ by default
//     eucodeIgnore        // user-defined globs the agent should skip
//     eucode.json         // user-defined /commands
//     memory/
//       session_<id>.json // per-session persistent memory (gitignored)
exports.EUCODE_DIR = '.eucode';
exports.EUCODE_IGNORE_FILENAME = 'eucodeIgnore';
exports.EUCODE_COMMANDS_FILENAME = 'eucode.json';
exports.EUCODE_MEMORY_SUBDIR = 'memory';
exports.EUCODE_GITIGNORE_FILENAME = '.gitignore';
const SAMPLE_IGNORE = `# Padroes que o agente Eucode IA deve ignorar (sintaxe gitignore-style)
# Linhas comecando com # sao comentarios — descomente as que quiser ativar.
#
# .env
# .env.local
# *.lock
# coverage/
# .DS_Store
`;
const SAMPLE_COMMANDS = `[
]
`;
const SAMPLE_GITIGNORE = `# Arquivos do Eucode IA que sao por-sessao/por-usuario e nao
# devem ser commitados. Edite se quiser compartilhar a memoria.
memory/
`;
// Returns the absolute path of .eucode/ for the current workspace.
function getEucodeDir() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        return null;
    }
    return path.join(root, exports.EUCODE_DIR);
}
// Resolves a file inside .eucode/ — null if no workspace open.
function getEucodePath(...segments) {
    const dir = getEucodeDir();
    if (!dir) {
        return null;
    }
    return path.join(dir, ...segments);
}
// Idempotent. Creates .eucode/ + sample files if missing. Migrates legacy
// files from the workspace root if they're still there. Safe to call on
// every chat open.
function ensureEucodeWorkspace() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        return { created: false, migrated: [], dir: null };
    }
    const dir = path.join(root, exports.EUCODE_DIR);
    const wasAlreadyThere = fs.existsSync(dir);
    const migrated = [];
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.mkdirSync(path.join(dir, exports.EUCODE_MEMORY_SUBDIR), { recursive: true });
        // .gitignore inside .eucode/ — keeps memory/ out of version control
        const gitignorePath = path.join(dir, exports.EUCODE_GITIGNORE_FILENAME);
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, SAMPLE_GITIGNORE, 'utf8');
        }
        // Migrate legacy .eucodeIgnore (workspace root) -> .eucode/eucodeIgnore
        const newIgnore = path.join(dir, exports.EUCODE_IGNORE_FILENAME);
        const legacyIgnore = path.join(root, '.eucodeIgnore');
        if (!fs.existsSync(newIgnore) && fs.existsSync(legacyIgnore)) {
            try {
                fs.renameSync(legacyIgnore, newIgnore);
                migrated.push('.eucodeIgnore');
            }
            catch {
                // Cross-volume or perms issue — copy + leave original alone
                try {
                    fs.copyFileSync(legacyIgnore, newIgnore);
                    migrated.push('.eucodeIgnore');
                }
                catch { /* give up silently */ }
            }
        }
        // Create sample only if neither old nor new exists
        if (!fs.existsSync(newIgnore)) {
            fs.writeFileSync(newIgnore, SAMPLE_IGNORE, 'utf8');
        }
        // Migrate legacy eucode.json (workspace root) -> .eucode/eucode.json
        const newCommands = path.join(dir, exports.EUCODE_COMMANDS_FILENAME);
        const legacyCommands = path.join(root, exports.EUCODE_COMMANDS_FILENAME);
        if (!fs.existsSync(newCommands) && fs.existsSync(legacyCommands)) {
            try {
                fs.renameSync(legacyCommands, newCommands);
                migrated.push('eucode.json');
            }
            catch {
                try {
                    fs.copyFileSync(legacyCommands, newCommands);
                    migrated.push('eucode.json');
                }
                catch { /* give up silently */ }
            }
        }
        if (!fs.existsSync(newCommands)) {
            fs.writeFileSync(newCommands, SAMPLE_COMMANDS, 'utf8');
        }
    }
    catch (e) {
        console.warn('[Eucode] Falha ao inicializar .eucode/:', e);
        return { created: !wasAlreadyThere, migrated, dir };
    }
    return { created: !wasAlreadyThere, migrated, dir };
}
// Opens the .eucode/ folder in the OS file explorer or in VS Code's tree.
async function revealEucodeDir() {
    const dir = getEucodeDir();
    if (!dir) {
        return;
    }
    const uri = vscode.Uri.file(dir);
    await vscode.commands.executeCommand('revealInExplorer', uri);
}
