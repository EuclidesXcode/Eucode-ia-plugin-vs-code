"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_NAMES = exports.TOOLS = exports.runCommandTool = void 0;
const child_process_1 = require("child_process"); // Usando spawn para streaming
const events_1 = require("events"); // Importando EventEmitter
// ... (Mantendo as outras definições de ferramentas)
/**
 * Função refatorada para usar spawn e emitir eventos de streaming em vez de retornar um Promise resolvido.
 * O executor do agente DEVE ser adaptado para ouvir os eventos deste objeto EventEmitter,
 * tratando o stream como a resposta da ferramenta.
 * @param command O comando a ser executado.
 * @param cwd Diretório de trabalho.
 * @returns Um EventEmitter que emite 'stdout', 'stderr', e 'done' ao final do processo.
 */
// Padrões que indicam que o servidor subiu e está aguardando conexões
const SERVER_READY_PATTERNS = [
    /listening on/i, /server running/i, /started on/i, /ready on/i,
    /running at/i, /localhost:/i, /127\.0\.0\.1:/i, /0\.0\.0\.0:/i,
    /started server/i, /app running/i, /serving on/i, /devserver/i,
    /compiled successfully/i, /ready in/i, /vite v/i,
];
// Comandos que tipicamente não terminam (servidores, watchers)
const LONG_RUNNING_PREFIXES = [
    'npm start', 'npm run start', 'npm run dev', 'npm run watch',
    'yarn start', 'yarn dev', 'yarn watch',
    'npx nodemon', 'npx ts-node-dev', 'node ', 'python ', 'python3 ',
];
const runCommandTool = (command, cwd) => {
    const emitter = new events_1.EventEmitter();
    const processChild = (0, child_process_1.spawn)(command, [], { cwd: cwd || process.cwd(), shell: true });
    let outputBuffer = '';
    let resolved = false;
    const isLongRunning = LONG_RUNNING_PREFIXES.some(p => command.trim().startsWith(p));
    // Para processos longos: resolve após detectar que o servidor subiu
    // ou após 8s de output sem fechar, para não travar o agente
    let longRunningTimer = null;
    if (isLongRunning) {
        longRunningTimer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                emitter.emit('long_running');
                emitter.emit('done', outputBuffer || '[Processo rodando em background]');
            }
        }, 8000);
    }
    function checkServerReady(chunk) {
        if (!resolved && isLongRunning && SERVER_READY_PATTERNS.some(p => p.test(chunk))) {
            resolved = true;
            if (longRunningTimer) {
                clearTimeout(longRunningTimer);
            }
            emitter.emit('long_running');
            setTimeout(() => emitter.emit('done', outputBuffer), 300);
        }
    }
    processChild.stdout?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stdout', chunk);
        checkServerReady(chunk);
    });
    processChild.stderr?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stderr', chunk);
        checkServerReady(chunk);
    });
    processChild.on('close', (code) => {
        if (longRunningTimer) {
            clearTimeout(longRunningTimer);
        }
        if (!resolved) {
            resolved = true;
            emitter.emit('done', outputBuffer || `[Processo encerrado com codigo ${code}]`);
        }
    });
    processChild.on('error', (err) => {
        if (longRunningTimer) {
            clearTimeout(longRunningTimer);
        }
        if (!resolved) {
            resolved = true;
            emitter.emit('stderr', `[ERRO] ${err.message}`);
            emitter.emit('done', `[ERRO] ${err.message}`);
        }
    });
    return emitter;
};
exports.runCommandTool = runCommandTool;
exports.TOOLS = [
    {
        name: 'run_command',
        description: 'Executa um comando no terminal. Use para compilar, instalar dependencias, rodar testes, iniciar servidores (npm start, node app.js, python main.py, etc) ou qualquer script. O resultado e transmitido em tempo real. Processos longos como servidores sao detectados automaticamente e o agente continua apos o servidor subir.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Comando a executar, ex: npm run build.' },
                cwd: { type: 'string', description: 'Diretorio de trabalho. Se omitido, usa a pasta raiz do workspace.' },
            },
            required: ['command'],
        },
    },
];
exports.TOOL_NAMES = new Set(exports.TOOLS.map(t => t.name));
