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
    getSessionsKey() {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `sessions:${root}` : 'sessions:global';
    }
    getActiveIdKey() {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `activeSession:${root}` : 'activeSession:global';
    }
    loadSessions() {
        return this.context.globalState.get(this.getSessionsKey(), []);
    }
    async saveSessions(sessions) {
        await this.context.globalState.update(this.getSessionsKey(), sessions);
    }
    getActiveId() {
        return this.context.globalState.get(this.getActiveIdKey());
    }
    async setActiveId(id) {
        await this.context.globalState.update(this.getActiveIdKey(), id);
    }
    load() {
        const sessions = this.loadSessions();
        const activeId = this.getActiveId();
        const session = activeId ? sessions.find(s => s.id === activeId) : sessions[sessions.length - 1];
        return (session?.entries ?? []).filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    }
    async save(entries) {
        const sessions = this.loadSessions();
        const activeId = this.getActiveId();
        const idx = activeId ? sessions.findIndex(s => s.id === activeId) : -1;
        const clean = entries.slice(-constants_1.MAX_HISTORY_ENTRIES);
        if (idx >= 0) {
            sessions[idx].entries = clean;
        }
        else {
            const newSession = this.createSession(entries);
            sessions.push(newSession);
            await this.setActiveId(newSession.id);
        }
        await this.saveSessions(sessions);
    }
    createSession(entries) {
        const firstUser = entries.find(e => e.role === 'user');
        const title = firstUser
            ? firstUser.content.slice(0, 50).replace(/\n/g, ' ').trim()
            : 'Nova sessao';
        return { id: Date.now().toString(), title, createdAt: Date.now(), entries };
    }
    async newSession() {
        const sessions = this.loadSessions();
        const session = this.createSession([]);
        sessions.push(session);
        await this.saveSessions(sessions);
        await this.setActiveId(session.id);
        return [];
    }
    async loadSession(id) {
        await this.setActiveId(id);
        return this.load();
    }
    async deleteSession(id) {
        let sessions = this.loadSessions();
        sessions = sessions.filter(s => s.id !== id);
        await this.saveSessions(sessions);
        const activeId = this.getActiveId();
        if (activeId === id) {
            const last = sessions[sessions.length - 1];
            await this.setActiveId(last?.id ?? '');
        }
    }
    append(entries, entry) {
        const updated = [...entries, entry];
        this.save(updated);
        return updated;
    }
}
exports.HistoryManagerService = HistoryManagerService;
