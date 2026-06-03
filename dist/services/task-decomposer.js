"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDecomposerService = void 0;
const hybrid_client_1 = require("./hybrid-client");
const settings_1 = require("../config/settings");
// Heuristics for "is this a macro task?" — used as a cheap pre-filter so
// we don't waste a paid API call asking "should I decompose?" for short
// prompts that obviously don't need it.
const MACRO_INDICATORS = [
    /\b(sistema|aplicacao|app|projeto|saas|dashboard|completo|inteiro|todas?\s+as)\b/i,
    /\b(login\s+e|\+\s*dashboard|crud|tela\s+de|paginas?\b)/i,
    /(?:com|inclui|tem|possui)\s+(\w+\s*[,e]\s*){2,}/i, // "com X, Y e Z"
];
const MIN_WORDS_FOR_DECOMPOSITION = 20;
class TaskDecomposerService {
    constructor(hybridProvider, hybridApiKey, hybridModel) {
        this.hybridProvider = hybridProvider;
        this.hybridApiKey = hybridApiKey;
        this.hybridModel = hybridModel;
    }
    hybridAvailable() {
        return !!(this.hybridProvider && this.hybridApiKey);
    }
    // Quick local heuristic: should we even consider decomposing?
    // Returns false for short or simple prompts.
    shouldConsiderDecomposition(userPrompt) {
        const trimmed = userPrompt.trim();
        const words = trimmed.split(/\s+/).length;
        if (words < MIN_WORDS_FOR_DECOMPOSITION) {
            return false;
        }
        return MACRO_INDICATORS.some(re => re.test(trimmed));
    }
    // Asks the paid provider to break the task into 2-8 sub-tasks. Returns
    // a plan with needed=false if the task is small enough or if hybrid is
    // not available.
    async plan(userPrompt, workspaceSummary) {
        if (!this.hybridAvailable()) {
            return { needed: false, reasoning: 'Hybrid not configured', subTasks: [] };
        }
        if (!this.shouldConsiderDecomposition(userPrompt)) {
            return { needed: false, reasoning: 'Task fits in a single round', subTasks: [] };
        }
        const system = `You are a senior software architect breaking a large user task into smaller sub-tasks that a SMALL local LLM (≤10B params, 2048 ctx) can execute one at a time. Each sub-task must be self-contained, small enough to complete in ONE round of the agent (read 1-3 files + edit 1-3 files + run 1 verification command).

Output STRICT JSON with this shape (no markdown, no prose):
{
  "needed": true,
  "reasoning": "<one sentence why decomposition helps>",
  "subTasks": [
    {"id": 1, "title": "<short label>", "prompt": "<self-contained prompt for the local agent>", "dependsOn": []},
    ...
  ]
}

Rules:
- 2 to 8 sub-tasks (no more)
- Each "prompt" must be COMPLETE — the local agent will see it standalone with no memory of other sub-tasks
- Include file paths the agent should touch (relative paths only)
- If a task is "Build component X", include reading the existing structure + creating the file + verifying it compiles
- If the original task already fits in one round (simple), return {"needed": false, "reasoning": "...", "subTasks": []}`;
        const user = `Workspace summary:\n${workspaceSummary.slice(0, 1500)}\n\nUser task:\n${userPrompt}\n\nReturn the JSON plan now.`;
        const res = await this.callPaid(system, user, 1500);
        if (res.error || !res.text) {
            return { needed: false, reasoning: 'Paid provider failed: ' + (res.error || 'empty'), subTasks: [] };
        }
        return parsePlanJson(res.text);
    }
    // Asks the paid provider to validate the result of a completed sub-task
    // BEFORE moving to the next one. Returns approved=false with a
    // correctionPrompt if something is wrong.
    async validateStep(subTask, modelResponse, recentToolCalls) {
        if (!this.hybridAvailable()) {
            return { approved: true, reason: 'Hybrid not configured — skipping validation' };
        }
        const system = `You are a senior code reviewer validating that a sub-task was completed correctly by a small local LLM. The local model's last actions and final response are shown. Decide if the sub-task is DONE or needs more work.

Output STRICT JSON (no markdown):
{
  "approved": <true|false>,
  "reason": "<one short sentence>",
  "correctionPrompt": "<only if !approved, a SHORT corrective prompt for the local agent to address what's missing>"
}

Be lenient: if the sub-task is 80%+ done and the remaining gap is trivial, approve. Only reject if something essential is missing or clearly broken.`;
        const toolSummary = recentToolCalls.slice(-8).join('\n');
        const user = `Sub-task #${subTask.id}: ${subTask.title}\nOriginal prompt: ${subTask.prompt}\n\nTool calls made (last 8):\n${toolSummary || '(none)'}\n\nFinal response from local model:\n${modelResponse.slice(0, 1200)}\n\nValidate. Output JSON.`;
        const res = await this.callPaid(system, user, 400);
        if (res.error || !res.text) {
            return { approved: true, reason: 'Validator unavailable, assuming OK: ' + (res.error || 'empty') };
        }
        return parseValidationJson(res.text);
    }
    async callPaid(system, user, maxTokens) {
        return (0, hybrid_client_1.callSupportProvider)({
            provider: this.hybridProvider,
            apiKey: this.hybridApiKey,
            model: this.hybridModel || settings_1.DEFAULT_SUPPORT_MODELS[this.hybridProvider],
            system,
            user,
            maxTokens,
        });
    }
}
exports.TaskDecomposerService = TaskDecomposerService;
// ── JSON parsing (tolerant) ──────────────────────────────────────────
function extractJson(raw) {
    // Strip markdown fences if present
    const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    const cleaned = (fence ? fence[1] : raw).trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    return cleaned.slice(start, end + 1);
}
function parsePlanJson(raw) {
    const json = extractJson(raw);
    if (!json) {
        return { needed: false, reasoning: 'Parser: no JSON found in response', subTasks: [] };
    }
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('not an object');
        }
        const subTasks = Array.isArray(parsed.subTasks)
            ? parsed.subTasks.map((t, i) => ({
                id: typeof t.id === 'number' ? t.id : i + 1,
                title: String(t.title || `Sub-task ${i + 1}`).slice(0, 80),
                prompt: String(t.prompt || ''),
                dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d) => typeof d === 'number') : [],
            })).filter((t) => t.prompt.length > 0)
            : [];
        return {
            needed: parsed.needed === true && subTasks.length > 0,
            reasoning: String(parsed.reasoning || ''),
            subTasks,
        };
    }
    catch (e) {
        return { needed: false, reasoning: 'Parser error: ' + (e instanceof Error ? e.message : String(e)), subTasks: [] };
    }
}
function parseValidationJson(raw) {
    const json = extractJson(raw);
    if (!json) {
        return { approved: true, reason: 'Parser: no JSON, assuming OK' };
    }
    try {
        const parsed = JSON.parse(json);
        return {
            approved: parsed.approved !== false, // default to true on ambiguity
            reason: String(parsed.reason || ''),
            correctionPrompt: parsed.correctionPrompt ? String(parsed.correctionPrompt) : undefined,
        };
    }
    catch {
        return { approved: true, reason: 'Parser error, assuming OK' };
    }
}
