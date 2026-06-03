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
exports.AudioCapture = void 0;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const FFMPEG_CANDIDATES = [
    '/opt/homebrew/bin/ffmpeg', // Apple Silicon Homebrew
    '/usr/local/bin/ffmpeg', // Intel Homebrew
    'ffmpeg', // PATH fallback
];
class AudioCapture {
    constructor(log = () => { }, ffmpegPath) {
        this.proc = null;
        this.outFile = '';
        this.startedAt = 0;
        this.log = log;
        this.ffmpegPath = ffmpegPath || AudioCapture.resolveFfmpeg();
    }
    static resolveFfmpeg() {
        for (const c of FFMPEG_CANDIDATES) {
            if (c === 'ffmpeg') {
                return c;
            }
            try {
                if (fs.existsSync(c)) {
                    return c;
                }
            }
            catch { /* noop */ }
        }
        return 'ffmpeg';
    }
    // Returns the resolved ffmpeg path if it actually runs, else null.
    static async checkFfmpeg(ffmpegPath) {
        const bin = ffmpegPath || AudioCapture.resolveFfmpeg();
        return new Promise(resolve => {
            (0, child_process_1.execFile)(bin, ['-version'], (err) => resolve(err ? null : bin));
        });
    }
    // Lists macOS avfoundation audio input devices by parsing ffmpeg's stderr.
    // Returns e.g. [{ index: '0', label: 'Microfone (MacBook Air)' }].
    static listAudioDevices(ffmpegPath) {
        const bin = ffmpegPath || AudioCapture.resolveFfmpeg();
        return new Promise(resolve => {
            // -list_devices prints to stderr and exits non-zero by design.
            (0, child_process_1.execFile)(bin, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], (_err, _stdout, stderr) => {
                const devices = [];
                const text = stderr || '';
                let inAudio = false;
                for (const line of text.split('\n')) {
                    if (/AVFoundation audio devices/i.test(line)) {
                        inAudio = true;
                        continue;
                    }
                    if (/AVFoundation video devices/i.test(line)) {
                        inAudio = false;
                        continue;
                    }
                    if (!inAudio) {
                        continue;
                    }
                    // Line format: "[AVFoundation indev @ 0x..] [0] Microfone (MacBook Air)"
                    const m = line.match(/\]\s*\[(\d+)\]\s*(.+?)\s*$/);
                    if (m) {
                        devices.push({ index: m[1], label: m[2] });
                    }
                }
                resolve(devices);
            });
        });
    }
    isRecording() { return !!this.proc; }
    // Spawns ffmpeg capturing the default macOS microphone (avfoundation,
    // audio device index ":0") into a temp wav file. The first run triggers
    // the macOS microphone permission prompt for VSCode.
    start(deviceIndex) {
        if (this.proc) {
            this.log('start ignored — already recording');
            return;
        }
        this.outFile = path.join(os.tmpdir(), `eucode-voice-${Date.now()}.wav`);
        // -f avfoundation -i ":<idx>"  → no video, chosen audio device.
        // Empty/invalid index falls back to ":0" (system default mic).
        const idx = (deviceIndex && /^\d+$/.test(deviceIndex)) ? deviceIndex : '0';
        // 16kHz mono wav is ideal for Whisper and small.
        const args = [
            '-hide_banner', '-loglevel', 'warning',
            '-f', 'avfoundation',
            '-i', `:${idx}`,
            '-ac', '1',
            '-ar', '16000',
            '-y', this.outFile,
        ];
        this.log(`spawn: ${this.ffmpegPath} ${args.join(' ')}`);
        this.proc = (0, child_process_1.spawn)(this.ffmpegPath, args);
        this.startedAt = Date.now();
        this.proc.stderr.on('data', (d) => {
            const s = d.toString().trim();
            if (s) {
                this.log(`ffmpeg: ${s}`);
            }
        });
        this.proc.on('error', (err) => {
            this.log(`ffmpeg spawn error: ${err.message}`);
            this.proc = null;
        });
        this.proc.on('exit', (code, signal) => {
            this.log(`ffmpeg exited code=${code} signal=${signal}`);
        });
    }
    // Stops ffmpeg gracefully and resolves with the recorded audio buffer.
    // ffmpeg writes the wav trailer on SIGINT/'q', so we send 'q' to stdin
    // (clean finalize) and fall back to SIGTERM.
    stop() {
        return new Promise((resolve, reject) => {
            const proc = this.proc;
            const outFile = this.outFile;
            if (!proc) {
                return reject(new Error('not recording'));
            }
            const durationMs = Date.now() - this.startedAt;
            this.proc = null;
            const finalize = () => {
                try {
                    if (!fs.existsSync(outFile)) {
                        return reject(new Error('arquivo de audio nao foi criado pelo ffmpeg'));
                    }
                    const buffer = fs.readFileSync(outFile);
                    this.log(`captured ${buffer.length} bytes in ${durationMs}ms`);
                    // Best-effort cleanup; ignore failures.
                    fs.unlink(outFile, () => { });
                    if (buffer.length < 1024) {
                        return reject(new Error('audio muito curto ou vazio'));
                    }
                    resolve({ buffer, mimeType: 'audio/wav', filePath: outFile });
                }
                catch (e) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            };
            proc.once('exit', () => finalize());
            // Graceful stop: 'q' tells ffmpeg to finalize the file.
            try {
                proc.stdin.write('q');
            }
            catch { /* noop */ }
            // Safety net: force-kill if it doesn't exit promptly.
            setTimeout(() => {
                if (!proc.killed) {
                    try {
                        proc.kill('SIGTERM');
                    }
                    catch { /* noop */ }
                }
            }, 1500);
        });
    }
    // Aborts recording without returning audio (e.g. on dispose).
    abort() {
        const proc = this.proc;
        this.proc = null;
        if (proc) {
            try {
                proc.stdin.write('q');
            }
            catch { /* noop */ }
            try {
                proc.kill('SIGTERM');
            }
            catch { /* noop */ }
        }
        if (this.outFile) {
            fs.unlink(this.outFile, () => { });
        }
    }
}
exports.AudioCapture = AudioCapture;
