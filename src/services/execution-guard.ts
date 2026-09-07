// Centralized execution guards & invariants for the agent loop.
//
// The loop has many "common failure modes" of small LLMs that historically
// were handled inline with ad-hoc booleans (lastCommandFailed, dumpedInChat,
// wrongFileEdit, etc). This service consolidates them so they're testable,
// reusable, and easy to extend without touching loop.ts every time.
//
// Each guard is a pure function that takes the current execution state and
// returns either null (no intervention) or a NudgeResult describing what
// corrective message to inject and why.

export interface ToolCallRecord {
    name: string;
    args: Record<string, unknown>;
    output: string;
    success: boolean;
    timestamp: number;
}

export interface ExecutionState {
    userPrompt: string;
    autoMode: boolean;
    hybridActive: boolean;
    toolCalls: ToolCallRecord[];        // chronological history of this round
    filesWritten: number;
    filesRead: number;
    lastBuildPassed: boolean;
    lastCommandFailed: boolean;
    lastErrorFiles: string[];
    lastEditedFile: string;
    lastModelText: string;              // most recent non-tool response text
    pendingActionStreak: number;
    emptyResponseStreak: number;
}

export interface NudgeResult {
    severity: 'info' | 'warn' | 'critical';
    reason: string;                     // machine-readable id for telemetry
    message: string;                    // text injected as user message
    requireHybridIfAvailable: boolean;  // suggests calling the paid model
}

// Words that, when present in the user prompt, indicate a build/package task.
const BUILD_KEYWORDS = /\b(build|compile|package|deploy|vsix|release|marketplace|gerar versao|publish)\b/i;

// Tool name patterns that count as "build" for the guard.
const BUILD_COMMAND_RE = /\b(build|compile|package|tsc|vsce|webpack|rollup|esbuild|jest|vitest|pytest|cargo build|go build|mvn|gradle|npm run)\b/i;

// Model denying it has tool/terminal/filesystem access — wrong whenever DEV
// mode is active (the real tool schema always goes in the request). Exported
// so loop.ts can gate entry into the nudge branch on it too, not just the
// guard's own message selection — see checkCapabilityDenial below.
export function detectsCapabilityDenial(text: string): boolean {
    return /n[ãa]o ten(ho|ho eu)\s+acesso\s+(direto\s+)?(a|ao|à|aos|às)?\s*(terminal|sistema de arquivos|arquivos do (seu|este) computador|seu computador)/i.test(text)
        || /n[ãa]o posso executar comandos?\s+(diretamente|no (seu|este) computador)?/i.test(text)
        || /n[ãa]o tenho a capacidade de (executar|acessar|rodar)/i.test(text)
        || /i (don't|do not) have (direct\s+)?access to (your|the) (terminal|file ?system|computer)/i.test(text)
        || /i (cannot|can't) execute commands? (directly|on your (computer|machine))?/i.test(text);
}

export class ExecutionGuardService {
    private repeatedCallCount = new Map<string, number>();
    // Streak-tracking for checkRepeatedText — has to survive across evaluate()
    // calls that pick a DIFFERENT guard as the winner, so it can't live as a
    // local inside that method: it's updated unconditionally in evaluate()
    // itself (see comment there) rather than short-circuited by the ||-chain.
    private lastText = '';
    private textRepeatCount = 0;

    // Records a tool call so subsequent guards can see history.
    track(state: ExecutionState, call: ToolCallRecord): void {
        state.toolCalls.push(call);
        const sig = call.name + ':' + JSON.stringify(call.args);
        this.repeatedCallCount.set(sig, (this.repeatedCallCount.get(sig) || 0) + 1);
    }

    // Returns the highest-severity guard that applies, or null. Order
    // matters — checked from most-specific to most-generic.
    evaluate(state: ExecutionState): NudgeResult | null {
        // checkRepeatedText mutates streak state — called unconditionally
        // (not as part of the ||-chain below) so its bookkeeping never gets
        // skipped just because a different guard ends up winning this call.
        const repeatedTextResult = this.checkRepeatedText(state);
        return this.checkCapabilityDenial(state)
            || repeatedTextResult
            || this.checkDumpedCodeInChat(state)
            || this.checkWrongFileEdit(state)
            || this.checkBuildPendingButNoCommand(state)
            || this.checkLastCommandFailed(state)
            || this.checkBuildNotYetPassed(state)
            || this.checkModelPlanning(state);
    }

    // ── Individual guards ─────────────────────────────────────────────

    // Model claims it has no tool/terminal/filesystem access ("como sou uma
    // IA, nao tenho acesso ao terminal do seu computador") even though DEV
    // mode always sends the real tool schema. Once this kind of refusal is
    // produced once and saved to session history, it tends to self-reinforce
    // — the model imitates its own prior turn on every later message, even
    // after the user insists it does have access. Checked first (before
    // model_planning) and NOT gated on autoMode: this is wrong in any mode
    // where tools exist, not just an AUTO continuation problem.
    private checkCapabilityDenial(state: ExecutionState): NudgeResult | null {
        if (!detectsCapabilityDenial(state.lastModelText)) { return null; }
        return {
            severity: 'critical',
            reason: 'capability_denial',
            message: 'Você TEM acesso a ferramentas reais neste ambiente (run_command, read_local_file, write_local_file, edit_file, list_directory e outras — vieram no schema desta mensagem). Não é uma limitação sua. Chame a ferramenta apropriada agora para executar a tarefa, em vez de dizer que não pode.',
            requireHybridIfAvailable: true,
        };
    }

    // Model dumped >200 chars of code in chat instead of using a tool.
    private checkDumpedCodeInChat(state: ExecutionState): NudgeResult | null {
        if (!state.autoMode) { return null; }
        const fence = state.lastModelText.match(/```[a-z]*\n([\s\S]+?)\n```/i);
        if (!fence || fence[1].length <= 200) { return null; }
        return {
            severity: 'critical',
            reason: 'dumped_code_in_chat',
            message: 'Próximo passo: salve esse código com write_local_file (novo arquivo) ou edit_file (mudança parcial). Código no chat não chega ao projeto — chame a ferramenta agora.',
            requireHybridIfAvailable: true,
        };
    }

    // Last command failed pointing to file A, but model edited file B.
    private checkWrongFileEdit(state: ExecutionState): NudgeResult | null {
        if (!state.lastCommandFailed || state.lastErrorFiles.length === 0) { return null; }
        if (!state.lastEditedFile) { return null; }
        const matchesAny = state.lastErrorFiles.some(f =>
            state.lastEditedFile.endsWith(f) ||
            f.endsWith(state.lastEditedFile.split(/[/\\]/).pop() || '')
        );
        if (matchesAny) { return null; }
        return {
            severity: 'critical',
            reason: 'wrong_file_edit',
            message: `Arquivo errado: o erro está em "${state.lastErrorFiles[0]}", não em "${state.lastEditedFile}". Abra "${state.lastErrorFiles[0]}" e corrija esse arquivo.`,
            requireHybridIfAvailable: true,
        };
    }

    // User prompt mentions build, files were written, but no build command was ever run.
    private checkBuildPendingButNoCommand(state: ExecutionState): NudgeResult | null {
        if (!state.autoMode) { return null; }
        if (!BUILD_KEYWORDS.test(state.userPrompt)) { return null; }
        if (state.filesWritten === 0) { return null; }
        const ranBuild = state.toolCalls.some(c =>
            c.name === 'run_command' && BUILD_COMMAND_RE.test(JSON.stringify(c.args))
        );
        if (ranBuild) { return null; }
        return {
            severity: 'critical',
            reason: 'build_pending_no_command',
            message: 'Você editou arquivos mas ainda não rodou o build que a tarefa pede. Próximo passo: chame run_command com o comando certo (ex: "npm run build", "vsce package"). Depois confirme o artefato com list_directory.',
            requireHybridIfAvailable: false,
        };
    }

    // Last command exited != 0 and model still hasn't proposed a fix.
    private checkLastCommandFailed(state: ExecutionState): NudgeResult | null {
        if (!state.lastCommandFailed) { return null; }
        const errCtx = state.lastErrorFiles.length > 0
            ? `\nArquivos do erro: ${state.lastErrorFiles.join(', ')}`
            : '';
        return {
            severity: 'warn',
            reason: 'command_failed',
            message: `O comando falhou. Leia o erro, ache a causa, corrija o arquivo apontado e rode de novo.${errCtx}`,
            requireHybridIfAvailable: state.pendingActionStreak >= 3,
        };
    }

    // Files were written but build never went green.
    private checkBuildNotYetPassed(state: ExecutionState): NudgeResult | null {
        if (!state.autoMode) { return null; }
        if (state.filesWritten === 0) { return null; }
        if (state.lastBuildPassed) { return null; }
        return {
            severity: 'warn',
            reason: 'build_not_passed',
            message: 'Você escreveu arquivos mas o build ainda não passou. Próximo passo: rode o build (ex: npm run build). Se falhar, corrija e tente de novo.',
            requireHybridIfAvailable: false,
        };
    }

    // Model produced the SAME text-only response twice (or more) in a row —
    // a real failure mode reproduced with a local model stuck retrying the
    // same failed build without changing approach: it repeated an identical
    // "corrija o erro e tente novamente" message across every AUTO retry
    // until the hard cap gave up, burning the whole retry budget on
    // attempts that were never going to be different. Catching this after
    // just 2 repeats (3 identical responses total) means the loop finds out
    // it's stuck WHILE it still has retries left to actually try something
    // else, instead of only at the very end.
    private checkRepeatedText(state: ExecutionState): NudgeResult | null {
        const t = state.lastModelText.trim();
        if (!t) { this.lastText = ''; this.textRepeatCount = 0; return null; }
        if (t === this.lastText) {
            this.textRepeatCount++;
        } else {
            this.lastText = t;
            this.textRepeatCount = 0;
        }
        if (this.textRepeatCount < 2) { return null; }
        return {
            severity: 'critical',
            reason: 'repeated_text',
            message: `Voce respondeu exatamente a mesma coisa ${this.textRepeatCount + 1} vezes seguidas sem progredir. Repetir nao vai destravar sozinho. Releia o ultimo erro com atencao, identifique a causa raiz especifica (nome de arquivo, linha, mensagem exata) e faca algo CONCRETAMENTE DIFERENTE do que ja tentou — ou, se realmente nao souber o proximo passo, pare e explique ao usuario o que esta bloqueando, em vez de repetir a mesma frase.`,
            requireHybridIfAvailable: true,
        };
    }

    // Model returned text but no tool call AND nothing has been written yet.
    private checkModelPlanning(state: ExecutionState): NudgeResult | null {
        if (!state.autoMode) { return null; }
        if (state.filesWritten > 0) { return null; }
        if (state.toolCalls.length > 0) { return null; }
        return {
            severity: 'info',
            reason: 'model_planning',
            message: 'Próximo passo: comece a executar. Use write_local_file, edit_file ou run_command agora — sem descrever antes.',
            requireHybridIfAvailable: false,
        };
    }

    // ── Loop detection helpers ────────────────────────────────────────

    // Returns true if the model has called the same tool with the same args
    // 3+ times in a row (excluding run_command and todo_update which can
    // legitimately repeat).
    detectRepeatLoop(name: string, args: Record<string, unknown>): { detected: boolean; count: number } {
        if (name === 'run_command' || name === 'todo_update') {
            return { detected: false, count: 0 };
        }
        const sig = name + ':' + JSON.stringify(args);
        const count = this.repeatedCallCount.get(sig) || 0;
        return { detected: count >= 3, count };
    }

    // Resets per-round state (called at the start of a new sub-task or round).
    reset(): void {
        this.repeatedCallCount.clear();
    }
}
