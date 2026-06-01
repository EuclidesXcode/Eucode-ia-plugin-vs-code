"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCompletion = getCompletion;
const api_client_1 = require("./api-client");
const hybrid_client_1 = require("./hybrid-client");
const settings_1 = require("../config/settings");
// Heuristic: a local completion is "weak" when it returns empty or just
// whitespace/punctuation. In that case, if hybrid is enabled, we retry with
// the paid provider. Keeps the inline editor experience responsive.
function isWeakCompletion(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return true;
    }
    if (trimmed.length < 3 && !/[\w()]/.test(trimmed)) {
        return true;
    }
    return false;
}
// Calls the local model in non-streaming mode (autocomplete needs a single
// final string, not chunks). If hybrid is on and local came back weak,
// transparently retries via the paid provider.
async function getCompletion(settings, req) {
    if (req.signal?.aborted) {
        return { text: '', source: 'local', error: 'aborted' };
    }
    // Local first
    const messages = [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
    ];
    let localText = '';
    let localError;
    try {
        const endpoint = (0, settings_1.buildApiEndpoint)(settings);
        const authHeaders = (0, settings_1.buildAuthHeader)(settings);
        const result = settings.provider === 'anthropic' && settings.apiKey
            ? await (0, api_client_1.callAnthropicAI)(settings.apiKey, messages, [], settings.model, req.signal)
            : await (0, api_client_1.callAI)(endpoint, authHeaders, messages, [], settings.model, req.signal);
        if (result.responseText === '__ABORTED__') {
            return { text: '', source: 'local', error: 'aborted' };
        }
        if (result.responseText === '__INFRA_ERROR__') {
            localError = 'local_infra_error';
        }
        else {
            localText = result.responseText.trim();
        }
    }
    catch (e) {
        localError = e instanceof Error ? e.message : String(e);
    }
    // If local was good enough, return it
    if (!localError && !isWeakCompletion(localText)) {
        return { text: localText, source: 'local' };
    }
    // Hybrid fallback (only if enabled and key configured)
    if (settings.hybridEnabled && settings.supportApiKey) {
        const supportRes = await (0, hybrid_client_1.callSupportProvider)({
            provider: settings.supportProvider,
            apiKey: settings.supportApiKey,
            model: settings.supportModel || settings_1.DEFAULT_SUPPORT_MODELS[settings.supportProvider],
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
