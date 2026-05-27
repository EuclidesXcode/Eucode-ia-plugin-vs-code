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
exports.loadHistory = loadHistory;
exports.appendEntry = appendEntry;
exports.buildMessagesFromHistory = buildMessagesFromHistory;
exports.buildHistorySummary = buildHistorySummary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../utils/constants");
const HISTORY_FILE = path.join(process.env.HOME || '/tmp', '.eucode-ia-history.json');
let saveTimer = null;
function loadHistory() {
    try {
        const all = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        // Remove entradas de erro que foram persistidas em sessoes anteriores
        return all.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
    }
    catch {
        return [];
    }
}
function scheduleSave(entries) {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(-constants_1.MAX_HISTORY_ENTRIES)), 'utf8');
        }
        catch (e) {
            console.error('[History] Falha ao salvar:', e);
        }
        saveTimer = null;
    }, 500);
}
function appendEntry(entries, entry) {
    const updated = [...entries, entry];
    scheduleSave(updated);
    return updated;
}
function buildMessagesFromHistory(entries, maxPairs = constants_1.MAX_HISTORY_PAIRS) {
    // Filtra entradas de erro para nao contaminar o contexto do modelo
    const BAD_PREFIXES = ['ERRO DE CONEXAO', 'Nao foi possivel obter resposta', 'O agente atingiu o limite'];
    const clean = entries.filter(e => !BAD_PREFIXES.some(p => e.content.startsWith(p)));
    return clean.slice(-maxPairs * 2).map(e => {
        if (e.hasImage && e.imageSummary) {
            return {
                role: e.role,
                content: e.role === 'user'
                    ? `[Usuario enviou uma imagem. Analise anterior: ${e.imageSummary}]\n${e.content}`
                    : e.content,
            };
        }
        return { role: e.role, content: e.content };
    });
}
function buildHistorySummary(entries) {
    if (entries.length === 0) {
        return '';
    }
    const lines = entries.slice(-20).map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const prefix = e.role === 'user' ? 'Dev' : 'Eucode';
        const snippet = e.content.slice(0, 120).replace(/\n/g, ' ');
        const imgNote = e.hasImage ? ' [imagem]' : '';
        return `[${time}] ${prefix}${imgNote}: ${snippet}${e.content.length > 120 ? '...' : ''}`;
    });
    return `# HISTORICO RECENTE DA SESSAO\n${lines.join('\n')}`;
}
