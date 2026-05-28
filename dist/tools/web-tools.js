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
exports.webSearch = webSearch;
const https = __importStar(require("https"));
function httpsGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}
async function webSearch(query) {
    const encoded = encodeURIComponent(query);
    // Tenta DuckDuckGo Instant Answer API primeiro (sem chave)
    try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
        const raw = await httpsGet(apiUrl, 10000);
        const data = JSON.parse(raw);
        const results = [];
        if (data.AbstractText) {
            results.push(`**${data.Heading}**\n${data.AbstractText}\nFonte: ${data.AbstractURL}`);
        }
        if (data.RelatedTopics?.length) {
            for (const topic of data.RelatedTopics.slice(0, 4)) {
                if (topic.Text && topic.FirstURL) {
                    results.push(`- ${topic.Text}\n  ${topic.FirstURL}`);
                }
            }
        }
        if (results.length > 0) {
            return `Resultados para "${query}":\n\n${results.join('\n\n')}`;
        }
    }
    catch {
        // fallback abaixo
    }
    // Fallback: scraping basico do HTML do DuckDuckGo
    try {
        const htmlUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
        const html = await httpsGet(htmlUrl, 10000);
        const snippets = [];
        // Extrai titulos e snippets dos resultados
        const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        const titles = [];
        let m;
        while ((m = resultPattern.exec(html)) !== null && titles.length < 5) {
            const title = m[2].replace(/<[^>]+>/g, '').trim();
            if (title) {
                titles.push(title);
            }
        }
        const snips = [];
        while ((m = snippetPattern.exec(html)) !== null && snips.length < 5) {
            const snip = m[1].replace(/<[^>]+>/g, '').trim();
            if (snip) {
                snips.push(snip);
            }
        }
        for (let i = 0; i < Math.min(titles.length, snips.length, 5); i++) {
            snippets.push(`**${titles[i]}**\n${snips[i]}`);
        }
        if (snippets.length > 0) {
            return `Resultados para "${query}":\n\n${snippets.join('\n\n')}`;
        }
        return `Nenhum resultado encontrado para "${query}". Tente reformular a busca.`;
    }
    catch (e) {
        return `[ERRO] Falha na busca web: ${e instanceof Error ? e.message : String(e)}`;
    }
}
