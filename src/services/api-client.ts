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
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

async function postJSON(endpoint: string, body: unknown): Promise<unknown> {
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

export async function callAI(
    endpoint: string,
    messages: { role: string; content: unknown }[],
    tools: ToolDefinition[]
): Promise<AIResponse> {
    const formattedTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
        const data = await postJSON(endpoint, { model: MODEL, messages, tools: formattedTools, tool_choice: 'auto' }) as any;

        const message = data?.choices?.[0]?.message;
        if (!message) { throw new Error('Resposta inesperada da API.'); }

        if (message.tool_calls?.length > 0) {
            const raw = message.tool_calls[0];
            const args = typeof raw.function.arguments === 'string'
                ? JSON.parse(raw.function.arguments)
                : raw.function.arguments;
            return { responseText: '', toolCall: { function: { name: raw.function.name, arguments: args } } };
        }

        return { responseText: message.content || 'Nao foi possivel obter resposta.' };
    } catch (error) {
        console.error('[API] Falha ao chamar o LLM:', error);
        return {
            responseText: `ERRO DE CONEXAO: Nao foi possivel conectar com a IA em ${endpoint}. Verifique se o LM Studio esta rodando. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function callAIWithVision(
    endpoint: string,
    userText: string,
    imageBase64: string,
    imageMimeType: string,
    systemContent: string
): Promise<string> {
    try {
        const data = await postJSON(endpoint, {
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
        }) as any;

        return data?.choices?.[0]?.message?.content || 'Nao foi possivel analisar a imagem.';
    } catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
