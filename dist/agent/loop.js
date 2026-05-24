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
exports.runAgentLoop = runAgentLoop;
const path = __importStar(require("path"));
const api_client_1 = require("../services/api-client");
const history_service_1 = require("../services/history-service");
const file_tools_1 = require("../tools/file-tools");
const shell_tools_1 = require("../tools/shell-tools");
const prompt_1 = require("./prompt");
const tools_definition_1 = require("./tools-definition");
const constants_1 = require("../utils/constants");
const toolHandlers = {
    list_directory: async (args, _cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — listando: ${path.basename(args.dirPath || '')}`);
        return (0, file_tools_1.listDirectory)(args.dirPath || '');
    },
    read_local_file: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — lendo: ${path.basename(args.filePath || '')}`);
        return (0, file_tools_1.readLocalFile)(args.filePath || '', cwd);
    },
    search_in_workspace: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — buscando: "${args.query}"`);
        return (0, shell_tools_1.searchInWorkspace)(args.query || '', args.dirPath || cwd);
    },
    write_local_file: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — gravando: ${path.basename(args.filePath || '')}`);
        return (0, file_tools_1.writeLocalFile)(args.filePath || '', args.content || '', cwd);
    },
    run_command: async (args, cwd, step, max, onStatus) => {
        onStatus(`Passo ${step}/${max} — executando: ${args.command}`);
        return (0, shell_tools_1.runCommand)(args.command || '', args.cwd || cwd);
    },
};
function detectEscapedToolCall(text) {
    const match = text.match(/(\w+)\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!match || !tools_definition_1.TOOL_NAMES.has(match[1])) {
        return null;
    }
    try {
        return { function: { name: match[1], arguments: JSON.parse(`{${match[2]}}`) } };
    }
    catch {
        return null;
    }
}
async function runAgentLoop(userPrompt, contextBlock, defaultCwd, endpoint, sessionHistory, onStatus) {
    const historySummary = (0, history_service_1.buildHistorySummary)(sessionHistory.slice(0, -1));
    const systemContent = [prompt_1.SYSTEM_PROMPT, historySummary, contextBlock].filter(Boolean).join('\n\n');
    const priorMessages = (0, history_service_1.buildMessagesFromHistory)(sessionHistory.slice(0, -1));
    const roundMessages = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];
    for (let step = 1; step <= constants_1.MAX_AGENT_STEPS; step++) {
        onStatus(`Passo ${step}/${constants_1.MAX_AGENT_STEPS} — pensando...`);
        const result = await (0, api_client_1.callAI)(endpoint, roundMessages, tools_definition_1.TOOLS);
        if (!result.toolCall && result.responseText) {
            const escaped = detectEscapedToolCall(result.responseText);
            if (escaped) {
                result.toolCall = escaped;
                result.responseText = '';
            }
        }
        if (result.toolCall) {
            const { name, arguments: args } = result.toolCall.function;
            const handler = toolHandlers[name];
            const toolOutput = handler
                ? await handler(args, defaultCwd, step, constants_1.MAX_AGENT_STEPS, onStatus)
                : `ERRO: Ferramenta "${name}" nao reconhecida.`;
            roundMessages.push({ role: 'tool', content: toolOutput });
        }
        else if (result.responseText !== undefined) {
            return result.responseText || 'Nao foi possivel obter resposta.';
        }
        else {
            break;
        }
    }
    return 'O agente atingiu o limite de passos. Tente uma pergunta mais especifica.';
}
