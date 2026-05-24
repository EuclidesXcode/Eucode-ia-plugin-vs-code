"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callAI = callAI;
exports.callAIWithVision = callAIWithVision;
const constants_1 = require("../utils/constants");
async function postJSON(endpoint, body) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API retornou ${response.status}: ${response.statusText}`);
    }
    return response.json();
}
async function callAI(endpoint, messages, tools) {
    const formattedTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    try {
        const data = await postJSON(endpoint, { model: constants_1.MODEL, messages, tools: formattedTools, tool_choice: 'auto' });
        const message = data?.choices?.[0]?.message;
        if (!message) {
            throw new Error('Resposta inesperada da API.');
        }
        if (message.tool_calls?.length > 0) {
            const raw = message.tool_calls[0];
            const args = typeof raw.function.arguments === 'string'
                ? JSON.parse(raw.function.arguments)
                : raw.function.arguments;
            return { responseText: '', toolCall: { function: { name: raw.function.name, arguments: args } } };
        }
        return { responseText: message.content || 'Nao foi possivel obter resposta.' };
    }
    catch (error) {
        console.error('[API] Falha ao chamar o LLM:', error);
        return {
            responseText: `ERRO DE CONEXAO: Nao foi possivel conectar com a IA em ${endpoint}. Verifique se o LM Studio esta rodando. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
async function callAIWithVision(endpoint, userText, imageBase64, imageMimeType, systemContent) {
    try {
        const data = await postJSON(endpoint, {
            model: constants_1.MODEL,
            messages: [
                { role: 'system', content: systemContent },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userText },
                        { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
                    ],
                },
            ],
        });
        return data?.choices?.[0]?.message?.content || 'Nao foi possivel analisar a imagem.';
    }
    catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
