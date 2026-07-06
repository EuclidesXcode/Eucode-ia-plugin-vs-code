import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIWithVision, checkConnection, checkAnthropicConnection } from './services/api-client';
import { buildHistorySummary, HistoryEntry } from './services/history-service';
import { HistoryManagerService } from './services/HistoryManagerService';
import { collectWorkspaceContext, collectDiagnostics, getDefaultCwd } from './workspace/context';
import { runAgentLoop, ConfirmWriteRequest, ConfirmCommandRequest, ConfirmCommandDecision, TodoItem, HybridActivityEvent } from './agent/loop';
import { SYSTEM_PROMPT } from './agent/prompt';
import { loadSettings, saveSettings, buildApiEndpoint, buildAuthHeader, EucodeSettings } from './config/settings';
import { EucodeInlineCompletionProvider } from './providers/inline-completion-provider';
import { EucodeFixCodeActionProvider, executeFixWithEucode } from './providers/fix-code-action-provider';
import { loadCommands, appendCommand, getCommandsFilePath, watchCommandsFile, CustomCommand, CommandsScope } from './services/custom-commands';
import { deleteSessionMemory, getSessionMemoryPath, rememberDecision } from './services/memory-service';
import { ensureEucodeWorkspace, revealEucodeDir } from './services/workspace-init';
import { VoiceServer, generatePairingToken } from './services/voice-server';
import { AudioCapture } from './services/audio-capture';
import { WakeWordListener, WakeWordState } from './services/wake-word';
import { DEFAULT_MODEL, JARVIS_ENABLED } from './utils/constants';

class EucodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'eucode-ia.chatView';
    private _historyManager: HistoryManagerService;
    private _sessionHistory: HistoryEntry[] = [];
    private _settings: EucodeSettings;

    public getCurrentSettings(): EucodeSettings { return this._settings; }
    private _pendingConfirms = new Map<string, (approved: boolean) => void>();
    private _pendingCommandConfirms = new Map<string, (decision: ConfirmCommandDecision) => void>();
    private _abortController: AbortController | null = null;
    private _injectMessage: ((msg: string) => void) | null = null;
    private _windowFocused: boolean = true;
    private _voiceServer: VoiceServer | null = null;
    private _injectFromVoice: ((text: string, source: 'mobile' | 'webview') => void) | null = null;
    private _audioCapture: AudioCapture | null = null;
    private _wakeWord: WakeWordListener | null = null;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._historyManager = new HistoryManagerService(_context);
        this._sessionHistory = this._historyManager.load();
        this._settings = loadSettings(_context);
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        const htmlPath = path.join(this._context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
        webviewView.webview.html = fs.readFileSync(htmlPath, 'utf8');

        const notify = (text: string) => webviewView.webview.postMessage({ command: 'status', text });

        this._windowFocused = vscode.window.state.focused;
        this._context.subscriptions.push(
            vscode.window.onDidChangeWindowState(state => { this._windowFocused = state.focused; })
        );

        const notifyUser = (message: string, actions: string[] = []) => {
            if (!this._windowFocused) {
                vscode.window.showInformationMessage(`Eucode IA: ${message}`, ...actions).then(action => {
                    if (action) { webviewView.show(true); }
                });
                // Notificacao nativa do sistema operacional (macOS)
                if (process.platform === 'darwin') {
                    const safe = message.replace(/"/g, '\\"');
                    require('child_process').exec(
                        `osascript -e 'display notification "${safe}" with title "Eucode IA"'`
                    );
                }
            }
        };

        // Quando a wake word esta ativa, tenta resolver a aprovacao por voz em
        // paralelo ao card visual. `onYes`/`onNo` so disparam se o pending ainda
        // existir (ou seja, o usuario nao clicou antes). Mantem mãos-livres.
        const tryVoiceApproval = (
            pendingId: string,
            stillPending: () => boolean,
            onYes: () => void,
            onNo: () => void,
        ) => {
            if (!this._wakeWord?.isRunning()) { return; }
            // Espera a pergunta falada ("Posso editar X? Diga sim ou não")
            // terminar antes de abrir o microfone, senao captura a propria voz.
            const APPROVAL_SPEAK_DELAY_MS = 2800;
            setTimeout(() => {
                if (!stillPending() || !this._wakeWord?.isRunning()) { return; }
                webviewView.webview.postMessage({ command: 'voice_approval_listening', id: pendingId });
                this._wakeWord.captureYesNo().then(verdict => {
                if (!stillPending()) { return; } // usuario ja decidiu no clique
                if (verdict === 'yes') {
                    webviewView.webview.postMessage({ command: 'voice_approval_result', id: pendingId, verdict: 'yes' });
                    onYes();
                } else if (verdict === 'no') {
                    webviewView.webview.postMessage({ command: 'voice_approval_result', id: pendingId, verdict: 'no' });
                    onNo();
                } else {
                    // 'unclear' apos as tentativas — deixa o card para clique manual.
                    webviewView.webview.postMessage({ command: 'voice_approval_result', id: pendingId, verdict: 'unclear' });
                }
                }).catch(() => { /* falha de captura — card permanece para clique */ });
            }, APPROVAL_SPEAK_DELAY_MS);
        };

        const makeConfirmWrite = (): (req: ConfirmWriteRequest) => Promise<boolean> =>
            (req) => new Promise<boolean>((resolve) => {
                const id = `confirm_${Date.now()}`;
                this._pendingConfirms.set(id, resolve);
                webviewView.webview.postMessage({ command: 'confirm_write', id, filePath: req.filePath, before: req.before, after: req.after });
                notifyUser(`Aguardando aprovacao para editar "${path.basename(req.filePath)}"`, ['Abrir chat']);
                tryVoiceApproval(
                    id,
                    () => this._pendingConfirms.has(id),
                    () => { this._pendingConfirms.delete(id); resolve(true); },
                    () => { this._pendingConfirms.delete(id); resolve(false); },
                );
            });

        const makeConfirmCommand = (): (req: ConfirmCommandRequest) => Promise<ConfirmCommandDecision> =>
            (req) => new Promise<ConfirmCommandDecision>((resolve) => {
                const id = `cmd_${Date.now()}`;
                this._pendingCommandConfirms.set(id, resolve);
                webviewView.webview.postMessage({ command: 'confirm_command', id, cmd: req.command, cwd: req.cwd });
                notifyUser(`Aguardando aprovacao para executar comando`, ['Abrir chat']);
                tryVoiceApproval(
                    id,
                    () => this._pendingCommandConfirms.has(id),
                    // "sim" por voz aprova so esta vez (mais seguro que 'session').
                    () => { this._pendingCommandConfirms.delete(id); resolve('once'); },
                    () => { this._pendingCommandConfirms.delete(id); resolve('block'); },
                );
            });

        const getDiagnostics = (): string => collectDiagnostics();

        const makeTodoUpdate = () => (todos: TodoItem[]) => {
            webviewView.webview.postMessage({ command: 'todo_update', todos });
        };

        const pingAndNotify = async (s: EucodeSettings) => {
            const online = s.provider === 'anthropic'
                ? await checkAnthropicConnection(s.apiKey)
                : await checkConnection(buildApiEndpoint(s), buildAuthHeader(s));
            webviewView.webview.postMessage({ command: 'connection_status', online });
        };

        this._context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this._sessionHistory = this._historyManager.load();
                const filtered = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: filtered });
            })
        );

        const sendOpenFiles = () => {
            const ctx = collectWorkspaceContext();
            webviewView.webview.postMessage({ command: 'open_files', files: ctx.openFiles });
        };

        // Loads commands from the configured scope and pushes them to the
        // webview so the chat input can autocomplete on `/`. Errors come
        // through as a separate field for non-blocking display.
        const pushCommandsToWebview = () => {
            const scope = this._settings.customCommandsScope;
            const { commands, errors } = loadCommands(scope);
            webviewView.webview.postMessage({
                command: 'command_list',
                commands,
                errors,
                scope,
                filePath: getCommandsFilePath(scope),
            });
        };

        // Hot-reload: rewatch whenever the scope changes
        let commandsWatcher: vscode.Disposable = watchCommandsFile(
            this._settings.customCommandsScope,
            () => pushCommandsToWebview()
        );
        this._context.subscriptions.push({
            dispose: () => commandsWatcher.dispose(),
        });

        const rewatchCommands = () => {
            commandsWatcher.dispose();
            commandsWatcher = watchCommandsFile(
                this._settings.customCommandsScope,
                () => pushCommandsToWebview()
            );
        };

        // Voice server: ensures a pairing token exists, then (re)starts the
        // HTTP server when the user enables voice features in settings.
        const ensurePairingToken = async (): Promise<string> => {
            if (this._settings.voicePairingToken) { return this._settings.voicePairingToken; }
            const token = generatePairingToken();
            this._settings = { ...this._settings, voicePairingToken: token };
            await saveSettings(this._context, this._settings);
            return token;
        };

        const dispatchVoiceText = (text: string, source: 'mobile' | 'webview') => {
            // Reuse the inject path if the agent is currently running; otherwise
            // post a synthetic user_input message to the webview so the regular
            // flow takes over (renders the bubble, hits the LLM, etc).
            if (this._injectMessage) {
                this._injectMessage(text);
            } else {
                webviewView.webview.postMessage({ command: 'voice_text_received', text, source });
            }
        };
        this._injectFromVoice = dispatchVoiceText;

        const startOrUpdateVoiceServer = async () => {
            // JARVIS pausado: nunca sobe o servidor HTTP de voz (remove a
            // superfície de rede do caminho padrão). Se já estava rodando de
            // uma sessão anterior, garante que pare.
            if (!JARVIS_ENABLED) {
                if (this._voiceServer?.isRunning()) { await this._voiceServer.stop(); }
                return;
            }
            if (!this._settings.voiceServerEnabled) {
                if (this._voiceServer?.isRunning()) { await this._voiceServer.stop(); }
                return;
            }
            const token = await ensurePairingToken();
            const cfg = {
                port: this._settings.voiceServerPort || 9876,
                bindAll: this._settings.voiceServerExposeNetwork,
                token,
                whisperEndpoint: this._settings.whisperEndpoint,
                whisperModel: this._settings.whisperModel,
                onVoiceInput: dispatchVoiceText,
                onLog: (msg: string) => console.log(msg),
            };
            if (this._voiceServer?.isRunning()) {
                await this._voiceServer.stop();
            }
            this._voiceServer = new VoiceServer(cfg);
            try {
                const info = await this._voiceServer.start();
                webviewView.webview.postMessage({
                    command: 'voice_server_status',
                    running: true,
                    host: info.host,
                    port: info.port,
                });
            } catch (e) {
                webviewView.webview.postMessage({
                    command: 'voice_server_status',
                    running: false,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        };
        this._context.subscriptions.push({
            dispose: () => { this._voiceServer?.stop(); },
        });
        startOrUpdateVoiceServer();

        // ── Wake word (escuta continua "Eucode" → grava ate pausa → envia) ──
        const wwLog = (m: string) => {
            console.log(m);
            webviewView.webview.postMessage({ command: 'jarvis_log', text: m });
        };
        const startOrUpdateWakeWord = async () => {
            // JARVIS pausado: nunca inicia a escuta contínua por wake word.
            if (!JARVIS_ENABLED) {
                if (this._wakeWord?.isRunning()) { this._wakeWord.stop(); }
                webviewView.webview.postMessage({ command: 'wake_word_state', state: 'idle' });
                return;
            }
            const wantOn = this._settings.jarvisEnabled && this._settings.wakeWordEnabled;
            if (!wantOn) {
                if (this._wakeWord?.isRunning()) { this._wakeWord.stop(); }
                webviewView.webview.postMessage({ command: 'wake_word_state', state: 'idle' });
                return;
            }
            const bin = await AudioCapture.checkFfmpeg();
            if (!bin) {
                webviewView.webview.postMessage({
                    command: 'wake_word_state', state: 'idle',
                    error: 'ffmpeg nao encontrado (brew install ffmpeg)',
                });
                return;
            }
            const cfg = {
                ffmpegPath: bin,
                deviceIndex: this._settings.micDeviceIndex,
                wakeWord: (this._settings.wakeWord || 'eucode').toLowerCase(),
                silenceSeconds: 5,
                maxCommandSeconds: 30,
                listenWindowSeconds: 3,
                transcribe: (wav: Buffer) => transcribeViaWhisper(
                    this._settings.whisperEndpoint,
                    this._settings.whisperModel,
                    this._settings.whisperLanguage,
                    wav,
                    'audio/wav'
                ),
                onCommand: (text: string) => dispatchVoiceText(text, 'webview'),
                onState: (state: WakeWordState) =>
                    webviewView.webview.postMessage({ command: 'wake_word_state', state }),
                log: wwLog,
            };
            if (this._wakeWord?.isRunning()) {
                this._wakeWord.updateConfig(cfg);
            } else {
                this._wakeWord = new WakeWordListener(cfg);
                this._wakeWord.start();
            }
        };
        this._context.subscriptions.push({ dispose: () => { this._wakeWord?.stop(); } });
        startOrUpdateWakeWord();

        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => sendOpenFiles()),
            vscode.window.tabGroups.onDidChangeTabs(() => sendOpenFiles())
        );

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            if (message?.command === 'jarvis_log') {
                console.log('[JARVIS]', message.text);
                return;
            }

            if (message?.command === 'webview_ready') {
                // Initialize/migrate the .eucode/ workspace folder. Idempotent —
                // safe to call on every open. Surfaces a notification if legacy
                // files were moved into .eucode/ this run.
                const initResult = ensureEucodeWorkspace();
                if (initResult.migrated.length > 0) {
                    const moved = initResult.migrated.join(', ');
                    vscode.window.showInformationMessage(
                        `Eucode IA: ${moved} foram movidos para .eucode/. Tudo continua funcionando.`,
                        'Abrir pasta'
                    ).then(action => { if (action === 'Abrir pasta') { revealEucodeDir(); } });
                }

                webviewView.webview.postMessage({
                    command: 'load_config',
                    jarvisFeatureEnabled: JARVIS_ENABLED,
                    provider: this._settings.provider,
                    apiHost: this._settings.apiHost,
                    apiKey: this._settings.apiKey,
                    model: this._settings.model,
                    enabledTools: this._settings.enabledTools,
                    ragEnabled: this._settings.ragEnabled,
                    ragProvider: this._settings.ragProvider,
                    ragEndpoint: this._settings.ragEndpoint,
                    ragCollection: this._settings.ragCollection,
                    ragEmbedHost: this._settings.ragEmbedHost,
                    ragEmbedModel: this._settings.ragEmbedModel,
                    hybridEnabled: this._settings.hybridEnabled,
                    supportProvider: this._settings.supportProvider,
                    supportApiKey: this._settings.supportApiKey,
                    supportModel: this._settings.supportModel,
                    inlineCompletionEnabled: this._settings.inlineCompletionEnabled,
                    fixWithEucodeEnabled: this._settings.fixWithEucodeEnabled,
                    customCommandsScope: this._settings.customCommandsScope,
                    hybridIntensity: this._settings.hybridIntensity,
                    projectIntelEnabled: this._settings.projectIntelEnabled,
                    jarvisEnabled: this._settings.jarvisEnabled,
                    jarvisAutoSpeak: this._settings.jarvisAutoSpeak,
                    jarvisTtsVoice: this._settings.jarvisTtsVoice,
                    jarvisTtsRate: this._settings.jarvisTtsRate,
                    whisperEndpoint: this._settings.whisperEndpoint,
                    whisperModel: this._settings.whisperModel,
                    whisperLanguage: this._settings.whisperLanguage,
                    voiceServerEnabled: this._settings.voiceServerEnabled,
                    voiceServerPort: this._settings.voiceServerPort,
                    voiceServerExposeNetwork: this._settings.voiceServerExposeNetwork,
                    micDeviceIndex: this._settings.micDeviceIndex,
                    wakeWordEnabled: this._settings.wakeWordEnabled,
                    wakeWord: this._settings.wakeWord,
                });
                const history = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: history });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                pingAndNotify(this._settings);
                sendOpenFiles();
                pushCommandsToWebview();
                return;
            }

            if (message?.command === 'new_session') {
                this._sessionHistory = await this._historyManager.newSession();
                webviewView.webview.postMessage({ command: 'session_started', entries: [] });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'load_session') {
                this._sessionHistory = await this._historyManager.loadSession(message.id);
                webviewView.webview.postMessage({ command: 'load_history', entries: this._sessionHistory });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'delete_session') {
                // Delete the per-session memory file alongside the session itself
                deleteSessionMemory(message.id);
                await this._historyManager.deleteSession(message.id);
                this._sessionHistory = this._historyManager.load();
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'save_config') {
                this._settings = {
                    provider: message.provider ?? this._settings.provider,
                    apiHost: message.apiHost ?? this._settings.apiHost,
                    // Empty string from UI means "don't change" — preserve stored key.
                    // (UI sends '' when the user doesn't retype the key on save.)
                    apiKey: (message.apiKey && message.apiKey.length > 0)
                        ? message.apiKey
                        : this._settings.apiKey,
                    model: message.model ?? '',
                    enabledTools: message.enabledTools ?? this._settings.enabledTools,
                    ragEnabled: message.ragEnabled ?? this._settings.ragEnabled,
                    ragProvider: message.ragProvider ?? this._settings.ragProvider,
                    ragEndpoint: message.ragEndpoint ?? this._settings.ragEndpoint,
                    ragCollection: message.ragCollection ?? this._settings.ragCollection,
                    ragEmbedHost: message.ragEmbedHost ?? this._settings.ragEmbedHost,
                    ragEmbedModel: message.ragEmbedModel ?? this._settings.ragEmbedModel,
                    hybridEnabled: message.hybridEnabled ?? this._settings.hybridEnabled,
                    supportProvider: message.supportProvider ?? this._settings.supportProvider,
                    // Empty string from UI means "don't change" — preserve stored key
                    supportApiKey: (message.supportApiKey && message.supportApiKey.length > 0)
                        ? message.supportApiKey
                        : this._settings.supportApiKey,
                    supportModel: message.supportModel ?? this._settings.supportModel,
                    inlineCompletionEnabled: message.inlineCompletionEnabled ?? this._settings.inlineCompletionEnabled,
                    fixWithEucodeEnabled: message.fixWithEucodeEnabled ?? this._settings.fixWithEucodeEnabled,
                    customCommandsScope: message.customCommandsScope ?? this._settings.customCommandsScope,
                    hybridIntensity: (message.hybridIntensity ?? this._settings.hybridIntensity) as 25 | 50 | 75 | 100,
                    projectIntelEnabled: message.projectIntelEnabled ?? this._settings.projectIntelEnabled,
                    jarvisEnabled: message.jarvisEnabled ?? this._settings.jarvisEnabled,
                    jarvisAutoSpeak: message.jarvisAutoSpeak ?? this._settings.jarvisAutoSpeak,
                    jarvisTtsVoice: message.jarvisTtsVoice ?? this._settings.jarvisTtsVoice,
                    jarvisTtsRate: message.jarvisTtsRate ?? this._settings.jarvisTtsRate,
                    voiceServerEnabled: message.voiceServerEnabled ?? this._settings.voiceServerEnabled,
                    voiceServerPort: message.voiceServerPort ?? this._settings.voiceServerPort,
                    voiceServerExposeNetwork: message.voiceServerExposeNetwork ?? this._settings.voiceServerExposeNetwork,
                    voicePairingToken: this._settings.voicePairingToken,  // never overridden by UI
                    whisperEndpoint: message.whisperEndpoint ?? this._settings.whisperEndpoint,
                    whisperModel: message.whisperModel ?? this._settings.whisperModel,
                    whisperLanguage: message.whisperLanguage ?? this._settings.whisperLanguage,
                    micDeviceIndex: message.micDeviceIndex ?? this._settings.micDeviceIndex,
                    wakeWordEnabled: message.wakeWordEnabled ?? this._settings.wakeWordEnabled,
                    wakeWord: message.wakeWord ?? this._settings.wakeWord,
                };
                await saveSettings(this._context, this._settings);
                vscode.commands.executeCommand('setContext', 'eucodeFixEnabled', this._settings.fixWithEucodeEnabled);
                webviewView.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(this._settings);
                // React to JARVIS / voice server settings changes
                await startOrUpdateVoiceServer();
                await startOrUpdateWakeWord();
                return;
            }

            if (message?.command === 'set_hybrid') {
                this._settings = { ...this._settings, hybridEnabled: !!message.enabled };
                await saveSettings(this._context, this._settings);
                return;
            }

            // Webview captured audio via MediaRecorder, encoded as base64,
            // wants the extension to transcribe it via the local Whisper
            // (LM Studio). The webview can't fetch http://localhost from
            // inside a sandboxed Webview iframe reliably, so we do it here.
            if (message?.command === 'voice_transcribe') {
                try {
                    const base64 = String(message.audioBase64 || '');
                    if (!base64) {
                        webviewView.webview.postMessage({ command: 'voice_transcribe_result', requestId: message.requestId, ok: false, error: 'empty audio' });
                        return;
                    }
                    const audioBuf = Buffer.from(base64, 'base64');
                    const mimeType = String(message.mimeType || 'audio/webm');
                    const text = await transcribeViaWhisper(
                        this._settings.whisperEndpoint,
                        this._settings.whisperModel,
                        this._settings.whisperLanguage,
                        audioBuf,
                        mimeType
                    );
                    webviewView.webview.postMessage({ command: 'voice_transcribe_result', requestId: message.requestId, ok: true, text });
                } catch (e) {
                    webviewView.webview.postMessage({
                        command: 'voice_transcribe_result',
                        requestId: message.requestId,
                        ok: false,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
                return;
            }

            // Lists the OS audio input devices so the JARVIS config can show a
            // dropdown instead of a hardcoded default.
            if (message?.command === 'voice_list_devices') {
                try {
                    const bin = await AudioCapture.checkFfmpeg();
                    if (!bin) {
                        webviewView.webview.postMessage({
                            command: 'voice_devices_result',
                            ok: false,
                            error: 'ffmpeg nao encontrado. Instale com: brew install ffmpeg',
                            devices: [],
                        });
                        return;
                    }
                    const devices = await AudioCapture.listAudioDevices(bin);
                    webviewView.webview.postMessage({
                        command: 'voice_devices_result',
                        ok: true,
                        devices,
                        selected: this._settings.micDeviceIndex,
                    });
                } catch (e) {
                    webviewView.webview.postMessage({
                        command: 'voice_devices_result',
                        ok: false,
                        error: e instanceof Error ? e.message : String(e),
                        devices: [],
                    });
                }
                return;
            }

            // ── JARVIS: native mic capture via ffmpeg (outside the webview) ──
            // The webview cannot use getUserMedia (Electron blocks it). So the
            // webview asks the host to start/stop a native recording instead.
            if (message?.command === 'voice_record_start') {
                const jlog = (m: string) => {
                    console.log('[JARVIS]', m);
                    webviewView.webview.postMessage({ command: 'jarvis_log', text: m });
                };
                try {
                    const bin = await AudioCapture.checkFfmpeg();
                    if (!bin) {
                        webviewView.webview.postMessage({
                            command: 'voice_record_error',
                            error: 'ffmpeg nao encontrado. Instale com: brew install ffmpeg',
                        });
                        return;
                    }
                    if (!this._audioCapture) {
                        this._audioCapture = new AudioCapture(jlog, bin);
                    }
                    if (this._audioCapture.isRecording()) {
                        jlog('record_start ignorado — ja gravando');
                        return;
                    }
                    this._audioCapture.start(this._settings.micDeviceIndex);
                    webviewView.webview.postMessage({ command: 'voice_record_started' });
                } catch (e) {
                    webviewView.webview.postMessage({
                        command: 'voice_record_error',
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
                return;
            }

            if (message?.command === 'voice_record_stop') {
                const jlog = (m: string) => {
                    console.log('[JARVIS]', m);
                    webviewView.webview.postMessage({ command: 'jarvis_log', text: m });
                };
                try {
                    if (!this._audioCapture || !this._audioCapture.isRecording()) {
                        webviewView.webview.postMessage({ command: 'voice_record_error', error: 'nao estava gravando' });
                        return;
                    }
                    const result = await this._audioCapture.stop();
                    jlog(`transcrevendo ${result.buffer.length} bytes (${result.mimeType})...`);
                    const text = await transcribeViaWhisper(
                        this._settings.whisperEndpoint,
                        this._settings.whisperModel,
                        this._settings.whisperLanguage,
                        result.buffer,
                        result.mimeType
                    );
                    jlog(`transcricao: "${text.slice(0, 80)}"`);
                    webviewView.webview.postMessage({ command: 'voice_record_result', ok: true, text });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    jlog(`record_stop erro: ${msg}`);
                    webviewView.webview.postMessage({ command: 'voice_record_result', ok: false, error: msg });
                }
                return;
            }

            // UI asks for pairing info (host:port and token) so it can show
            // a QR code or copy a connection URL for the mobile client.
            if (message?.command === 'voice_pairing_info') {
                const token = await ensurePairingToken();
                const localIps = getLocalIPv4Addresses();
                webviewView.webview.postMessage({
                    command: 'voice_pairing_info_result',
                    token,
                    port: this._settings.voiceServerPort,
                    running: !!this._voiceServer?.isRunning(),
                    bindAll: this._settings.voiceServerExposeNetwork,
                    localIps,
                });
                return;
            }

            if (message?.command === 'save_command') {
                const cmd: CustomCommand = {
                    command: String(message.commandName || '').trim(),
                    prompt: String(message.prompt || '').trim(),
                    description: message.description ? String(message.description).trim() : undefined,
                    autoMode: !!message.autoMode,
                    hybridMode: !!message.hybridMode,
                };
                const scope: CommandsScope = (message.scope === 'global' || message.scope === 'workspace')
                    ? message.scope
                    : this._settings.customCommandsScope;
                const result = await appendCommand(scope, cmd);
                webviewView.webview.postMessage({
                    command: 'save_command_result',
                    ok: result.ok,
                    error: result.error,
                    filePath: result.filePath,
                });
                if (result.ok) { pushCommandsToWebview(); }
                return;
            }

            if (message?.command === 'open_commands_file') {
                const scope: CommandsScope = (message.scope === 'global' || message.scope === 'workspace')
                    ? message.scope
                    : this._settings.customCommandsScope;
                const fp = getCommandsFilePath(scope);
                if (!fp) {
                    vscode.window.showWarningMessage('Eucode IA: abra um workspace para usar comandos em escopo workspace.');
                    return;
                }
                try {
                    require('fs').mkdirSync(require('path').dirname(fp), { recursive: true });
                    if (!require('fs').existsSync(fp)) {
                        require('fs').writeFileSync(fp, '[\n]\n', 'utf8');
                    }
                    const doc = await vscode.workspace.openTextDocument(fp);
                    await vscode.window.showTextDocument(doc, { preview: false });
                } catch (e) {
                    vscode.window.showErrorMessage(`Eucode IA: nao foi possivel abrir ${fp}: ${e instanceof Error ? e.message : String(e)}`);
                }
                return;
            }

            if (message?.command === 'change_commands_scope') {
                const next: CommandsScope = message.scope === 'global' ? 'global' : 'workspace';
                this._settings = { ...this._settings, customCommandsScope: next };
                await saveSettings(this._context, this._settings);
                rewatchCommands();
                pushCommandsToWebview();
                return;
            }

            if (message?.command === 'remember_decision') {
                const activeId = this._historyManager.getActiveId();
                if (!activeId) {
                    webviewView.webview.postMessage({ command: 'remember_decision_result', ok: false, error: 'Nenhuma sessao ativa.' });
                    return;
                }
                const result = rememberDecision(activeId, String(message.note || ''), 'user');
                webviewView.webview.postMessage({
                    command: 'remember_decision_result',
                    ok: result.ok,
                    error: result.reason,
                });
                return;
            }

            if (message?.command === 'open_memory_file') {
                const activeId = this._historyManager.getActiveId();
                if (!activeId) {
                    vscode.window.showWarningMessage('Eucode IA: nenhuma sessao ativa. Inicie um chat antes de abrir a memoria.');
                    return;
                }
                const fp = getSessionMemoryPath(activeId);
                if (!fp) {
                    vscode.window.showWarningMessage('Eucode IA: abra um workspace para usar memoria de sessao.');
                    return;
                }
                try {
                    require('fs').mkdirSync(require('path').dirname(fp), { recursive: true });
                    if (!require('fs').existsSync(fp)) {
                        require('fs').writeFileSync(fp, JSON.stringify({ sessionId: activeId, createdAt: Date.now(), updatedAt: Date.now(), approvedCommands: [], decisions: [] }, null, 2) + '\n', 'utf8');
                    }
                    const doc = await vscode.workspace.openTextDocument(fp);
                    await vscode.window.showTextDocument(doc, { preview: false });
                } catch (e) {
                    vscode.window.showErrorMessage(`Eucode IA: nao foi possivel abrir ${fp}: ${e instanceof Error ? e.message : String(e)}`);
                }
                return;
            }

            if (message?.command === 'confirm_write_response') {
                const resolve = this._pendingConfirms.get(message.id);
                if (resolve) { this._pendingConfirms.delete(message.id); resolve(message.approved === true); }
                return;
            }

            if (message?.command === 'confirm_command_response') {
                const resolve = this._pendingCommandConfirms.get(message.id);
                if (resolve) {
                    this._pendingCommandConfirms.delete(message.id);
                    resolve(message.decision as ConfirmCommandDecision ?? 'block');
                }
                return;
            }

            if (message?.command === 'stop') {
                this._abortController?.abort();
                return;
            }

            if (message?.command === 'inject_message' && message.text) {
                this._injectMessage?.(message.text);
                return;
            }

            if (message?.command !== 'user_input' || !message.text) { return; }

            const userMode: 'dev' | 'chat' = message.chatMode ? 'chat' : 'dev';
            this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'user', content: message.text, timestamp: Date.now(), hasImage: !!message.image, mode: userMode });

            const endpoint = buildApiEndpoint(this._settings);
            const authHeaders = buildAuthHeader(this._settings);
            const activeModel = this._settings.model || DEFAULT_MODEL;
            let response: string;

            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = buildHistorySummary(this._sessionHistory.slice(0, -1));
                const systemWithHistory = [SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await callAIWithVision(endpoint, authHeaders, message.text, message.image.base64, message.image.mimeType, systemWithHistory, activeModel);
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: response, timestamp: Date.now(), hasImage: true, imageSummary: response.slice(0, 300), mode: userMode });
            } else {
                // CHAT mode skips workspace mapping entirely — no "Mapeando workspace",
                // no "Abertos no editor", no diagnostics. The conversation is meant
                // to be free-form and not tied to the project.
                const isChat = userMode === 'chat';

                if (!isChat) {
                    notify('Mapeando workspace...');
                }
                const ctx = isChat
                    ? { openFiles: [], contextBlock: '', roots: [] as string[] }
                    : collectWorkspaceContext();
                if (!isChat && ctx.openFiles.length > 0) {
                    notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`);
                }

                // Inclui diagnósticos do editor no bloco de contexto quando houver
                const diagnosticsBlock = isChat ? '' : collectDiagnostics();
                const fullContextBlock = [ctx.contextBlock, diagnosticsBlock].filter(Boolean).join('\n\n');

                const defaultCwd = getDefaultCwd(ctx.roots);
                const notifyCommandStart = (cmd: string) => webviewView.webview.postMessage({ command: 'command_start', cmd });
                const notifyCommandOutput = (chunk: string) => webviewView.webview.postMessage({ command: 'command_output', chunk });
                const notifyCommandEnd = (exitCode: number) => webviewView.webview.postMessage({ command: 'command_end', exitCode });
                const notifyStatus = (s: string) => {
                    notify(s);
                    if (s.toLowerCase().includes('aguardando sua resposta')) {
                        notifyUser('Processo rodando — aguardando sua resposta no chat', ['Abrir chat']);
                    }
                };

                this._abortController = new AbortController();
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: true });

                const notifyStreamChunk = (text: string) =>
                    webviewView.webview.postMessage({ command: 'stream_chunk', text });

                const notifyTelemetry = (metrics: { promptTokens: number; completionTokens: number; tokensPerSec: number; elapsedMs: number }) =>
                    webviewView.webview.postMessage({ command: 'telemetry', ...metrics });

                const notifyLiveTelemetry = (tokens: number, tokensPerSec: number, elapsedMs: number) =>
                    webviewView.webview.postMessage({ command: 'live_telemetry', tokens, tokensPerSec, elapsedMs });

                // Open the file the agent just wrote/edited in the editor so the
                // user sees the change live. Throttled per path — repeated touches
                // to the same file in quick succession only open once.
                const recentlyOpened = new Map<string, number>();
                const openFileInEditor = (absolutePath: string) => {
                    const now = Date.now();
                    const last = recentlyOpened.get(absolutePath) || 0;
                    if (now - last < 1500) { return; }
                    recentlyOpened.set(absolutePath, now);
                    vscode.workspace.openTextDocument(absolutePath).then(
                        doc => vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true }),
                        () => { /* file may not exist yet (race) — ignore */ }
                    );
                };

                // Hybrid: when toggled on AND a key is configured, ship support
                // config + activity callback to the loop.
                const hybridConfig = (message.hybridMode && this._settings.supportApiKey)
                    ? {
                        enabled: true,
                        provider: this._settings.supportProvider,
                        apiKey: this._settings.supportApiKey,
                        model: this._settings.supportModel,
                    }
                    : undefined;
                const notifyHybridActivity = (evt: HybridActivityEvent) =>
                    webviewView.webview.postMessage({ command: 'hybrid_activity', ...evt });

                response = await runAgentLoop(
                    message.text, fullContextBlock, defaultCwd, endpoint, authHeaders,
                    this._sessionHistory, notifyStatus, notifyCommandStart, notifyCommandOutput, notifyCommandEnd,
                    makeConfirmWrite(), makeConfirmCommand(), getDiagnostics,
                    makeTodoUpdate(),
                    activeModel, !!message.autoMode,
                    this._abortController.signal,
                    (handler) => { this._injectMessage = handler; },
                    this._settings.provider,
                    this._settings.apiKey,
                    this._settings.enabledTools,
                    notifyStreamChunk,
                    notifyTelemetry,
                    this._settings.ragEnabled ? this._settings.ragEndpoint : undefined,
                    this._settings.ragEnabled ? this._settings.ragCollection : undefined,
                    notifyLiveTelemetry,
                    openFileInEditor,
                    hybridConfig,
                    notifyHybridActivity,
                    this._historyManager.getActiveId(),
                    !!message.chatMode,
                    this._settings.hybridIntensity,
                    this._settings.projectIntelEnabled,
                    this._settings.ragProvider,
                    this._settings.ragEnabled ? this._settings.ragEmbedHost : undefined,
                    this._settings.ragEnabled ? this._settings.ragEmbedModel : undefined
                );
                this._abortController = null;
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: false });
                if (response && !response.startsWith('[INTERROMPIDO]')) {
                    notifyUser('Tarefa concluida', ['Abrir chat']);
                }
                // Truncate long responses before saving to history to avoid inflating future prompts.
                const historySummary = response.length > 400 ? response.slice(0, 400) + '...' : response;
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: historySummary, timestamp: Date.now(), mode: userMode });
            }

            webviewView.webview.postMessage({ command: 'agent_response', text: response, mode: userMode });
        }, undefined, this._context.subscriptions);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Eucode-IA Plugin ativo.');

    const provider = new EucodeViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(EucodeViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true },
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.activateAgent', () => {
            vscode.commands.executeCommand('eucode-ia.chatView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.openChat', () => {
            vscode.commands.executeCommand('eucode-ia.chatView.focus');
        })
    );

    // ── Editor features: inline completion + fix with eucode ──
    const getSettings = () => provider.getCurrentSettings();

    // Set the initial context key for the menu visibility (Fix with Eucode)
    vscode.commands.executeCommand('setContext', 'eucodeFixEnabled', getSettings().fixWithEucodeEnabled);

    // Register inline completion provider for ALL languages — provider itself
    // checks the setting at runtime and bails when disabled, so registering
    // once is enough (no need to dispose/reregister on toggle).
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { scheme: 'file' },
            new EucodeInlineCompletionProvider(getSettings)
        )
    );

    // Register code action provider (Quick Fix lightbulb + Refactor).
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file' },
            new EucodeFixCodeActionProvider(getSettings),
            { providedCodeActionKinds: EucodeFixCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Register the fixWithEucode command (used by code action AND context menu).
    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.fixWithEucode', (uri?: vscode.Uri, range?: vscode.Range, diags?: vscode.Diagnostic[]) =>
            executeFixWithEucode(getSettings, uri, range, diags)
        )
    );
}

export function deactivate() {}

// ── Voice helpers (used by the webview transcribe handler) ─────────────

import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as crypto from 'crypto';

// POSTs an audio buffer to LM Studio's OpenAI-compatible Whisper endpoint
// and returns the transcribed text. Self-contained — no third-party deps.
async function transcribeViaWhisper(
    endpoint: string,
    model: string,
    language: string,
    audio: Buffer,
    contentType: string
): Promise<string> {
    if (!endpoint) { throw new Error('Whisper endpoint nao configurado.'); }
    // Tenta os 2 paths em sequencia:
    //   /v1/audio/transcriptions  → LM Studio, faster-whisper-server, OpenAI
    //   /inference                → whisper.cpp standalone (whisper-server)
    const base = endpoint.replace(/\/+$/, '');
    const paths = ['/v1/audio/transcriptions', '/inference'];
    let lastError: Error | null = null;
    for (const p of paths) {
        try {
            return await postWhisperRequest(base + p, model, language, audio, contentType);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            lastError = err;
            // 404 → tenta o proximo path. Outros erros (timeout, 500) param o loop.
            if (!/^Whisper 404/.test(err.message)) { break; }
        }
    }
    throw lastError || new Error('Whisper: nenhum path conhecido respondeu.');
}

function postWhisperRequest(
    url: string,
    model: string,
    language: string,
    audio: Buffer,
    contentType: string
): Promise<string> {
    const boundary = '----eucode' + crypto.randomBytes(16).toString('hex');
    const parts: Buffer[] = [];
    const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));

    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="model"\r\n\r\n${model || 'whisper-1'}\r\n`);
    if (language) {
        push(`--${boundary}\r\n`);
        push(`Content-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`);
    }
    const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('mpeg') ? 'mp3' : 'webm';
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n`);
    push(`Content-Type: ${contentType}\r\n\r\n`);
    parts.push(audio);
    push(`\r\n--${boundary}--\r\n`);

    const body = Buffer.concat(parts);
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request({
            method: 'POST',
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
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
                    resolve(String(json.text || '').trim());
                } catch {
                    reject(new Error('Whisper response was not JSON'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Whisper request timeout (60s)')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Lists non-internal IPv4 addresses so the UI can show "192.168.x.x" for
// pairing with mobile clients on the same LAN.
function getLocalIPv4Addresses(): string[] {
    const out: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name] || []) {
            if (info.family === 'IPv4' && !info.internal) { out.push(info.address); }
        }
    }
    return out;
}
