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

export class ExecutionGuardService {
    private repeatedCallCount = new Map<string, number>();

    // Records a tool call so subsequent guards can see history.
    track(state: ExecutionState, call: ToolCallRecord): void {
        state.toolCalls.push(call);
        const sig = call.name + ':' + JSON.stringify(call.args);
        this.repeatedCallCount.set(sig, (this.repeatedCallCount.get(sig) || 0) + 1);
    }

    // Returns the highest-severity guard that applies, or null. Order
    // matters — checked from most-specific to most-generic.
    evaluate(state: ExecutionState): NudgeResult | null {
        return this.checkDumpedCodeInChat(state)
            || this.checkWrongFileEdit(state)
            || this.checkBuildPendingButNoCommand(state)
            || this.checkLastCommandFailed(state)
            || this.checkBuildNotYetPassed(state)
            || this.checkModelPlanning(state);
    }

    // ── Individual guards ─────────────────────────────────────────────

    // Model dumped >200 chars of code in chat instead of using a tool.
    private checkDumpedCodeInChat(state: ExecutionState): NudgeResult | null {
        if (!state.autoMode) { return null; }
        const fence = state.lastModelText.match(/```[a-z]*\n([\s\S]+?)\n```/i);
        if (!fence || fence[1].length <= 200) { return null; }
        return {
            severity: 'critical',
            reason: 'dumped_code_in_chat',
            message: 'You wrote code in the chat instead of saving it to a file. The user cannot use code in the chat. Use write_local_file (for new/full-rewrite) or edit_file (for partial edits) NOW to save that code to disk. Do not paste code in your reply — call the tool.',
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
            message: `WRONG FILE. You edited "${state.lastEditedFile}" but the error is in "${state.lastErrorFiles[0]}". Read "${state.lastErrorFiles[0]}" now and fix THAT file. The bug is not where you were looking.`,
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
            message: 'You edited files but have NOT yet run the build/package command that the user task requires. Call run_command now with the appropriate build command (e.g. "npm run build", "vsce package", "npm run package"). After it finishes, use list_directory to verify the output artifact exists. Do NOT keep editing without running the build.',
            requireHybridIfAvailable: false,
        };
    }

    // Last command exited != 0 and model still hasn't proposed a fix.
    private checkLastCommandFailed(state: ExecutionState): NudgeResult | null {
        if (!state.lastCommandFailed) { return null; }
        const errCtx = state.lastErrorFiles.length > 0
            ? `\n\nERROR LOCATION:\n  Files: ${state.lastErrorFiles.join(', ')}`
            : '';
        return {
            severity: 'warn',
            reason: 'command_failed',
            message: `The last command failed. Read the error output, identify the root cause, fix the SPECIFIC file mentioned in the error, then re-run.${errCtx}`,
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
            message: 'You have written files but have not yet run a successful build. Run the build command now (e.g. npm run build) to verify. If it fails, fix the errors and retry.',
            requireHybridIfAvailable: false,
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
            message: 'Stop planning. Use write_local_file, edit_file, or run_command now to execute the task. Do not describe — act immediately.',
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
