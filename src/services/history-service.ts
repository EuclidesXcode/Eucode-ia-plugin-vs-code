import * as fs from 'fs';
import * as path from 'path';
import { MAX_HISTORY_ENTRIES as MAX_ENTRIES, MAX_HISTORY_PAIRS } from '../utils/constants';

export interface HistoryEntry {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    hasImage?: boolean;
    imageSummary?: string;
}

const HISTORY_FILE = path.join(process.env.HOME || '/tmp', '.eucode-ia-history.json');

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadHistory(): HistoryEntry[] {
    try {
        const all = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) as HistoryEntry[];
        // Remove entradas de erro que foram persistidas em sessoes anteriores
        return all.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    } catch {
        return [];
    }
}

function scheduleSave(entries: HistoryEntry[]): void {
    if (saveTimer) { clearTimeout(saveTimer); }
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(-MAX_ENTRIES)), 'utf8');
        } catch (e) {
            console.error('[History] Falha ao salvar:', e);
        }
        saveTimer = null;
    }, 500);
}

export function appendEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
    const updated = [...entries, entry];
    scheduleSave(updated);
    return updated;
}

export function buildMessagesFromHistory(
    entries: HistoryEntry[],
    maxPairs: number = MAX_HISTORY_PAIRS
): { role: string; content: string }[] {
    // Filtra entradas de erro para nao contaminar o contexto do modelo
    const BAD_PREFIXES = ['ERRO DE CONEXAO', 'Nao foi possivel obter resposta', 'O agente atingiu o limite'];
    const clean = entries.filter(e => !BAD_PREFIXES.some(p => e.content.startsWith(p)));
    return clean.slice(-maxPairs * 2).map(e => {
        if (e.hasImage && e.imageSummary) {
            return {
                role: e.role,
                content: e.role === 'user'
                    ? `[Usuario enviou uma imagem. Analise anterior: ${e.imageSummary}]\n${e.content}`
                    : e.content,
            };
        }
        return { role: e.role, content: e.content };
    });
}

export function buildHistorySummary(entries: HistoryEntry[]): string {
    if (entries.length === 0) { return ''; }

    const lines = entries.slice(-20).map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const prefix = e.role === 'user' ? 'Dev' : 'Eucode';
        const snippet = e.content.slice(0, 120).replace(/\n/g, ' ');
        const imgNote = e.hasImage ? ' [imagem]' : '';
        return `[${time}] ${prefix}${imgNote}: ${snippet}${e.content.length > 120 ? '...' : ''}`;
    });

    return `# HISTORICO RECENTE DA SESSAO\n${lines.join('\n')}`;
}
