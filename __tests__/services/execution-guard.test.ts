import { ExecutionGuardService, ExecutionState, detectsCapabilityDenial } from '../../src/services/execution-guard';

function makeState(overrides: Partial<ExecutionState> = {}): ExecutionState {
    return {
        userPrompt: 'faça algo',
        autoMode: true,
        hybridActive: false,
        toolCalls: [],
        filesWritten: 0,
        filesRead: 0,
        lastBuildPassed: false,
        lastCommandFailed: false,
        lastErrorFiles: [],
        lastEditedFile: '',
        lastModelText: '',
        pendingActionStreak: 0,
        emptyResponseStreak: 0,
        ...overrides,
    };
}

describe('ExecutionGuardService', () => {
    let guard: ExecutionGuardService;
    beforeEach(() => { guard = new ExecutionGuardService(); });

    describe('nudges em PT-BR e colaborativos', () => {
        it('all guard messages are in Portuguese (no English imperatives leaked)', () => {
            const samples = [
                guard.evaluate(makeState({ lastModelText: '```ts\n' + 'x'.repeat(250) + '\n```' })),
                guard.evaluate(makeState({ lastCommandFailed: true, lastErrorFiles: ['a.ts'], lastEditedFile: 'b.ts' })),
                guard.evaluate(makeState({ userPrompt: 'faça o build do projeto', filesWritten: 2 })),
                guard.evaluate(makeState({ lastCommandFailed: true })),
                guard.evaluate(makeState({ filesWritten: 1 })),
                guard.evaluate(makeState({})),
            ];
            for (const r of samples) {
                expect(r).not.toBeNull();
                // Não deve conter os termos imperativos em inglês que removemos.
                expect(r!.message).not.toMatch(/\b(WRONG FILE|Stop planning|You wrote|NEVER|ALWAYS|Do not)\b/);
            }
        });
    });

    describe('checkDumpedCodeInChat', () => {
        it('fires when a large code fence is in chat (auto mode)', () => {
            const state = makeState({ lastModelText: '```js\n' + 'a'.repeat(300) + '\n```' });
            const r = guard.evaluate(state);
            expect(r?.reason).toBe('dumped_code_in_chat');
            expect(r?.message).toMatch(/write_local_file|edit_file/);
        });

        it('does not fire in manual mode', () => {
            const state = makeState({ autoMode: false, lastModelText: '```js\n' + 'a'.repeat(300) + '\n```' });
            expect(guard.evaluate(state)).toBeNull();
        });

        it('ignores small code snippets (no dumped_code nudge)', () => {
            // Em manual mode os guards de auto não disparam, isolando o dumped check.
            const state = makeState({ autoMode: false, lastModelText: '```js\nconst x = 1;\n```' });
            expect(guard.evaluate(state)).toBeNull();
        });
    });

    describe('checkWrongFileEdit', () => {
        it('fires when error file differs from edited file', () => {
            const state = makeState({ lastCommandFailed: true, lastErrorFiles: ['src/foo.ts'], lastEditedFile: 'src/bar.ts' });
            const r = guard.evaluate(state);
            expect(r?.reason).toBe('wrong_file_edit');
            expect(r?.message).toContain('src/foo.ts');
        });

        it('does not fire when edited file matches the error file', () => {
            const state = makeState({ lastCommandFailed: true, lastErrorFiles: ['foo.ts'], lastEditedFile: 'src/foo.ts' });
            const r = guard.evaluate(state);
            expect(r?.reason).not.toBe('wrong_file_edit');
        });
    });

    describe('checkBuildPendingButNoCommand', () => {
        it('fires when build task wrote files but ran no build command', () => {
            const state = makeState({ userPrompt: 'gere o pacote vsix', filesWritten: 1 });
            expect(guard.evaluate(state)?.reason).toBe('build_pending_no_command');
        });

        it('does not fire once a build command has run', () => {
            const state = makeState({
                userPrompt: 'faça o build',
                filesWritten: 1,
                toolCalls: [{ name: 'run_command', args: { command: 'npm run build' }, output: '', success: true, timestamp: 0 }],
            });
            expect(guard.evaluate(state)?.reason).not.toBe('build_pending_no_command');
        });
    });

    describe('priority order', () => {
        it('dumped code (critical) wins over command failure', () => {
            const state = makeState({
                lastModelText: '```js\n' + 'a'.repeat(300) + '\n```',
                lastCommandFailed: true,
            });
            expect(guard.evaluate(state)?.reason).toBe('dumped_code_in_chat');
        });

        it('returns null when nothing applies (manual mode, clean state)', () => {
            expect(guard.evaluate(makeState({ autoMode: false }))).toBeNull();
        });
    });

    // Regression coverage for a real bug: a local model (Qwen via Apple MLX)
    // denied having tool/terminal access ("Desculpe pela confusao, mas como
    // sou uma inteligencia artificial, nao tenho acesso direto ao terminal ou
    // ao sistema de arquivos do seu computador") even though DEV mode always
    // sends the real tool schema. The user explicitly told it "voce tem
    // acesso a ferramentas do plugin" and it repeated essentially the same
    // denial — a self-reinforcing pattern once it's said once. Not gated on
    // autoMode: wrong in any mode where tools exist.
    describe('capability denial (model claims it has no tool access)', () => {
        it('detects the exact denial text from the reported bug', () => {
            const text = 'Desculpe pela confusão, mas como sou uma inteligência artificial, não tenho acesso direto ao terminal ou ao sistema de arquivos do seu computador. Eu posso ajudar a formular comandos ou orientar como você pode fazer isso você mesmo, mas não posso executar comandos diretamente.';
            expect(detectsCapabilityDenial(text)).toBe(true);
        });

        it('detects the English equivalent', () => {
            expect(detectsCapabilityDenial("As an AI, I don't have direct access to your terminal or file system.")).toBe(true);
        });

        it('does not flag an ordinary response that never mentions capability', () => {
            expect(detectsCapabilityDenial('Arquivo atualizado com sucesso em src/Login.tsx.')).toBe(false);
        });

        it('wins over model_planning and fires even outside autoMode', () => {
            const state = makeState({
                autoMode: false,
                lastModelText: 'não tenho acesso direto ao terminal ou ao sistema de arquivos do seu computador.',
            });
            expect(guard.evaluate(state)?.reason).toBe('capability_denial');
        });
    });

    describe('detectRepeatLoop', () => {
        it('detects 3+ identical calls but excludes run_command/todo_update', () => {
            const args = { filePath: 'a.ts' };
            const state = makeState();
            for (let i = 0; i < 3; i++) {
                guard.track(state, { name: 'read_local_file', args, output: '', success: true, timestamp: i });
            }
            expect(guard.detectRepeatLoop('read_local_file', args).detected).toBe(true);
            expect(guard.detectRepeatLoop('run_command', { command: 'x' }).detected).toBe(false);
        });
    });
});
