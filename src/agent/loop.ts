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

// Extrai nomes de funções, classes, exports e variáveis exportadas de um bloco de código
function extractSymbols(code: string): string[] {
    const patterns = [
        /^export\s+(?:async\s+)?function\s+(\w+)/gm,
        /^export\s+(?:const|let|var)\s+(\w+)/gm,
        /^export\s+class\s+(\w+)/gm,
        /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?class\s+(\w+)/gm,
    ];
    const symbols = new Set<string>();
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            if (match[1] && match[1].length > 2) { symbols.add(match[1]); }
        }
    }
    return Array.from(symbols);
}

async function checkRemovedSymbols(before: string, after: string, cwd: string): Promise<string[]> {
    const beforeSymbols = extractSymbols(before);
    const afterSymbols = new Set(extractSymbols(after));

    // Símbolos que existiam antes mas não existem mais no novo conteúdo
    const removed = beforeSymbols.filter(s => !afterSymbols.has(s));
    if (removed.length === 0) { return []; }

    const warnings: string[] = [];
    for (const symbol of removed) {
        const result = await searchInWorkspace(symbol, cwd);
        // Se encontrou referências (além do próprio arquivo sendo editado)
        if (result && !result.startsWith('[ERRO]') && result.trim().length > 0) {
            warnings.push(`  - "${symbol}" — referencias encontradas:\n${result.split('\n').slice(0, 3).map(l => '    ' + l).join('\n')}`);
        }
    }
    return warnings;
}

function buildToolHandlers(
    onStatus: (s: string) => void,
    onCommandStart: (cmd: string) => void,
    onCommandOutput: (chunk: string) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>,
    autoMode: boolean,
    filesReadThisRound: Set<string>
): Record<string, (args: Record<string, any>, cwd: string, step: number, max: number) => Promise<string>> {
    return {
        list_directory: async (args, cwd, _step, _max) => {
            const dir = args.dirPath || args.path || cwd;
            onStatus(`Lendo estrutura: ${path.basename(dir)}`);
            return listDirectory(dir);
        },
        read_local_file: async (args, cwd, _step, _max) => {
            const fp: string = args.filePath || '';
            onStatus(`Lendo arquivo: ${path.basename(fp)}`);
            filesReadThisRound.add(path.resolve(cwd, fp));
            return readLocalFile(fp, cwd);
        },
        search_in_workspace: async (args, cwd, _step, _max) => {
            onStatus(`Buscando no projeto: "${args.query}"`);
            return searchInWorkspace(args.query || '', args.dirPath || cwd);
        },
        write_local_file: async (args, cwd, _step, _max) => {
            const filePath: string = args.filePath || '';
            const content: string = args.content || '';

            let before: string | null = null;
            try {
                const fullPath = resolveFilePath(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            } catch {
                before = null;
            }

            // Se o arquivo já existe e o modelo não o leu nessa rodada, force a leitura antes
            if (before !== null) {
                const fullPath = resolveFilePath(filePath, cwd);
                if (!filesReadThisRound.has(fullPath)) {
                    return `[OBRIGATORIO] Voce tentou editar "${path.basename(filePath)}" sem ter lido o conteudo atual. Chame read_local_file("${filePath}") primeiro para preservar o conteudo existente, depois chame write_local_file com o conteudo completo e acumulado.`;
                }
            }

            // Detecta símbolos removidos que não são substituídos no novo conteúdo
            if (before) {
                const warnings = await checkRemovedSymbols(before, content, cwd);
                if (warnings.length > 0) {
                    // Retorna aviso para o modelo reconsiderar antes de escrever
                    return `[ATENCAO] Os seguintes simbolos serao removidos e foram encontrados em outros arquivos:\n${warnings.join('\n')}\n\nSe a remocao for intencional como substituicao, chame write_local_file novamente com confirmacao explicita no campo content iniciando com "// REMOCAO_CONFIRMADA". Caso contrario, revise o conteudo para preservar esses simbolos.`;
                }
            }

            if (autoMode) {
                onStatus(`Escrevendo: ${path.basename(filePath)}`);
                return writeLocalFile(filePath, content, cwd);
            }

            onStatus(`Aguardando aprovacao: ${path.basename(filePath)}`);
            const approved = await onConfirmWrite({ filePath, before, after: content });
            if (!approved) {
                return '[CANCELADO] O usuario rejeitou a alteracao do arquivo.';
            }

            return writeLocalFile(filePath, content, cwd);
        },
        run_command: async (args, cwd, _step, _max) => {
            const cmd: string = args.command || '';
            onStatus(`Executando: ${cmd}`);
            onCommandStart(cmd);
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

const PENDING_ACTION_PATTERNS = [
    // Intenção futura — PT
    /vou criar/i, /vou escrever/i, /vou gerar/i, /vou adicionar/i,
    /vou implementar/i, /vou modificar/i, /vou editar/i, /vou atualizar/i,
    /vou executar/i, /vou rodar/i, /vou instalar/i, /vou fazer/i,
    /vou refatorar/i, /vou corrigir/i, /vou ajustar/i, /vou focar/i,
    /vou usar/i, /vou aplicar/i, /vou tentar/i, /vou verificar/i,
    /agora vou/i, /agora crio/i, /agora escrevo/i, /agora corrijo/i,
    /a seguir vou/i, /em seguida vou/i, /enquanto isso/i,
    /criando o arquivo/i, /escrevendo o arquivo/i, /refatorando/i,
    // Modelo afirmou ter feito sem usar ferramenta — PT
    /criei o arquivo/i, /arquivo foi criado/i, /arquivo criado/i,
    /escrevi o arquivo/i, /gravei o arquivo/i,
    /criei o mock/i, /gerei o arquivo/i,
    /eu removi/i, /removi os/i, /apaguei os/i, /deletei os/i,
    /eu criei/i, /eu escrevi/i, /eu atualizei/i, /eu modifiquei/i,
    /eu executei/i, /executei os testes/i, /rodei os testes/i,
    /testes passaram/i, /testes foram executados/i,
    /atualizei o/i, /modifiquei o/i, /corrigi o/i,
    // Inglês
    /i will create/i, /i will write/i, /i will now/i, /i'll create/i, /i'll write/i,
    /i have created/i, /i've created/i, /i have written/i, /file has been created/i,
    /i will refactor/i, /i will fix/i, /i will update/i,
    /i removed/i, /i deleted/i, /i updated/i, /i modified/i,
    /i ran the tests/i, /tests passed/i, /i executed/i,
];

function detectsPendingAction(text: string, autoMode = false): boolean {
    // Em modo auto verifica o texto inteiro — o modelo pode mentir em qualquer parte
    const toCheck = autoMode
        ? text
        : text.split('\n').filter(l => l.trim()).slice(-6).join(' ');
    return PENDING_ACTION_PATTERNS.some(p => p.test(toCheck));
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
    onCommandStart: (cmd: string) => void,
    onCommandOutput: (chunk: string) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>,
    model: string = DEFAULT_MODEL,
    autoMode: boolean = false,
    signal?: AbortSignal,
    onInjectMessage?: (handler: (msg: string) => void) => void
): Promise<string> {
    const autoBlock = autoMode
        ? `\nMODO AUTOMATICO ATIVO: Escreva arquivos diretamente sem pedir confirmacao. Apos cada escrita, rode os testes do projeto automaticamente com run_command. Se os testes falharem, corrija o codigo e rode os testes de novo. Repita ate todos os testes passarem ou atingir o limite de tentativas.`
        : '';
    const systemContent = [SYSTEM_PROMPT + autoBlock, contextBlock].filter(Boolean).join('\n\n');
    const priorMessages = buildMessagesFromHistory(sessionHistory.slice(0, -1));
    const roundMessages: Message[] = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];

    // Fila de mensagens injetadas pelo usuário durante a execução
    let injectedMessage: string | null = null;
    if (onInjectMessage) {
        onInjectMessage((msg) => { injectedMessage = msg; });
    }

    const filesReadThisRound = new Set<string>();
    const toolHandlers = buildToolHandlers(onStatus, onCommandStart, onCommandOutput, onConfirmWrite, autoMode, filesReadThisRound);

    const thinkingStatus = [
        'Analisando sua solicitacao...',
        'Processando contexto do projeto...',
        'Elaborando solucao...',
        'Revisando o codigo...',
        'Verificando dependencias...',
        'Planejando proximos passos...',
        'Gerando resposta...',
    ];

    let lastToolName = '';
    const maxSteps = autoMode ? 200 : MAX_AGENT_STEPS;
    let step = 0;

    while (++step <= maxSteps) {
        // Verifica abort
        if (signal?.aborted) { return '[INTERROMPIDO] Execucao cancelada pelo usuario.'; }

        // Verifica mensagem injetada — insere no contexto e continua
        if (injectedMessage) {
            const msg = injectedMessage;
            injectedMessage = null;
            roundMessages.push({ role: 'user', content: `[USUARIO INTERROMPEU]: ${msg}` });
            lastToolName = '';
        }
        const statusAfterTool: Record<string, string> = {
            list_directory:    'Analisando estrutura do projeto...',
            read_local_file:   'Processando arquivo lido...',
            search_in_workspace: 'Analisando resultados da busca...',
            write_local_file:  'Elaborando proxima acao...',
            run_command:       'Analisando output do comando...',
        };
        const thinking = lastToolName && statusAfterTool[lastToolName]
            ? statusAfterTool[lastToolName]
            : thinkingStatus[step % thinkingStatus.length];
        onStatus(thinking);

        const result = await callAI(endpoint, authHeaders, roundMessages, TOOLS, model, signal);

        if (result.responseText === '__ABORTED__') {
            return '[INTERROMPIDO] Execucao cancelada pelo usuario.';
        }

        if (!result.toolCall && result.responseText) {
            const escaped = detectEscapedToolCall(result.responseText);
            if (escaped) {
                result.toolCall = escaped;
                result.responseText = '';
            }
        }

        if (result.toolCall) {
            const { name, arguments: args } = result.toolCall.function;
            lastToolName = name;
            // Reseta o contador a cada tool call para que tarefas longas não estourem o limite
            if (autoMode) { step = 1; }
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
            const text = result.responseText || '';

            // Modelo retornou vazio após uma tool call — empurra para continuar
            if (!text && lastToolName) {
                roundMessages.push({ role: 'assistant', content: 'continue' });
                roundMessages.push({ role: 'user', content: 'Continue analisando e responda ao usuario com base nos dados coletados.' });
                lastToolName = '';
                continue;
            }

            if (text && detectsPendingAction(text, autoMode)) {
                // Modelo anunciou ou fingiu ter feito algo sem chamar a ferramenta — empurra de volta
                roundMessages.push({ role: 'assistant', content: text });
                roundMessages.push({
                    role: 'user',
                    content: autoMode
                        ? 'Voce descreveu acoes mas nao executou nenhuma ferramenta. Use write_local_file, run_command ou outra ferramenta agora. Nao descreva — execute.'
                        : 'continue',
                });
                lastToolName = '';
                continue;
            }
            return text || 'Nao foi possivel obter resposta.';
        } else {
            break;
        }
    }

    return 'O agente atingiu o limite de passos. Tente uma pergunta mais especifica.';
}
