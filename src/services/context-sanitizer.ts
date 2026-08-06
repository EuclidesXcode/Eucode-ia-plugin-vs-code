/**
 * ContextSanitizer — camada unica de limpeza de tudo que vai para o LLM.
 *
 * Antes de qualquer output de tool (run_command, run_git, read_local_file,
 * search_in_workspace, web_search, etc.) virar uma mensagem `role: 'tool'`,
 * ele passa por aqui. O objetivo e mandar SO o contexto necessario: remover
 * ruido (ANSI, barras de progresso, linhas em branco repetidas, spinners) e,
 * quando ainda for grande demais, truncar de forma inteligente preservando o
 * que importa (erros e o fim do output, onde build/test concluem) em vez do
 * `slice(0, n)` cego que cortava no meio e descartava o erro.
 *
 * Funcoes de limpeza sao puras e testaveis (ver __tests__).
 */

import { CONTEXT_TOKEN_BUDGET } from '../utils/constants';

export type SanitizeMode = 'light' | 'aggressive';

export interface SanitizeOptions {
    /** Modo AUTO tem contexto muito mais apertado → limpeza agressiva. */
    autoMode?: boolean;
    /** Forca um modo, ignorando autoMode. Util para testes e casos especiais. */
    mode?: SanitizeMode;
    /** Orcamento de contexto (tokens) do modelo atual. Os limites de caractere
     *  por tool escalam com ele. Ausente → usa o default CONTEXT_TOKEN_BUDGET. */
    tokenBudget?: number;
}

// Limite de caracteres por tool DEPOIS da limpeza. Os valores-base foram
// calibrados para uma janela de 2048 tokens (~4 chars/token) e escalam com o
// orcamento de contexto informado em runtime (SanitizeOptions.tokenBudget):
// com uma janela maior (ex: 8192 via MLX), um arquivo lido pode ocupar mais
// caracteres sem sufocar o contexto.
const BASE_TOOL_CHAR_LIMITS: Record<string, number> = {
    list_directory:      600,
    search_in_workspace: 800,
    read_local_file:     1200,
    run_command:         800,
    run_git:             600,
    web_search:          1000,
};
const BASE_DEFAULT_LIMIT = 800;

// Fator de escala derivado do orcamento de contexto. Base = 2048 (fator 1).
// Teto de 4x para janelas grandes nao deixarem um so output dominar o prompt.
function contextScale(tokenBudget: number): number {
    return Math.min(4, Math.max(1, tokenBudget / 2048));
}
// Em modo AUTO multiplicamos o limite por isto (history budget e ~zero la).
const AUTO_LIMIT_FACTOR = 0.7;

// Regex de codigos de escape ANSI (cores, movimento de cursor) — lixo puro
// para um LLM, comum em saida colorida de jest/npm/cargo.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;?]*[A-Za-z]/g;

// Linhas de progresso/ruido de gerenciadores de pacote e ferramentas.
const PROGRESS_NOISE_RE = [
    /^\s*[█▓▒░#=>\-]+\s*\d+%/,            // barras de progresso genericas
    /\s\d+%\s*$/,                          // "... 47%"
    /^\s*(npm|yarn|pnpm)\s+(warn|notice|info)\b/i,
    /^\s*npm\s+WARN\s+deprecated/i,
    /^\s*\[?\.{3,}\]?\s*$/,                // linhas so de "..."
    /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/,                // spinners braille
    /^\s*(Downloading|Fetching|Resolving|Extracting)\b.*\d+%/i,
    /^\s*added \d+ packages?(,| in| from).*\d/i,
];

// Sinais de que uma linha e relevante (erro/falha) — preservadas com prioridade
// no truncamento de run_command.
const ERROR_SIGNAL_RE =
    /\b(error|erro|fail|failed|falhou|exception|traceback|cannot|not found|undefined|null pointer|segfault|panic|✖|✗|×|FAIL|ERR!)\b/i;

export class ContextSanitizer {
    /**
     * Ponto de entrada unico chamado pelo loop. Decide o modo, aplica a limpeza
     * generica, depois a especifica por tool, e por fim trunca se necessario.
     */
    clean(toolName: string, raw: string, opts: SanitizeOptions = {}): string {
        if (!raw) { return raw; }
        const mode: SanitizeMode = opts.mode ?? (opts.autoMode ? 'aggressive' : 'light');

        // Nao mexer em outputs que ja sao curtos status markers do proprio plugin.
        if (raw.length < 80 && /^\[(OK|ERRO|ERROR|BLOCKED|TIMEOUT)/.test(raw)) {
            return raw;
        }

        let out = this.stripGenericNoise(raw, mode);

        switch (toolName) {
            case 'run_command':         out = this.cleanCommandOutput(out, mode); break;
            case 'run_git':             out = this.cleanGitOutput(out); break;
            case 'search_in_workspace': out = this.cleanSearchOutput(out); break;
            // read_local_file / list_directory / web_search: so limpeza generica.
        }

        return this.truncate(toolName, out, mode, opts.tokenBudget ?? CONTEXT_TOKEN_BUDGET);
    }

    /** Limite efetivo de caracteres para a tool no modo dado, escalado pelo
     *  orcamento de contexto. */
    limitFor(toolName: string, mode: SanitizeMode, tokenBudget: number = CONTEXT_TOKEN_BUDGET): number {
        const scale = contextScale(tokenBudget);
        const baseRaw = BASE_TOOL_CHAR_LIMITS[toolName] ?? BASE_DEFAULT_LIMIT;
        const base = Math.round(baseRaw * scale);
        return mode === 'aggressive' ? Math.floor(base * AUTO_LIMIT_FACTOR) : base;
    }

    /**
     * Limpeza aplicada a QUALQUER output: tira ANSI, normaliza fins de linha,
     * remove trailing whitespace, colapsa linhas em branco repetidas e (em
     * modo agressivo) descarta ruido de progresso e linhas consecutivas iguais.
     */
    stripGenericNoise(raw: string, mode: SanitizeMode): string {
        let text = raw.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.split('\n');
        const result: string[] = [];
        let blankRun = 0;
        let prevLine: string | null = null;

        for (const rawLine of lines) {
            const line = rawLine.replace(/[ \t]+$/, '');

            if (line.trim() === '') {
                blankRun++;
                if (blankRun <= 1) { result.push(''); } // no maximo 1 linha em branco seguida
                continue;
            }
            blankRun = 0;

            if (mode === 'aggressive') {
                if (PROGRESS_NOISE_RE.some(re => re.test(line))) { continue; }
                // Colapsa linhas consecutivas identicas (spinners/progress repetidos).
                if (line === prevLine) { continue; }
            }

            result.push(line);
            prevLine = line;
        }

        // Remove linhas em branco do inicio/fim.
        while (result.length && result[0] === '') { result.shift(); }
        while (result.length && result[result.length - 1] === '') { result.pop(); }
        return result.join('\n');
    }

    /**
     * run_command: a saida util de build/test costuma estar no FIM (resumo de
     * pass/fail) e em linhas de erro espalhadas. Em modo agressivo, se houver
     * sinais de erro, prioriza essas linhas + as ultimas; senao mantem o fim.
     */
    cleanCommandOutput(text: string, mode: SanitizeMode): string {
        if (mode !== 'aggressive') { return text; }
        const lines = text.split('\n');
        if (lines.length <= 40) { return text; }

        const errorLines = lines.filter(l => ERROR_SIGNAL_RE.test(l));
        if (errorLines.length > 0) {
            const tail = lines.slice(-15);
            // Junta erros + cauda sem duplicar, preservando ordem da cauda.
            const tailSet = new Set(tail);
            const errOnly = errorLines.filter(l => !tailSet.has(l)).slice(0, 25);
            return [
                ...errOnly,
                '...[linhas sem erro omitidas]',
                ...tail,
            ].join('\n');
        }
        // Sem erros: o que interessa e o desfecho → mantem cauda.
        return ['...[inicio omitido]', ...lines.slice(-30)].join('\n');
    }

    /**
     * run_git: em `diff`, descarta as linhas de contexto (sem +/-) que nao
     * comecam com marcador de hunk, mantendo cabecalhos de arquivo/hunk e as
     * linhas adicionadas/removidas. Outros subcomandos passam intactos.
     */
    cleanGitOutput(text: string): string {
        const looksLikeDiff = /^diff --git /m.test(text) || /^@@ /m.test(text);
        if (!looksLikeDiff) { return text; }

        const lines = text.split('\n');
        const kept: string[] = [];
        let droppedContext = 0;
        for (const line of lines) {
            const isMeta = /^(diff --git|index |--- |\+\+\+ |@@ |new file|deleted file|rename )/.test(line);
            const isChange = /^[+\-]/.test(line) && !/^(\+\+\+|---)/.test(line);
            if (isMeta || isChange) {
                if (droppedContext > 0) { kept.push(`  …(${droppedContext} linhas de contexto)`); droppedContext = 0; }
                kept.push(line);
            } else {
                droppedContext++;
            }
        }
        if (droppedContext > 0) { kept.push(`  …(${droppedContext} linhas de contexto)`); }
        return kept.join('\n');
    }

    /**
     * search_in_workspace: deduplica linhas identicas (mesmo match aparecendo
     * varias vezes) preservando a ordem.
     */
    cleanSearchOutput(text: string): string {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const line of text.split('\n')) {
            if (seen.has(line) && line.trim() !== '') { continue; }
            seen.add(line);
            out.push(line);
        }
        return out.join('\n');
    }

    /**
     * Truncamento "smart": quando ainda passa do limite, em vez de cortar so o
     * inicio (perdendo o erro/resumo do fim), mantem HEAD + TAIL. Sempre corta
     * em limites de linha para nao quebrar JSON/stack trace no meio.
     */
    truncate(toolName: string, text: string, mode: SanitizeMode, tokenBudget: number = CONTEXT_TOKEN_BUDGET): string {
        const limit = this.limitFor(toolName, mode, tokenBudget);
        if (text.length <= limit) { return text; }

        const headBudget = Math.floor(limit * 0.6);
        const tailBudget = limit - headBudget;

        const head = this.sliceAtLineBoundary(text, headBudget, 'start');
        const tail = this.sliceAtLineBoundary(text, tailBudget, 'end');
        const omitted = text.length - head.length - tail.length;
        if (omitted <= 0) { return text.slice(0, limit); }

        return `${head}\n...[${omitted} chars no meio omitidos para economizar contexto]...\n${tail}`;
    }

    /** Corta `budget` chars do inicio ou fim, recuando ate uma quebra de linha. */
    private sliceAtLineBoundary(text: string, budget: number, from: 'start' | 'end'): string {
        if (from === 'start') {
            let slice = text.slice(0, budget);
            const nl = slice.lastIndexOf('\n');
            if (nl > budget * 0.5) { slice = slice.slice(0, nl); }
            return slice;
        } else {
            let slice = text.slice(text.length - budget);
            const nl = slice.indexOf('\n');
            if (nl !== -1 && nl < budget * 0.5) { slice = slice.slice(nl + 1); }
            return slice;
        }
    }
}

// Instancia compartilhada — sem estado mutavel, seguro reusar.
export const contextSanitizer = new ContextSanitizer();
