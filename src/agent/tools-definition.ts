import { ToolDefinition } from '../services/api-client';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

const SERVER_READY_PATTERNS = [
    /listening on/i, /server running/i, /started on/i, /ready on/i,
    /running at/i, /localhost:/i, /127\.0\.0\.1:/i, /0\.0\.0\.0:/i,
    /started server/i, /app running/i, /serving on/i, /devserver/i,
    /compiled successfully/i, /ready in/i, /vite v/i,
];

const LONG_RUNNING_PREFIXES = [
    'npm start', 'npm run start', 'npm run dev', 'npm run watch',
    'yarn start', 'yarn dev', 'yarn watch',
    'npx nodemon', 'npx ts-node-dev', 'node ', 'python ', 'python3 ',
];

export const runCommandTool = (command: string, cwd: string): EventEmitter => {
    const emitter = new EventEmitter();
    const processChild = spawn(command, [], { cwd: cwd || process.cwd(), shell: true });

    let outputBuffer = '';
    let resolved = false;
    const isLongRunning = LONG_RUNNING_PREFIXES.some(p => command.trim().startsWith(p));

    let longRunningTimer: NodeJS.Timeout | null = null;
    if (isLongRunning) {
        longRunningTimer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                emitter.emit('long_running');
                emitter.emit('done', outputBuffer || '[Processo rodando em background]');
            }
        }, 8000);
    }

    function checkServerReady(chunk: string) {
        if (!resolved && isLongRunning && SERVER_READY_PATTERNS.some(p => p.test(chunk))) {
            resolved = true;
            if (longRunningTimer) { clearTimeout(longRunningTimer); }
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
        if (longRunningTimer) { clearTimeout(longRunningTimer); }
        if (!resolved) {
            resolved = true;
            emitter.emit('done', outputBuffer || `[Processo encerrado com codigo ${code}]`);
        }
    });

    processChild.on('error', (err) => {
        if (longRunningTimer) { clearTimeout(longRunningTimer); }
        if (!resolved) {
            resolved = true;
            emitter.emit('stderr', `[ERRO] ${err.message}`);
            emitter.emit('done', `[ERRO] ${err.message}`);
        }
    });

    return emitter;
};

export const TOOLS: ToolDefinition[] = [
    {
        name: 'list_directory',
        description: 'Lista arquivos e pastas de um diretorio. Use para entender a estrutura do projeto antes de qualquer acao.',
        parameters: {
            type: 'object',
            properties: {
                dirPath: { type: 'string', description: 'Caminho absoluto do diretorio a listar.' },
            },
            required: ['dirPath'],
        },
    },
    {
        name: 'read_local_file',
        description: 'Le o conteudo completo de um arquivo. Use antes de editar qualquer arquivo existente.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Caminho absoluto do arquivo a ler.' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'write_local_file',
        description: 'Cria ou sobrescreve um arquivo com o conteudo fornecido. Sempre use caminhos absolutos.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Caminho absoluto do arquivo a criar ou editar.' },
                content: { type: 'string', description: 'Conteudo completo do arquivo.' },
            },
            required: ['filePath', 'content'],
        },
    },
    {
        name: 'search_in_workspace',
        description: 'Busca um termo, funcao, classe ou padrao em todos os arquivos do projeto.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Termo ou padrao a buscar.' },
                dirPath: { type: 'string', description: 'Diretorio onde buscar. Se omitido, busca na raiz do workspace.' },
            },
            required: ['query'],
        },
    },
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

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
