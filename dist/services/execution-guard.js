"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionGuardService = void 0;
// Words that, when present in the user prompt, indicate a build/package task.
const BUILD_KEYWORDS = /\b(build|compile|package|deploy|vsix|release|marketplace|gerar versao|publish)\b/i;
// Tool name patterns that count as "build" for the guard.
const BUILD_COMMAND_RE = /\b(build|compile|package|tsc|vsce|webpack|rollup|esbuild|jest|vitest|pytest|cargo build|go build|mvn|gradle|npm run)\b/i;
class ExecutionGuardService {
    constructor() {
        this.repeatedCallCount = new Map();
    }
    // Records a tool call so subsequent guards can see history.
    track(state, call) {
        state.toolCalls.push(call);
        const sig = call.name + ':' + JSON.stringify(call.args);
        this.repeatedCallCount.set(sig, (this.repeatedCallCount.get(sig) || 0) + 1);
    }
    // Returns the highest-severity guard that applies, or null. Order
    // matters — checked from most-specific to most-generic.
    evaluate(state) {
        return this.checkDumpedCodeInChat(state)
            || this.checkWrongFileEdit(state)
            || this.checkBuildPendingButNoCommand(state)
            || this.checkLastCommandFailed(state)
            || this.checkBuildNotYetPassed(state)
            || this.checkModelPlanning(state);
    }
    // ── Individual guards ─────────────────────────────────────────────
    // Model dumped >200 chars of code in chat instead of using a tool.
    checkDumpedCodeInChat(state) {
        if (!state.autoMode) {
            return null;
        }
        const fence = state.lastModelText.match(/```[a-z]*\n([\s\S]+?)\n```/i);
        if (!fence || fence[1].length <= 200) {
            return null;
        }
        return {
            severity: 'critical',
            reason: 'dumped_code_in_chat',
            message: 'Próximo passo: salve esse código com write_local_file (novo arquivo) ou edit_file (mudança parcial). Código no chat não chega ao projeto — chame a ferramenta agora.',
            requireHybridIfAvailable: true,
        };
    }
    // Last command failed pointing to file A, but model edited file B.
    checkWrongFileEdit(state) {
        if (!state.lastCommandFailed || state.lastErrorFiles.length === 0) {
            return null;
        }
        if (!state.lastEditedFile) {
            return null;
        }
        const matchesAny = state.lastErrorFiles.some(f => state.lastEditedFile.endsWith(f) ||
            f.endsWith(state.lastEditedFile.split(/[/\\]/).pop() || ''));
        if (matchesAny) {
            return null;
        }
        return {
            severity: 'critical',
            reason: 'wrong_file_edit',
            message: `Arquivo errado: o erro está em "${state.lastErrorFiles[0]}", não em "${state.lastEditedFile}". Abra "${state.lastErrorFiles[0]}" e corrija esse arquivo.`,
            requireHybridIfAvailable: true,
        };
    }
    // User prompt mentions build, files were written, but no build command was ever run.
    checkBuildPendingButNoCommand(state) {
        if (!state.autoMode) {
            return null;
        }
        if (!BUILD_KEYWORDS.test(state.userPrompt)) {
            return null;
        }
        if (state.filesWritten === 0) {
            return null;
        }
        const ranBuild = state.toolCalls.some(c => c.name === 'run_command' && BUILD_COMMAND_RE.test(JSON.stringify(c.args)));
        if (ranBuild) {
            return null;
        }
        return {
            severity: 'critical',
            reason: 'build_pending_no_command',
            message: 'Você editou arquivos mas ainda não rodou o build que a tarefa pede. Próximo passo: chame run_command com o comando certo (ex: "npm run build", "vsce package"). Depois confirme o artefato com list_directory.',
            requireHybridIfAvailable: false,
        };
    }
    // Last command exited != 0 and model still hasn't proposed a fix.
    checkLastCommandFailed(state) {
        if (!state.lastCommandFailed) {
            return null;
        }
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
    checkBuildNotYetPassed(state) {
        if (!state.autoMode) {
            return null;
        }
        if (state.filesWritten === 0) {
            return null;
        }
        if (state.lastBuildPassed) {
            return null;
        }
        return {
            severity: 'warn',
            reason: 'build_not_passed',
            message: 'Você escreveu arquivos mas o build ainda não passou. Próximo passo: rode o build (ex: npm run build). Se falhar, corrija e tente de novo.',
            requireHybridIfAvailable: false,
        };
    }
    // Model returned text but no tool call AND nothing has been written yet.
    checkModelPlanning(state) {
        if (!state.autoMode) {
            return null;
        }
        if (state.filesWritten > 0) {
            return null;
        }
        if (state.toolCalls.length > 0) {
            return null;
        }
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
    detectRepeatLoop(name, args) {
        if (name === 'run_command' || name === 'todo_update') {
            return { detected: false, count: 0 };
        }
        const sig = name + ':' + JSON.stringify(args);
        const count = this.repeatedCallCount.get(sig) || 0;
        return { detected: count >= 3, count };
    }
    // Resets per-round state (called at the start of a new sub-task or round).
    reset() {
        this.repeatedCallCount.clear();
    }
}
exports.ExecutionGuardService = ExecutionGuardService;
