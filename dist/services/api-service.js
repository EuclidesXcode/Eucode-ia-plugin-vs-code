"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.callLocalAIWithVision = callLocalAIWithVision;
exports.callLocalAI = callLocalAI;
exports.listDirectory = listDirectory;
exports.searchInWorkspace = searchInWorkspace;
exports.readLocalFile = readLocalFile;
exports.writeLocalFile = writeLocalFile;
exports.runCommand = runCommand;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const API_ENDPOINT = "http://localhost:1234/v1/chat/completions";
async function callLocalAIWithVision(userText, imageBase64, imageMimeType, systemContent) {
    const requestBody = {
        model: "google/gemma-4-e4b",
        messages: [
            { role: 'system', content: systemContent },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userText },
                    { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
                ]
            }
        ]
    };
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            throw new Error(`Erro na API: ${response.statusText}`);
        }
        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'Nao foi possivel analisar a imagem.';
    }
    catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
async function callLocalAI(messages, tools) {
    const formattedTools = tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
    const requestBody = {
        model: "google/gemma-4-e4b",
        messages,
        tools: formattedTools,
        tool_choice: 'auto'
    };
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            throw new Error(`Erro na API do LM Studio: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.choices && data.choices[0].message) {
            const message = data.choices[0].message;
            if (message.tool_calls && message.tool_calls.length > 0) {
                return { responseText: "", toolCall: message.tool_calls[0] };
            }
            return { responseText: message.content || "Nao foi possivel obter resposta.", toolCall: undefined };
        }
        throw new Error("Resposta inesperada da API.");
    }
    catch (error) {
        console.error("[API] Falha ao chamar o LLM:", error);
        return {
            responseText: `ERRO DE CONEXAO: Nao foi possivel conectar com a IA local em ${API_ENDPOINT}. Verifique se o LM Studio esta rodando. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
            toolCall: undefined
        };
    }
}
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', '__pycache__', '.vscode']);
const BINARY_EXTS_SVC = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.pdf', '.lock']);
async function listDirectory(dirPath) {
    try {
        const fullPath = path.resolve(dirPath);
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const lines = [];
        for (const entry of entries) {
            if (IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            if (entry.isDirectory()) {
                lines.push(`${entry.name}/`);
            }
            else {
                if (BINARY_EXTS_SVC.has(path.extname(entry.name).toLowerCase())) {
                    continue;
                }
                lines.push(entry.name);
            }
        }
        return lines.length > 0 ? lines.join('\n') : '(pasta vazia)';
    }
    catch (e) {
        return `[ERRO] Nao foi possivel listar ${dirPath}. Motivo: ${e instanceof Error ? e.message : String(e)}`;
    }
}
async function searchInWorkspace(query, dirPath) {
    try {
        const result = (0, child_process_1.execSync)(`grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.dart" -e ${JSON.stringify(query)} ${JSON.stringify(dirPath)} 2>/dev/null | head -60`, { encoding: 'utf8', timeout: 10000 });
        return result.trim() || `Nenhum resultado para "${query}" em ${dirPath}`;
    }
    catch (e) {
        // grep retorna exit code 1 quando nao encontra — nao e erro
        const out = e.stdout?.toString().trim();
        return out || `Nenhum resultado para "${query}" em ${dirPath}`;
    }
}
async function readLocalFile(filePath, workspaceRoot) {
    try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot ?? '/', filePath);
        return fs.readFileSync(fullPath, 'utf8');
    }
    catch (e) {
        return `[ERRO] Nao foi possivel ler o arquivo ${filePath}. Motivo: ${e instanceof Error ? e.message : String(e)}`;
    }
}
async function writeLocalFile(filePath, content, workspaceRoot) {
    console.log(`[writeLocalFile] filePath="${filePath}" workspaceRoot="${workspaceRoot}"`);
    if (!filePath || filePath.trim() === '') {
        return `[ERRO] filePath vazio. Use um caminho absoluto, ex: ${workspaceRoot ?? '/tmp'}/nome.js`;
    }
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot ?? '/tmp', filePath);
    // Rejeita se nao tem extensao (provavelmente e um diretorio)
    const ext = path.extname(fullPath);
    if (!ext) {
        return `[ERRO] filePath nao tem extensao — parece ser um diretorio: "${fullPath}". Informe o nome completo do arquivo incluindo a extensao, ex: ${fullPath}/index.js`;
    }
    // Rejeita se o caminho ja existe como diretorio
    try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            return `[ERRO] "${fullPath}" e um diretorio, nao um arquivo. Informe o nome completo incluindo o arquivo, ex: ${fullPath}/index.js`;
        }
    }
    catch {
        // nao existe ainda — ok
    }
    try {
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`[writeLocalFile] OK: ${fullPath}`);
        return `[OK] Arquivo gravado: ${fullPath}`;
    }
    catch (e) {
        return `[ERRO] Falha ao gravar "${fullPath}": ${e instanceof Error ? e.message : String(e)}`;
    }
}
// Prefixos de comandos permitidos. Bloqueamos rm -rf, sudo, curl para URL externas, etc.
const ALLOWED_PREFIXES = [
    'python', 'python3', 'node', 'npm', 'npx', 'yarn',
    'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
    'git status', 'git log', 'git diff', 'git branch',
    'ls', 'cat', 'find', 'grep', 'mkdir', 'cp', 'mv',
    'echo', 'pwd', 'which',
];
const BLOCKED_PATTERNS = [
    /rm\s+-rf/i, /rm\s+-r/i, // delecao recursiva
    /sudo/i, // escalada de privilegio
    />\s*\/dev\/(sd|hd|nvme)/i, // escrita em disco raw
    /mkfs/i, /fdisk/i, /parted/i, // formatacao de disco
    /curl\s+.*\|\s*(bash|sh|zsh)/i, // pipe remoto para shell
    /wget\s+.*\|\s*(bash|sh|zsh)/i,
    /chmod\s+777/i, // permissoes abertas
    /:\(\)\{.*\}/i, // fork bomb
];
async function runCommand(command, cwd) {
    const trimmed = command.trim();
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return `[BLOQUEADO] Comando recusado por politica de seguranca: "${trimmed}"`;
        }
    }
    const allowed = ALLOWED_PREFIXES.some(prefix => trimmed.startsWith(prefix));
    if (!allowed) {
        return `[BLOQUEADO] Comando nao esta na lista de comandos permitidos: "${trimmed}". Permitidos: ${ALLOWED_PREFIXES.join(', ')}`;
    }
    try {
        const workDir = cwd ? path.resolve(cwd) : process.cwd();
        const output = (0, child_process_1.execSync)(trimmed, {
            cwd: workDir,
            timeout: 30000,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
        });
        return output || '[OK] Comando executado sem saida.';
    }
    catch (e) {
        const stderr = e.stderr?.toString() || '';
        const stdout = e.stdout?.toString() || '';
        return `[ERRO] Falha ao executar comando.\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`;
    }
}
