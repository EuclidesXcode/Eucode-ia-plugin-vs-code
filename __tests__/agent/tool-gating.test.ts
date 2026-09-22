import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: () => undefined }) },
    window: {},
    commands: { executeCommand: async () => undefined },
    Uri: { file: (p: string) => ({ fsPath: p }) },
}), { virtual: true });

import { runAgentLoop } from '../../src/agent/loop';

// Regression coverage for a real bug: the model claimed it had pushed a
// project to GitHub when run_git wasn't even offered as a tool for that
// round — the phase-gating heuristic that hides run_git/web_search from the
// tool schema (to keep the decision space small for local models) didn't
// recognize "GitHub"/"subir"/"repositório" as git-relevant keywords, and
// web_search was gated behind an equally narrow keyword list. web_search is
// now always visible (the user asked for unrestricted internet access), and
// the git-relevant keyword list covers GitHub/upload phrasing.
describe('tool visibility per round (phase gating)', () => {
    let server: http.Server;
    let baseUrl: string;
    let lastToolNames: string[] = [];
    let projectRoot: string;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                lastToolNames = (body.tools || []).map((t: any) => t.function.name);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ choices: [{ message: { content: 'Ok.' } }] }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
    });

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eucode-toolgate-test-'));
    });
    afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    function run(userPrompt: string) {
        return runAgentLoop(
            userPrompt, '', projectRoot, baseUrl, {},
            [],
            () => {}, () => {}, () => {}, () => {},
            async () => true, async () => 'once',
            () => '', () => {},
            'test-model', false, undefined, undefined, 'lmstudio', undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            undefined,
            'toolgate-test-session-' + Math.random(), false
        );
    }

    it('always offers web_search, even with no web-related keywords in the prompt', async () => {
        await run('adicione um botao de login na tela');
        expect(lastToolNames).toContain('web_search');
    });

    it('offers run_git for a prompt asking to push/upload to GitHub', async () => {
        await run('em qual conta do github voce subiu o projeto? me da o link do repositorio');
        expect(lastToolNames).toContain('run_git');
    });

    it('still hides run_git for a prompt with no git-relevant keywords', async () => {
        await run('adicione um botao de login na tela');
        expect(lastToolNames).not.toContain('run_git');
    });
});
