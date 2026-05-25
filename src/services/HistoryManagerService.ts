import * as vscode from 'vscode';
import { HistoryEntry } from './history-service';
import { MAX_HISTORY_ENTRIES } from '../utils/constants';

export class HistoryManagerService {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getKey(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return root ? `history:${root}` : 'history:global';
    }

    load(): HistoryEntry[] {
        const raw = this.context.globalState.get<HistoryEntry[]>(this.getKey(), []);
        return raw.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    }

    async save(entries: HistoryEntry[]): Promise<void> {
        await this.context.globalState.update(this.getKey(), entries.slice(-MAX_HISTORY_ENTRIES));
    }

    append(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
        const updated = [...entries, entry];
        this.save(updated);
        return updated;
    }

    getWorkspaceKey(): string {
        return this.getKey();
    }
}
