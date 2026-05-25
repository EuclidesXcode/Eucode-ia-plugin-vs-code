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
exports.HistoryManagerService = void 0;
const vscode = __importStar(require("vscode"));
const constants_1 = require("../utils/constants");
class HistoryManagerService {
    constructor(context) {
        this.context = context;
    }
    getKey() {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `history:${root}` : 'history:global';
    }
    load() {
        const raw = this.context.globalState.get(this.getKey(), []);
        return raw.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    }
    async save(entries) {
        await this.context.globalState.update(this.getKey(), entries.slice(-constants_1.MAX_HISTORY_ENTRIES));
    }
    append(entries, entry) {
        const updated = [...entries, entry];
        this.save(updated);
        return updated;
    }
    getWorkspaceKey() {
        return this.getKey();
    }
}
exports.HistoryManagerService = HistoryManagerService;
