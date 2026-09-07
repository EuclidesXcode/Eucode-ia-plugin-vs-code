import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// loop.ts pulls in memory-service.ts/workspace-init.ts, which need `vscode`.
// Virtual-mock it — none of the write/command-confirmation logic under test
// touches the real VS Code API, only Node's fs/http.
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: () => undefined }) },
    window: {},
    commands: { executeCommand: async () => undefined },
    Uri: { file: (p: string) => ({ fsPath: p }) },
}), { virtual: true });

import { runAgentLoop } from '../../src/agent/loop';

// Regression coverage for the "reduce manual confirmation without reducing
// safety" change: run_command must stop asking for confirmation on commands
// classified 'safe' (mirrors the pre-existing exemption for read-only git
// subcommands), but must keep asking for 'dangerous' ones; and approving a
// file write once must not require re-approving the SAME file again later in
// the same task.
describe('confirmation gating (manual mode, autoMode=false)', () => {
    let server: http.Server;
    let baseUrl: string;
    let responses: any[] = [];
    let callCount = 0;
    let projectRoot: string;

    function toolCallResponse(name: string, args: Record<string, unknown>) {
        return { choices: [{ message: { tool_calls: [{ id: 'call_1', function: { name, arguments: JSON.stringify(args) } }] } }] };
    }
    function textResponse(text: string) {
        return { choices: [{ message: { content: text } }] };
    }

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const reply = responses[callCount] ?? textResponse('Tarefa concluida.');
                callCount++;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(reply));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
    });

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    beforeEach(() => {
        callCount = 0;
        responses = [];
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eucode-confirm-test-'));
    });

    afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    function run(userPrompt: string, onConfirmWrite: (req: any) => Promise<boolean>, onConfirmCommand: (req: any) => Promise<'once' | 'session' | 'block'>) {
        return runAgentLoop(
            userPrompt, '', projectRoot, baseUrl, {},
            [],
            () => {}, () => {}, () => {}, () => {},
            onConfirmWrite, onConfirmCommand,
            () => '', () => {},
            'test-model', false, undefined, undefined, 'lmstudio', undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            undefined,
            'confirm-test-session-' + Math.random(), false
        );
    }

    it('does not ask for confirmation on a command classified as safe', async () => {
        responses = [
            toolCallResponse('run_command', { command: 'ls' }),
            textResponse('Encontrei os arquivos.'),
        ];
        const confirmCommandCalls: any[] = [];
        await run('liste os arquivos', async () => true, async (req) => { confirmCommandCalls.push(req); return 'once'; });
        expect(confirmCommandCalls).toHaveLength(0);
    });

    it('still asks for confirmation on a command classified as dangerous', async () => {
        responses = [
            toolCallResponse('run_command', { command: 'npm publish' }),
            textResponse('Publicado.'),
        ];
        const confirmCommandCalls: any[] = [];
        await run('publique o pacote', async () => true, async (req) => { confirmCommandCalls.push(req); return 'once'; });
        expect(confirmCommandCalls).toHaveLength(1);
        expect(confirmCommandCalls[0].command).toBe('npm publish');
    });

    it('only asks once for the same file written twice in the same task', async () => {
        const target = path.join(projectRoot, 'a.txt');
        responses = [
            toolCallResponse('write_local_file', { filePath: target, content: 'primeira versao' }),
            // write_local_file refuses to overwrite an existing file the model
            // hasn't read in this round — read it first, same as a real model
            // would after getting that [REQUIRED] message.
            toolCallResponse('read_local_file', { filePath: target }),
            toolCallResponse('write_local_file', { filePath: target, content: 'segunda versao' }),
            textResponse('Arquivo atualizado duas vezes.'),
        ];
        const confirmWriteCalls: any[] = [];
        await run('escreva o arquivo duas vezes', async (req) => { confirmWriteCalls.push(req); return true; }, async () => 'once');
        expect(confirmWriteCalls).toHaveLength(1);
        expect(fs.readFileSync(target, 'utf8')).toBe('segunda versao');
    });
});
