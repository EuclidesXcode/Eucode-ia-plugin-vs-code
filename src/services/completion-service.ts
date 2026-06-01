import { callAI, callAnthropicAI } from './api-client';
import { callSupportProvider } from './hybrid-client';
import { EucodeSettings, buildApiEndpoint, buildAuthHeader, DEFAULT_SUPPORT_MODELS } from '../config/settings';

export interface CompletionRequest {
    system: string;
    user: string;
    maxTokens: number;
    signal?: AbortSignal;
}

export interface CompletionResult {
    text: string;
    source: 'local' | 'support';
    error?: string;
}

// Heuristic: a local completion is "weak" when it returns empty or just
// whitespace/punctuation. In that case, if hybrid is enabled, we retry with
// the paid provider. Keeps the inline editor experience responsive.
function isWeakCompletion(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) { return true; }
    if (trimmed.length < 3 && !/[\w()]/.test(trimmed)) { return true; }
    return false;
}

// Calls the local model in non-streaming mode (autocomplete needs a single
// final string, not chunks). If hybrid is on and local came back weak,
// transparently retries via the paid provider.
export async function getCompletion(
    settings: EucodeSettings,
    req: CompletionRequest
): Promise<CompletionResult> {
    if (req.signal?.aborted) { return { text: '', source: 'local', error: 'aborted' }; }

    // Local first
    const messages = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
    ];
    let localText = '';
    let localError: string | undefined;
    try {
        const endpoint = buildApiEndpoint(settings);
        const authHeaders = buildAuthHeader(settings);
        const result = settings.provider === 'anthropic' && settings.apiKey
            ? await callAnthropicAI(settings.apiKey, messages, [], settings.model, req.signal)
            : await callAI(endpoint, authHeaders, messages, [], settings.model, req.signal);

        if (result.responseText === '__ABORTED__') {
            return { text: '', source: 'local', error: 'aborted' };
        }
        if (result.responseText === '__INFRA_ERROR__') {
            localError = 'local_infra_error';
        } else {
            localText = result.responseText.trim();
        }
    } catch (e) {
        localError = e instanceof Error ? e.message : String(e);
    }

    // If local was good enough, return it
    if (!localError && !isWeakCompletion(localText)) {
        return { text: localText, source: 'local' };
    }

    // Hybrid fallback (only if enabled and key configured)
    if (settings.hybridEnabled && settings.supportApiKey) {
        const supportRes = await callSupportProvider({
            provider: settings.supportProvider,
            apiKey: settings.supportApiKey,
            model: settings.supportModel || DEFAULT_SUPPORT_MODELS[settings.supportProvider],
            system: req.system,
            user: req.user,
            maxTokens: req.maxTokens,
        });
        if (!supportRes.error && supportRes.text.trim().length > 0) {
            return { text: supportRes.text.trim(), source: 'support' };
        }
        // Both failed
        return { text: '', source: 'support', error: supportRes.error || 'empty_support_response' };
    }

    // No hybrid configured — return whatever local gave (even if weak)
    return { text: localText, source: 'local', error: localError };
}
