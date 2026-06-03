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
exports.WakeWordListener = void 0;
exports.classifyYesNo = classifyYesNo;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class WakeWordListener {
    constructor(cfg) {
        this.running = false;
        this.paused = false;
        this.proc = null;
        this.cfg = cfg;
    }
    isRunning() { return this.running; }
    updateConfig(partial) {
        this.cfg = { ...this.cfg, ...partial };
    }
    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        this.log('wake-word listener iniciado');
        this.loop();
    }
    stop() {
        this.running = false;
        this.setState('idle');
        const p = this.proc;
        this.proc = null;
        if (p) {
            try {
                p.stdin.write('q');
            }
            catch { /* noop */ }
            try {
                p.kill('SIGTERM');
            }
            catch { /* noop */ }
        }
        this.log('wake-word listener parado');
    }
    log(msg) { this.cfg.log?.(`[WakeWord] ${msg}`); }
    setState(s) { this.cfg.onState?.(s); }
    deviceArg() {
        const idx = (this.cfg.deviceIndex && /^\d+$/.test(this.cfg.deviceIndex)) ? this.cfg.deviceIndex : '0';
        return `:${idx}`;
    }
    // Main loop: probe → detect wake word → capture command → repeat.
    async loop() {
        while (this.running) {
            try {
                // Pausado durante uma aprovacao por voz — nao compete pelo mic.
                if (this.paused) {
                    await delay(200);
                    continue;
                }
                this.setState('listening');
                const probe = await this.recordWindow(this.cfg.listenWindowSeconds);
                if (!this.running) {
                    break;
                }
                if (!probe || probe.length < 2048) {
                    continue;
                }
                const text = (await this.cfg.transcribe(probe)).toLowerCase();
                if (!this.running) {
                    break;
                }
                if (!text) {
                    continue;
                }
                this.log(`probe: "${text.slice(0, 60)}"`);
                if (this.containsWakeWord(text)) {
                    this.log('wake word detectada — gravando comando');
                    // Avisa a UI para falar "Estou ouvindo" e espera a fala
                    // terminar antes de gravar, senao o mic captura a propria voz.
                    this.setState('acknowledging');
                    await delay(1700);
                    if (!this.running) {
                        break;
                    }
                    await this.captureCommand();
                }
            }
            catch (e) {
                this.log(`loop erro: ${e instanceof Error ? e.message : String(e)}`);
                // Pequeno backoff para nao entrar em loop quente em caso de falha.
                await delay(800);
            }
        }
    }
    containsWakeWord(text) {
        const w = (this.cfg.wakeWord || 'eucode').toLowerCase().trim();
        if (!w) {
            return false;
        }
        const t = text.toLowerCase();
        // Match exato da palavra configurada (caso o Whisper transcreva certo).
        if (t.includes(w)) {
            return true;
        }
        // Para a wake word padrao "eucode": o Whisper transcreve de varias
        // formas — "eu coude", "eu code", "eu, colde", "you code", "é code"…
        // Detectamos "eu/you/é/ei/hey" + algo parecido com "code" logo apos,
        // tolerando pontuacao/espacos entre as duas partes. Isso evita o falso
        // positivo "eu quero" (a 2a parte precisa comecar com c/k + vogal + l/d).
        if (w === 'eucode') {
            // "eu/you/é/ei/hey" + algo parecido com "code". O Whisper transcreve
            // de muitas formas: code, coude, cuide, cold, coge, coje, coach, coque…
            // Estrutura: prefixo + (c|k) + vogal (o|u) + miolo opcional + terminacao.
            // Terminacao aceita: d/de/di/dy/t (code), g/ge/j/je (coge/coje),
            // ch/che/sh (coach), que/k (coque). Evita "eu quero" (qu+e+r+o).
            const re = /\b(eu|you|yo|é|ei|hey|i)[\s,.:!?-]*(c|k)[ou][uilraã]*(d|de|di|dy|t|g|ge|j|ja|je|jo|ch|che|sh|que|k)\b/i;
            if (re.test(t)) {
                return true;
            }
            // Variantes coladas/curtas que o regex acima pode perder.
            const glued = ['eucode', 'eucoude', 'eucuide', 'eucold', 'eucolde', 'eucoge', 'eucoach', 'youcode', 'ucode', 'ecode'];
            if (glued.some(v => t.includes(v))) {
                return true;
            }
        }
        // Lista de seguranca de variantes textuais conhecidas (vistas nos logs).
        const variants = [
            'eu code', 'eu coude', 'eu cuide', 'eu cuíde', 'eu colde', 'eu cold',
            'eu coldi', 'eu coldy', 'eu cod', 'eu cody', 'eu quode', 'eu cude',
            'eu coge', 'eu coje', 'eu coach', 'eu coqui', 'eu coque', 'eu coch',
            'you code', 'you coude', 'é code', 'é coude', 'é cuide', 'é coach',
            'ei code', 'hey code', 'i code',
        ];
        return variants.some(v => t.includes(v));
    }
    // Records a fixed-length window to a temp wav and returns its bytes.
    recordWindow(seconds) {
        const outFile = path.join(os.tmpdir(), `eucode-wake-${Date.now()}.wav`);
        const args = [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'avfoundation', '-i', this.deviceArg(),
            '-ac', '1', '-ar', '16000',
            '-t', String(seconds),
            '-y', outFile,
        ];
        return this.runFfmpeg(args, outFile);
    }
    // Records the command until ~silenceSeconds of silence (silencedetect) or
    // the hard cap, whichever comes first, then transcribes and emits it.
    async captureCommand() {
        this.setState('recording');
        const outFile = path.join(os.tmpdir(), `eucode-cmd-${Date.now()}.wav`);
        const args = [
            '-hide_banner', '-loglevel', 'info',
            '-f', 'avfoundation', '-i', this.deviceArg(),
            '-af', `silencedetect=noise=-30dB:d=${this.cfg.silenceSeconds}`,
            '-ac', '1', '-ar', '16000',
            '-t', String(this.cfg.maxCommandSeconds),
            '-y', outFile,
        ];
        const buffer = await this.runFfmpeg(args, outFile, /*stopOnSilence*/ true);
        if (!this.running) {
            return;
        }
        if (!buffer || buffer.length < 2048) {
            this.log('comando vazio — ignorando');
            return;
        }
        this.setState('transcribing');
        const text = (await this.cfg.transcribe(buffer)).trim();
        if (!text) {
            this.log('transcricao vazia');
            return;
        }
        // Remove a propria wake word do inicio do comando, se veio junto.
        const cleaned = this.stripWakeWord(text);
        this.log(`comando: "${cleaned.slice(0, 80)}"`);
        if (cleaned) {
            this.cfg.onCommand(cleaned);
        }
    }
    // Listens for a spoken yes/no answer (for LLM approval prompts). Pauses the
    // wake-word loop, records a short window ending on silence, classifies, and
    // re-listens up to `attempts` times if the answer is ambiguous.
    // Resolves 'yes' | 'no' | 'unclear'. The caller maps it to approve/reject.
    async captureYesNo(attempts = 3) {
        if (!this.running) {
            return 'unclear';
        }
        this.paused = true;
        // Espera o probe em andamento liberar o mic.
        await delay(250);
        try {
            for (let i = 0; i < attempts; i++) {
                this.setState('recording');
                const outFile = path.join(os.tmpdir(), `eucode-yn-${Date.now()}.wav`);
                const args = [
                    '-hide_banner', '-loglevel', 'info',
                    '-f', 'avfoundation', '-i', this.deviceArg(),
                    // Respostas sim/nao sao curtas — pausa menor (1.5s) e teto de 8s.
                    '-af', 'silencedetect=noise=-30dB:d=1.5',
                    '-ac', '1', '-ar', '16000',
                    '-t', '8',
                    '-y', outFile,
                ];
                const buffer = await this.runFfmpeg(args, outFile, /*stopOnSilence*/ true);
                if (!buffer || buffer.length < 2048) {
                    continue;
                }
                this.setState('transcribing');
                const text = (await this.cfg.transcribe(buffer)).toLowerCase().trim();
                this.log(`resposta sim/nao: "${text.slice(0, 60)}"`);
                const verdict = classifyYesNo(text);
                if (verdict !== 'unclear') {
                    return verdict;
                }
                this.log('resposta ambigua — re-escutando');
            }
            return 'unclear';
        }
        finally {
            this.paused = false;
            this.setState('listening');
        }
    }
    stripWakeWord(text) {
        const w = (this.cfg.wakeWord || 'eucode').toLowerCase();
        let out = text;
        // Tira a palavra de ativacao (e variantes do "eucode") do comeco da
        // frase, junto com pontuacao/virgula que costuma vir depois.
        out = out.replace(new RegExp('^\\s*' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s,.:!?-]*', 'i'), '');
        if (w === 'eucode') {
            out = out.replace(/^\s*(eu|you|yo|é|ei|hey|i)[\s,.:!?-]*(c|k)[ou][uilraã]*(d|de|di|dy|t|g|ge|j|ja|je|jo|ch|che|sh|que|k)\b[\s,.:!?-]*/i, '');
        }
        return out.trim();
    }
    // Spawns ffmpeg, optionally stopping early when silencedetect reports a
    // silence_start that lasts >= silenceSeconds. Resolves with the wav bytes.
    runFfmpeg(args, outFile, stopOnSilence = false) {
        return new Promise((resolve) => {
            let settled = false;
            const proc = (0, child_process_1.spawn)(this.cfg.ffmpegPath, args);
            this.proc = proc;
            let silenceTimer = null;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                }
                if (this.proc === proc) {
                    this.proc = null;
                }
                try {
                    if (fs.existsSync(outFile)) {
                        const buf = fs.readFileSync(outFile);
                        fs.unlink(outFile, () => { });
                        resolve(buf);
                    }
                    else {
                        resolve(null);
                    }
                }
                catch {
                    resolve(null);
                }
            };
            if (stopOnSilence) {
                proc.stderr.on('data', (d) => {
                    const s = d.toString();
                    // ffmpeg emits "silence_start: <t>" when audio drops below threshold.
                    if (/silence_start/.test(s)) {
                        // Gracefully stop shortly after the silence threshold is met.
                        // silencedetect's d= already waited silenceSeconds, so stop now.
                        if (!silenceTimer) {
                            silenceTimer = setTimeout(() => {
                                this.log('silencio detectado — encerrando gravacao');
                                try {
                                    proc.stdin.write('q');
                                }
                                catch { /* noop */ }
                                try {
                                    proc.kill('SIGTERM');
                                }
                                catch { /* noop */ }
                            }, 200);
                        }
                    }
                    if (/silence_end/.test(s)) {
                        if (silenceTimer) {
                            clearTimeout(silenceTimer);
                            silenceTimer = null;
                        }
                    }
                });
            }
            proc.on('error', (err) => {
                this.log(`ffmpeg erro: ${err.message}`);
                finish();
            });
            proc.on('exit', () => finish());
        });
    }
}
exports.WakeWordListener = WakeWordListener;
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
// Classifies a transcribed answer as affirmative / negative / unclear.
// PT-BR first (the typical case), plus common EN words.
function classifyYesNo(text) {
    const t = ' ' + text.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const yes = [
        'sim', 'pode', 'pode sim', 'claro', 'aprovo', 'aprovado', 'aprovar',
        'confirma', 'confirmo', 'confirmado', 'pode ser', 'isso', 'isso ai',
        'positivo', 'manda', 'manda ver', 'beleza', 'ok', 'okay', 'okey',
        'certo', 'correto', 'concordo', 'vai', 'vai la', 'autorizo', 'libera',
        'libere', 'aceito', 'tudo bem', 'tá bom', 'ta bom', 'tá', 'yes', 'yeah',
        'yep', 'sure', 'go', 'do it', 'approve', 'approved', 'continua', 'continuar',
    ];
    const no = [
        'não', 'nao', 'nunca', 'jamais', 'negativo', 'cancela', 'cancelar',
        'cancelado', 'recuso', 'recusa', 'recusar', 'recusado', 'rejeita',
        'rejeito', 'rejeitar', 'para', 'pare', 'espera', 'espere', 'nem pensar',
        'de jeito nenhum', 'no', 'nope', 'cancel', 'stop', 'deny', 'reject', 'abort',
    ];
    // "nao" tem prioridade — frases como "nao pode" devem virar NO mesmo
    // contendo "pode".
    const hasNo = no.some(w => t.includes(' ' + w + ' '));
    const hasYes = yes.some(w => t.includes(' ' + w + ' '));
    if (hasNo && !hasYes) {
        return 'no';
    }
    if (hasNo && /\bn[aã]o\b/.test(t)) {
        return 'no';
    } // "nao" explicito ganha
    if (hasYes && !hasNo) {
        return 'yes';
    }
    if (hasYes && hasNo) {
        return 'unclear';
    } // conflito → re-escuta
    return 'unclear';
}
