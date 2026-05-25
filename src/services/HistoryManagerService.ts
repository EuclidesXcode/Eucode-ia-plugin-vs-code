import * as vscode from 'vscode';
import { HistoryEntry } from './history-service';
import { MAX_HISTORY_ENTRIES } from '../utils/constants';

export interface Session {
    id: string;
    title: string;
    createdAt: number;
    entries: HistoryEntry[];
}

export class HistoryManagerService {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getSessionsKey(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `sessions:${root}` : 'sessions:global';
    }

    private getActiveIdKey(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `activeSession:${root}` : 'activeSession:global';
    }

    loadSessions(): Session[] {
        return this.context.globalState.get<Session[]>(this.getSessionsKey(), []);
    }

    async saveSessions(sessions: Session[]): Promise<void> {
        await this.context.globalState.update(this.getSessionsKey(), sessions);
    }

    getActiveId(): string | undefined {
        return this.context.globalState.get<string>(this.getActiveIdKey());
    }

    async setActiveId(id: string): Promise<void> {
        await this.context.globalState.update(this.getActiveIdKey(), id);
    }

    load(): HistoryEntry[] {
        const sessions = this.loadSessions();
        const activeId = this.getActiveId();
        const session = activeId ? sessions.find(s => s.id === activeId) : sessions[sessions.length - 1];
        return (session?.entries ?? []).filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    }

    async save(entries: HistoryEntry[]): Promise<void> {
        const sessions = this.loadSessions();
        const activeId = this.getActiveId();
        const idx = activeId ? sessions.findIndex(s => s.id === activeId) : -1;
        const clean = entries.slice(-MAX_HISTORY_ENTRIES);
        if (idx >= 0) {
            sessions[idx].entries = clean;
        } else {
            const newSession = this.createSession(entries);
            sessions.push(newSession);
            await this.setActiveId(newSession.id);
        }
        await this.saveSessions(sessions);
    }

    private createSession(entries: HistoryEntry[]): Session {
        const firstUser = entries.find(e => e.role === 'user');
        const title = firstUser
            ? firstUser.content.slice(0, 50).replace(/\n/g, ' ').trim()
            : 'Nova sessao';
        return { id: Date.now().toString(), title, createdAt: Date.now(), entries };
    }

    async newSession(): Promise<HistoryEntry[]> {
        const sessions = this.loadSessions();
        const session = this.createSession([]);
        sessions.push(session);
        await this.saveSessions(sessions);
        await this.setActiveId(session.id);
        return [];
    }

    async loadSession(id: string): Promise<HistoryEntry[]> {
        await this.setActiveId(id);
        return this.load();
    }

    async deleteSession(id: string): Promise<void> {
        let sessions = this.loadSessions();
        sessions = sessions.filter(s => s.id !== id);
        await this.saveSessions(sessions);
        const activeId = this.getActiveId();
        if (activeId === id) {
            const last = sessions[sessions.length - 1];
            await this.setActiveId(last?.id ?? '');
        }
    }

    append(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
        const updated = [...entries, entry];
        this.save(updated);
        return updated;
    }
}
