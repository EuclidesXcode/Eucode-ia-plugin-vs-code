import * as https from 'https';
import * as http from 'http';
import { MODEL } from '../utils/constants';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface AIResponse {
    responseText: string;
    toolCall?: ToolCall;
}

export interface ToolCall {
    id?: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

function request(url: string, method: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = JSON.stringify(body);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers,
            },
            timeout: timeoutMs,
        };

        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`API retornou ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (e) {
                    reject(new Error('Resposta nao e JSON valido.'));
                }
            });
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao conectar.')); });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout: timeoutMs,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.end();
    });
}

export async function checkConnection(endpoint: string, authHeaders: Record<string, string>): Promise<boolean> {
    const base = endpoint.replace('/v1/chat/completions', '');
    try {
        const status = await get(`${base}/v1/models`, authHeaders, 4000);
        return status === 200;
    } catch {
        return false;
    }
}

export async function callAI(
    endpoint: string,
    authHeaders: Record<string, string>,
    messages: { role: string; content: unknown }[],
    tools: ToolDefinition[]
): Promise<AIResponse> {
    const formattedTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
        const data = await request(endpoint, 'POST', {
            model: MODEL, messages, tools: formattedTools, tool_choice: 'auto',
        }, authHeaders, 120000) as any;

        const message = data?.choices?.[0]?.message;
        if (!message) { throw new Error('Resposta inesperada da API.'); }

        if (message.tool_calls?.length > 0) {
            const raw = message.tool_calls[0];
            const args = typeof raw.function.arguments === 'string'
                ? JSON.parse(raw.function.arguments)
                : raw.function.arguments;
            return { responseText: '', toolCall: { id: raw.id, function: { name: raw.function.name, arguments: args } } };
        }

        return { responseText: message.content || 'Nao foi possivel obter resposta.' };
    } catch (error) {
        console.error('[API] Falha ao chamar o LLM:', error);
        return {
            responseText: `ERRO DE CONEXAO: Nao foi possivel conectar com a IA em ${endpoint}. Verifique se o servico esta rodando. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function callAIWithVision(
    endpoint: string,
    authHeaders: Record<string, string>,
    userText: string,
    imageBase64: string,
    imageMimeType: string,
    systemContent: string
): Promise<string> {
    try {
        const data = await request(endpoint, 'POST', {
            model: MODEL,
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
        }, authHeaders, 120000) as any;

        return data?.choices?.[0]?.message?.content || 'Nao foi possivel analisar a imagem.';
    } catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
