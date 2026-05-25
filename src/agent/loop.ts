import * as path from 'path';
import * as fs from 'fs';
import { callAI, ToolCall } from '../services/api-client';
import { DEFAULT_MODEL } from '../utils/constants';
import { HistoryEntry, buildMessagesFromHistory } from '../services/history-service';
import { listDirectory, readLocalFile, writeLocalFile } from '../tools/file-tools';
import { searchInWorkspace } from '../tools/shell-tools';
import { runCommandTool } from './tools-definition';
import { SYSTEM_PROMPT } from './prompt';
import { TOOLS, TOOL_NAMES } from './tools-definition';
import { MAX_AGENT_STEPS } from '../utils/constants';
import { resolveFilePath } from '../utils/validation';

type Message = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string };

export type ConfirmWriteRequest = {
    filePath: string;
    before: string | null;
    after: string;
};

function buildToolHandlers(
    onStatus: (s: string) => void,
    onCommandOutput: (chunk: string) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>
): Record<string, (args: Record<string, any>, cwd: string, step: number, max: number) => Promise<string>> {
    return {
        list_directory: async (args, _cwd, step, max) => {
            onStatus(`Passo ${step}/${max} — listando: ${path.basename(args.dirPath || '')}`);
            return listDirectory(args.dirPath || '');
        },
        read_local_file: async (args, cwd, step, max) => {
            onStatus(`Passo ${step}/${max} — lendo: ${path.basename(args.filePath || '')}`);
            return readLocalFile(args.filePath || '', cwd);
        },
        search_in_workspace: async (args, cwd, step, max) => {
            onStatus(`Passo ${step}/${max} — buscando: "${args.query}"`);
            return searchInWorkspace(args.query || '', args.dirPath || cwd);
        },
        write_local_file: async (args, cwd, step, max) => {
            const filePath: string = args.filePath || '';
            const content: string = args.content || '';
            onStatus(`Passo ${step}/${max} — aguardando aprovacao: ${path.basename(filePath)}`);

            let before: string | null = null;
            try {
                const fullPath = resolveFilePath(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            } catch {
                before = null;
            }

            const approved = await onConfirmWrite({ filePath, before, after: content });
            if (!approved) {
                return '[CANCELADO] O usuario rejeitou a alteracao do arquivo.';
            }

            return writeLocalFile(filePath, content, cwd);
        },
        run_command: async (args, cwd, step, max) => {
            const cmd: string = args.command || '';
            onStatus(`Passo ${step}/${max} — executando: ${cmd}`);
            return new Promise<string>((resolve) => {
                const emitter = runCommandTool(cmd, args.cwd || cwd);
                let output = '';
                let isLongRunning = false;
                emitter.on('stdout', (chunk: string) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('stderr', (chunk: string) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('long_running', () => { isLongRunning = true; });
                emitter.on('done', () => {
                    if (isLongRunning) {
                        onStatus('Processo rodando — aguardando sua resposta...');
                        // Retorna para o modelo saber que o processo subiu e está rodando
                        resolve(`[PROCESSO INICIADO] O comando "${cmd}" esta rodando em background. Output ate agora:\n${output}\nO servidor esta ativo. Informe o usuario que pode interagir.`);
                    } else {
                        resolve(output || '[OK] Comando executado sem saida.');
                    }
                });
            });
        },
    };
}

function detectEscapedToolCall(text: string): ToolCall | null {
    // Formato simples: funcao({ ... })
    const simple = text.match(/(\w+)\s*\(\s*\{([^}]+)\}\s*\)/);
    if (simple && TOOL_NAMES.has(simple[1])) {
        try { return { function: { name: simple[1], arguments: JSON.parse(`{${simple[2]}}`) } }; } catch {}
    }

    // Formato JSON com tool_calls array (modelo gera como texto)
    const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonBlock ? jsonBlock[1] : text;
    try {
        const parsed = JSON.parse(jsonStr.trim());
        // { tool_calls: [{ function: { name, args } }] }
        const tc = parsed?.tool_calls?.[0];
        if (tc?.function?.name && TOOL_NAMES.has(tc.function.name)) {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : (tc.function.args || tc.function.arguments || {});
            return { id: tc.id, function: { name: tc.function.name, arguments: args } };
        }
        // { function: { name, arguments } } direto
        if (parsed?.function?.name && TOOL_NAMES.has(parsed.function.name)) {
            const args = typeof parsed.function.arguments === 'string'
                ? JSON.parse(parsed.function.arguments)
                : (parsed.function.args || parsed.function.arguments || {});
            return { function: { name: parsed.function.name, arguments: args } };
        }
    } catch {}

    // Formato <|tool_call|>call:nome{args}<|/tool_call|> ou variantes
    const tagMatch = text.match(/<\|tool_call\|>call:(\w+)\{([^}]*)\}<\|\/tool_call\|>/);
    if (tagMatch && TOOL_NAMES.has(tagMatch[1])) {
        try {
            // args no formato key:<|"value"|>
            const rawArgs = tagMatch[2].replace(/<\|"([^"]*)"\|>/g, '"$1"');
            return { function: { name: tagMatch[1], arguments: JSON.parse(`{${rawArgs}}`) } };
        } catch {}
        // tenta extrair command diretamente
        const cmdMatch = tagMatch[2].match(/"command"\s*:\s*"([^"]+)"/);
        if (cmdMatch) {
            return { function: { name: tagMatch[1], arguments: { command: cmdMatch[1] } } };
        }
    }

    return null;
}

export async function runAgentLoop(
    userPrompt: string,
    contextBlock: string,
    defaultCwd: string,
    endpoint: string,
    authHeaders: Record<string, string>,
    sessionHistory: HistoryEntry[],
    onStatus: (s: string) => void,
    onCommandOutput: (chunk: string) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>,
    model: string = DEFAULT_MODEL
): Promise<string> {
    const systemContent = [SYSTEM_PROMPT, contextBlock].filter(Boolean).join('\n\n');
    const priorMessages = buildMessagesFromHistory(sessionHistory.slice(0, -1));
    const roundMessages: Message[] = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];

    const toolHandlers = buildToolHandlers(onStatus, onCommandOutput, onConfirmWrite);

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
        onStatus(`Passo ${step}/${MAX_AGENT_STEPS} — pensando...`);
        const result = await callAI(endpoint, authHeaders, roundMessages, TOOLS, model);

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
                ? await handler(args as Record<string, any>, defaultCwd, step, MAX_AGENT_STEPS)
                : `ERRO: Ferramenta "${name}" nao reconhecida.`;

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
