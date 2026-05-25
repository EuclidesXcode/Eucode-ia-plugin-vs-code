import * as path from 'path';
import { callAI, ToolCall } from '../services/api-client';
import { HistoryEntry, buildMessagesFromHistory, buildHistorySummary } from '../services/history-service';
import { listDirectory, readLocalFile, writeLocalFile } from '../tools/file-tools';
import { searchInWorkspace, runCommand } from '../tools/shell-tools';
import { SYSTEM_PROMPT } from './prompt';
import { TOOLS, TOOL_NAMES } from './tools-definition';
import { MAX_AGENT_STEPS } from '../utils/constants';

type Message = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string };

const toolHandlers: Record<string, (args: Record<string, any>, cwd: string, step: number, max: number, onStatus: (s: string) => void) => Promise<string>> = {
    list_directory: async (args, _cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — listando: ${path.basename(args.dirPath || '')}`);
        return listDirectory(args.dirPath || '');
    },
    read_local_file: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — lendo: ${path.basename(args.filePath || '')}`);
        return readLocalFile(args.filePath || '', cwd);
    },
    search_in_workspace: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — buscando: "${args.query}"`);
        return searchInWorkspace(args.query || '', args.dirPath || cwd);
    },
    write_local_file: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — gravando: ${path.basename(args.filePath || '')}`);
        return writeLocalFile(args.filePath || '', args.content || '', cwd);
    },
    run_command: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — executando: ${args.command}`);
        return runCommand(args.command || '', args.cwd || cwd);
    },
};

function detectEscapedToolCall(text: string): ToolCall | null {
    const match = text.match(/(\w+)\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!match || !TOOL_NAMES.has(match[1])) { return null; }
    try {
        return { function: { name: match[1], arguments: JSON.parse(`{${match[2]}}`) } };
    } catch {
        return null;
    }
}

export async function runAgentLoop(
    userPrompt: string,
    contextBlock: string,
    defaultCwd: string,
    endpoint: string,
    authHeaders: Record<string, string>,
    sessionHistory: HistoryEntry[],
    onStatus: (s: string) => void
): Promise<string> {
    const historySummary = buildHistorySummary(sessionHistory.slice(0, -1));
    const systemContent = [SYSTEM_PROMPT, historySummary, contextBlock].filter(Boolean).join('\n\n');

    const priorMessages = buildMessagesFromHistory(sessionHistory.slice(0, -1));
    const roundMessages: Message[] = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
        onStatus(`Passo ${step}/${MAX_AGENT_STEPS} — pensando...`);
        const result = await callAI(endpoint, authHeaders, roundMessages, TOOLS);

        if (!result.toolCall && result.responseText) {
            const escaped = detectEscapedToolCall(result.responseText);
            if (escaped) {
                result.toolCall = escaped;
                result.responseText = '';
            }
        }

        if (result.toolCall) {
            const { name, arguments: args } = result.toolCall.function;
            const toolCallId = result.toolCall.id || `call_${step}`;
            const handler = toolHandlers[name];
            const toolOutput = handler
                ? await handler(args as Record<string, any>, defaultCwd, step, MAX_AGENT_STEPS, onStatus)
                : `ERRO: Ferramenta "${name}" nao reconhecida.`;

            // Sequencia correta: assistant com tool_call → tool com tool_call_id
            roundMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: toolCallId,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                }],
            });
            roundMessages.push({
                role: 'tool',
                content: toolOutput,
                tool_call_id: toolCallId,
            });
        } else if (result.responseText !== undefined) {
            return result.responseText || 'Nao foi possivel obter resposta.';
        } else {
            break;
        }
    }

    return 'O agente atingiu o limite de passos. Tente uma pergunta mais especifica.';
}
