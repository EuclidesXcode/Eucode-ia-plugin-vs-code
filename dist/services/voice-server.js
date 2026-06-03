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
exports.VoiceServer = void 0;
exports.generatePairingToken = generatePairingToken;
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const https = __importStar(require("https"));
class VoiceServer {
    constructor(cfg) {
        this.server = null;
        this.cfg = cfg;
    }
    start() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                return resolve({ host: this.bindHost(), port: this.cfg.port });
            }
            this.server = http.createServer((req, res) => this.handle(req, res));
            this.server.on('error', err => {
                this.log(`server error: ${err.message}`);
                reject(err);
            });
            this.server.listen(this.cfg.port, this.bindHost(), () => {
                this.log(`listening on ${this.bindHost()}:${this.cfg.port}`);
                resolve({ host: this.bindHost(), port: this.cfg.port });
            });
        });
    }
    async stop() {
        const s = this.server;
        if (!s) {
            return;
        }
        this.server = null;
        await new Promise(resolve => s.close(() => resolve()));
        this.log('stopped');
    }
    updateConfig(partial) {
        this.cfg = { ...this.cfg, ...partial };
    }
    isRunning() { return !!this.server; }
    bindHost() {
        return this.cfg.bindAll ? '0.0.0.0' : '127.0.0.1';
    }
    log(msg) {
        this.cfg.onLog?.(`[VoiceServer] ${msg}`);
    }
    setCors(res) {
        // Restritivo: aceita vscode-webview (do plugin local) e qualquer origem
        // que ja tenha sido autenticada pelo token (pareamento previo).
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
    }
    checkAuth(req) {
        const auth = req.headers['authorization'];
        if (typeof auth !== 'string') {
            return false;
        }
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) {
            return false;
        }
        // Comparacao em tempo constante para evitar timing attacks
        const got = Buffer.from(m[1]);
        const expected = Buffer.from(this.cfg.token);
        if (got.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(got, expected);
    }
    json(res, code, body) {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    }
    async handle(req, res) {
        this.setCors(res);
        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }
        // Health check (no auth)
        if (req.method === 'GET' && req.url === '/health') {
            this.json(res, 200, { ok: true, name: 'eucode-voice-server', version: 1 });
            return;
        }
        if (!this.checkAuth(req)) {
            this.json(res, 401, { ok: false, error: 'unauthorized' });
            return;
        }
        // Pairing info (auth required so only the plugin/UI can read it)
        if (req.method === 'GET' && req.url === '/pairing') {
            this.json(res, 200, { ok: true, host: this.bindHost(), port: this.cfg.port });
            return;
        }
        if (req.method === 'POST' && req.url === '/voice-input') {
            return this.handleVoiceInput(req, res);
        }
        if (req.method === 'POST' && req.url === '/transcribe') {
            return this.handleTranscribe(req, res);
        }
        this.json(res, 404, { ok: false, error: 'not found' });
    }
    async handleVoiceInput(req, res) {
        try {
            const body = await readJsonBody(req);
            const text = String(body?.text || '').trim();
            const source = body?.source === 'mobile' ? 'mobile' : 'webview';
            if (!text) {
                return this.json(res, 400, { ok: false, error: 'text is required' });
            }
            this.cfg.onVoiceInput(text, source);
            this.json(res, 200, { ok: true });
        }
        catch (e) {
            this.json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    }
    // Forwards a raw audio blob to LM Studio's Whisper-compatible endpoint
    // (/v1/audio/transcriptions) and returns the transcribed text. This keeps
    // STT 100% local on the user's machine.
    async handleTranscribe(req, res) {
        if (!this.cfg.whisperEndpoint) {
            return this.json(res, 503, { ok: false, error: 'whisper endpoint not configured' });
        }
        try {
            const audioBuf = await readBinaryBody(req);
            if (audioBuf.length === 0) {
                return this.json(res, 400, { ok: false, error: 'empty audio body' });
            }
            const filename = req.headers['x-filename'] || 'audio.webm';
            const contentType = req.headers['content-type'] || 'audio/webm';
            const model = this.cfg.whisperModel || 'whisper-1';
            const language = req.headers['x-language'] || '';
            const result = await postMultipartToWhisper(`${this.cfg.whisperEndpoint.replace(/\/+$/, '')}/v1/audio/transcriptions`, model, audioBuf, filename, contentType, language);
            this.json(res, 200, { ok: true, text: result });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log(`transcribe error: ${msg}`);
            this.json(res, 500, { ok: false, error: msg });
        }
    }
}
exports.VoiceServer = VoiceServer;
// ── Helpers ────────────────────────────────────────────────────────────
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            }
            catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}
function readBinaryBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
// Builds a multipart/form-data body and POSTs it to the Whisper endpoint.
// We don't pull in a dependency for this — multipart is just text framing.
function postMultipartToWhisper(url, model, audio, filename, contentType, language) {
    return new Promise((resolve, reject) => {
        const boundary = '----eucode' + crypto.randomBytes(16).toString('hex');
        const parts = [];
        const push = (s) => parts.push(Buffer.from(s, 'utf8'));
        push(`--${boundary}\r\n`);
        push(`Content-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`);
        if (language) {
            push(`--${boundary}\r\n`);
            push(`Content-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`);
        }
        push(`--${boundary}\r\n`);
        push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
        push(`Content-Type: ${contentType}\r\n\r\n`);
        parts.push(audio);
        push(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat(parts);
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.request({
            method: 'POST',
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
            timeout: 60000,
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    return reject(new Error(`Whisper ${res.statusCode}: ${raw.slice(0, 200)}`));
                }
                try {
                    const json = JSON.parse(raw);
                    // OpenAI-compatible response: { text: "..." }
                    resolve(String(json.text || '').trim());
                }
                catch {
                    reject(new Error('Whisper response was not JSON'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Whisper request timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
function generatePairingToken() {
    return crypto.randomBytes(24).toString('base64url');
}
