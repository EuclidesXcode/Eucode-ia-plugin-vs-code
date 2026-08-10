import * as http from 'http';
import * as crypto from 'crypto';
import * as https from 'https';

// Lightweight local HTTP server for the JARVIS mode. Two purposes:
//   1. Receive transcribed text from an external client (the future mobile
//      app) and inject it as a chat message into the extension.
//   2. Receive raw audio blob and forward it to LM Studio's Whisper endpoint
//      for transcription (STT), returning the text to the caller.
//
// Security model (all three combined):
//   - Bind selectively: 127.0.0.1 by default (loopback only), 0.0.0.0 when
//     the user explicitly enables "Expose to local network" in settings.
//   - Token-based auth: every request must include a bearer token. Token is
//     generated once at first start and persisted in settings.
//   - CORS: reflects only the vscode-webview origin. Requests carrying any
//     other browser Origin are rejected with 403 (no `*`, no credential echo),
//     so a malicious page can't ride a leaked token. Native clients send no
//     Origin and are gated purely by the token.

export type VoiceRequestHandler = (text: string, source: 'mobile' | 'webview') => void;

export interface VoiceServerConfig {
    port: number;
    bindAll: boolean;          // if true, listens on 0.0.0.0 (network), else 127.0.0.1
    token: string;             // bearer token required in Authorization header
    whisperEndpoint?: string;  // LM Studio base URL (e.g. http://localhost:1234)
    whisperModel?: string;     // model id to use for transcription
    onVoiceInput: VoiceRequestHandler;
    onLog?: (msg: string) => void;
}

export class VoiceServer {
    private server: http.Server | null = null;
    private cfg: VoiceServerConfig;

    constructor(cfg: VoiceServerConfig) {
        this.cfg = cfg;
    }

    start(): Promise<{ host: string; port: number }> {
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

    async stop(): Promise<void> {
        const s = this.server;
        if (!s) { return; }
        this.server = null;
        await new Promise<void>(resolve => s.close(() => resolve()));
        this.log('stopped');
    }

    updateConfig(partial: Partial<VoiceServerConfig>): void {
        this.cfg = { ...this.cfg, ...partial };
    }

    isRunning(): boolean { return !!this.server; }

    private bindHost(): string {
        return this.cfg.bindAll ? '0.0.0.0' : '127.0.0.1';
    }

    private log(msg: string): void {
        this.cfg.onLog?.(`[VoiceServer] ${msg}`);
    }

    // Decide se uma Origin de browser pode receber CORS. O cliente mobile
    // nativo NÃO manda Origin (só apps de browser mandam), então requests sem
    // Origin passam — a barreira real deles é o bearer token. Para requests COM
    // Origin (ou seja, feitas a partir de uma página web), só liberamos o
    // webview do próprio VS Code. Isso impede que um site aberto no navegador
    // da vítima faça POST autenticado no agente (CSRF-style) caso o token vaze.
    private isAllowedOrigin(origin: string | undefined): boolean {
        if (!origin) { return true; } // cliente nativo (sem browser) — sem Origin
        return /^vscode-webview:\/\//i.test(origin);
    }

    private setCors(req: http.IncomingMessage, res: http.ServerResponse): void {
        const origin = req.headers['origin'];
        // Só ecoa o header de origem permitida quando ela é confiável. Sem `*`:
        // com credenciais/token, refletir qualquer origem é vetor de CSRF.
        if (typeof origin === 'string' && this.isAllowedOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
    }

    private checkAuth(req: http.IncomingMessage): boolean {
        const auth = req.headers['authorization'];
        if (typeof auth !== 'string') { return false; }
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) { return false; }
        // Comparacao em tempo constante para evitar timing attacks
        const got = Buffer.from(m[1]);
        const expected = Buffer.from(this.cfg.token);
        if (got.length !== expected.length) { return false; }
        return crypto.timingSafeEqual(got, expected);
    }

    private json(res: http.ServerResponse, code: number, body: unknown): void {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.setCors(req, res);
        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }

        // Bloqueia requests vindas de uma página web de origem não confiável
        // ANTES de qualquer processamento. Requests sem Origin (cliente nativo)
        // passam e caem na verificação de token abaixo.
        const origin = req.headers['origin'];
        if (typeof origin === 'string' && !this.isAllowedOrigin(origin)) {
            this.json(res, 403, { ok: false, error: 'forbidden origin' });
            return;
        }

        // Health check (no auth). Resposta mínima: só confirma que o serviço
        // está de pé, sem revelar nome/versão que ajudariam fingerprinting.
        if (req.method === 'GET' && req.url === '/health') {
            this.json(res, 200, { ok: true });
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

    private async handleVoiceInput(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = await readJsonBody(req);
            const text = String((body as any)?.text || '').trim();
            const source = (body as any)?.source === 'mobile' ? 'mobile' : 'webview';
            if (!text) { return this.json(res, 400, { ok: false, error: 'text is required' }); }
            this.cfg.onVoiceInput(text, source);
            this.json(res, 200, { ok: true });
        } catch (e) {
            this.json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    }

    // Forwards a raw audio blob to LM Studio's Whisper-compatible endpoint
    // (/v1/audio/transcriptions) and returns the transcribed text. This keeps
    // STT 100% local on the user's machine.
    private async handleTranscribe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.cfg.whisperEndpoint) {
            return this.json(res, 503, { ok: false, error: 'whisper endpoint not configured' });
        }
        try {
            const audioBuf = await readBinaryBody(req);
            if (audioBuf.length === 0) { return this.json(res, 400, { ok: false, error: 'empty audio body' }); }

            const filename = (req.headers['x-filename'] as string) || 'audio.webm';
            const contentType = (req.headers['content-type'] as string) || 'audio/webm';
            const model = this.cfg.whisperModel || 'whisper-1';
            const language = (req.headers['x-language'] as string) || '';

            // Fallback de path: LM Studio/faster-whisper usam
            // /v1/audio/transcriptions, whisper.cpp standalone usa /inference.
            const base = this.cfg.whisperEndpoint.replace(/\/+$/, '');
            const paths = ['/v1/audio/transcriptions', '/inference'];
            let result = '';
            let lastError: Error | null = null;
            for (const p of paths) {
                try {
                    result = await postMultipartToWhisper(base + p, model, audioBuf, filename, contentType, language);
                    lastError = null;
                    break;
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    lastError = err;
                    if (!/^Whisper 404/.test(err.message)) { break; }
                }
            }
            if (lastError) { throw lastError; }

            this.json(res, 200, { ok: true, text: result });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log(`transcribe error: ${msg}`);
            this.json(res, 500, { ok: false, error: msg });
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c as Buffer));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function readBinaryBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c as Buffer));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// Builds a multipart/form-data body and POSTs it to the Whisper endpoint.
// We don't pull in a dependency for this — multipart is just text framing.
function postMultipartToWhisper(
    url: string,
    model: string,
    audio: Buffer,
    filename: string,
    contentType: string,
    language: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const boundary = '----eucode' + crypto.randomBytes(16).toString('hex');
        const parts: Buffer[] = [];
        const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));

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
            const chunks: Buffer[] = [];
            res.on('data', c => chunks.push(c as Buffer));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    return reject(new Error(`Whisper ${res.statusCode}: ${raw.slice(0, 200)}`));
                }
                try {
                    const json = JSON.parse(raw);
                    // OpenAI-compatible response: { text: "..." }
                    resolve(String(json.text || '').trim());
                } catch {
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

export function generatePairingToken(): string {
    return crypto.randomBytes(24).toString('base64url');
}
