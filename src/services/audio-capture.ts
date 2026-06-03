import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Captures microphone audio from the OS using ffmpeg, OUTSIDE the VSCode
// webview. This is required because the webview iframe blocks getUserMedia
// (Electron denies media access to webviews — confirmed: NotAllowedError with
// no macOS prompt). Capturing in the extension host (Node) lets the OS grant
// the real microphone permission to VSCode itself.
//
// Flow: start() spawns ffmpeg recording to a temp wav; stop() ends ffmpeg and
// returns the recorded buffer. The caller forwards it to Whisper for STT.

export type AudioCaptureLog = (msg: string) => void;

export interface CaptureResult {
    buffer: Buffer;
    mimeType: string;
    filePath: string;
}

const FFMPEG_CANDIDATES = [
    '/opt/homebrew/bin/ffmpeg', // Apple Silicon Homebrew
    '/usr/local/bin/ffmpeg',    // Intel Homebrew
    'ffmpeg',                   // PATH fallback
];

export class AudioCapture {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private outFile = '';
    private ffmpegPath: string;
    private log: AudioCaptureLog;
    private startedAt = 0;

    constructor(log: AudioCaptureLog = () => {}, ffmpegPath?: string) {
        this.log = log;
        this.ffmpegPath = ffmpegPath || AudioCapture.resolveFfmpeg();
    }

    static resolveFfmpeg(): string {
        for (const c of FFMPEG_CANDIDATES) {
            if (c === 'ffmpeg') { return c; }
            try { if (fs.existsSync(c)) { return c; } } catch { /* noop */ }
        }
        return 'ffmpeg';
    }

    // Returns the resolved ffmpeg path if it actually runs, else null.
    static async checkFfmpeg(ffmpegPath?: string): Promise<string | null> {
        const bin = ffmpegPath || AudioCapture.resolveFfmpeg();
        return new Promise(resolve => {
            execFile(bin, ['-version'], (err) => resolve(err ? null : bin));
        });
    }

    // Lists macOS avfoundation audio input devices by parsing ffmpeg's stderr.
    // Returns e.g. [{ index: '0', label: 'Microfone (MacBook Air)' }].
    static listAudioDevices(ffmpegPath?: string): Promise<Array<{ index: string; label: string }>> {
        const bin = ffmpegPath || AudioCapture.resolveFfmpeg();
        return new Promise(resolve => {
            // -list_devices prints to stderr and exits non-zero by design.
            execFile(bin, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
                (_err, _stdout, stderr) => {
                    const devices: Array<{ index: string; label: string }> = [];
                    const text = stderr || '';
                    let inAudio = false;
                    for (const line of text.split('\n')) {
                        if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
                        if (/AVFoundation video devices/i.test(line)) { inAudio = false; continue; }
                        if (!inAudio) { continue; }
                        // Line format: "[AVFoundation indev @ 0x..] [0] Microfone (MacBook Air)"
                        const m = line.match(/\]\s*\[(\d+)\]\s*(.+?)\s*$/);
                        if (m) { devices.push({ index: m[1], label: m[2] }); }
                    }
                    resolve(devices);
                });
        });
    }

    isRecording(): boolean { return !!this.proc; }

    // Spawns ffmpeg capturing the default macOS microphone (avfoundation,
    // audio device index ":0") into a temp wav file. The first run triggers
    // the macOS microphone permission prompt for VSCode.
    start(deviceIndex?: string): void {
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
        this.proc = spawn(this.ffmpegPath, args);
        this.startedAt = Date.now();

        this.proc.stderr.on('data', (d: Buffer) => {
            const s = d.toString().trim();
            if (s) { this.log(`ffmpeg: ${s}`); }
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
    stop(): Promise<CaptureResult> {
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
                    fs.unlink(outFile, () => {});
                    if (buffer.length < 1024) {
                        return reject(new Error('audio muito curto ou vazio'));
                    }
                    resolve({ buffer, mimeType: 'audio/wav', filePath: outFile });
                } catch (e) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            };

            proc.once('exit', () => finalize());

            // Graceful stop: 'q' tells ffmpeg to finalize the file.
            try { proc.stdin.write('q'); } catch { /* noop */ }
            // Safety net: force-kill if it doesn't exit promptly.
            setTimeout(() => {
                if (!proc.killed) {
                    try { proc.kill('SIGTERM'); } catch { /* noop */ }
                }
            }, 1500);
        });
    }

    // Aborts recording without returning audio (e.g. on dispose).
    abort(): void {
        const proc = this.proc;
        this.proc = null;
        if (proc) {
            try { proc.stdin.write('q'); } catch { /* noop */ }
            try { proc.kill('SIGTERM'); } catch { /* noop */ }
        }
        if (this.outFile) { fs.unlink(this.outFile, () => {}); }
    }
}
