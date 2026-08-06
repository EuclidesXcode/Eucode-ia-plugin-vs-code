"use strict";
/**
 * OrchestrationMetrics — telemetria determinística da orquestração do agent
 * loop, por RODADA (uma chamada a runAgentLoop).
 *
 * Objetivo: transformar percepções ("o modelo não chama tool", "ele perde
 * contexto") em NÚMEROS, para calibrar as correções de orquestração sem
 * achismo. Nada aqui usa heurística de linguagem ou LLM — só conta eventos
 * factuais que o loop já produz.
 *
 * Uso: o loop cria uma instância por rodada, chama os `record*` nos pontos de
 * evento, e ao final chama `snapshot()` para logar/telemetrar. Sem estado
 * global — cada rodada é isolada e descartável.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestrationMetrics = void 0;
class OrchestrationMetrics {
    constructor() {
        this.toolCallSteps = 0;
        this.textOnlySteps = 0;
        this.firstStepRecorded = false;
        this.firstStepWasText = false;
        this.rereadCount = 0;
        this.escapedToolCalls = 0;
        this.pendingNudges = 0;
        this.totalSteps = 0;
        // Arquivos (path absoluto) já lidos nesta rodada — para detectar re-leitura.
        this.filesRead = new Set();
    }
    /** Registra que um passo emitiu um tool_call. `viaEscape` = veio do
     *  detectEscapedToolCall (não do campo nativo). */
    recordToolStep(viaEscape) {
        this.totalSteps++;
        this.toolCallSteps++;
        if (!this.firstStepRecorded) {
            this.firstStepRecorded = true;
            this.firstStepWasText = false;
        }
        if (viaEscape) {
            this.escapedToolCalls++;
        }
    }
    /** Registra que um passo respondeu texto puro (sem tool_call). */
    recordTextStep() {
        this.totalSteps++;
        this.textOnlySteps++;
        if (!this.firstStepRecorded) {
            this.firstStepRecorded = true;
            this.firstStepWasText = true;
        }
    }
    /** Registra uma leitura de arquivo. Retorna true se já tinha sido lido
     *  nesta rodada (re-leitura = sinal de perda de contexto). */
    recordFileRead(absolutePath) {
        if (this.filesRead.has(absolutePath)) {
            this.rereadCount++;
            return true;
        }
        this.filesRead.add(absolutePath);
        return false;
    }
    /** Registra que o loop injetou um nudge de "aja em vez de descrever". */
    recordPendingNudge() {
        this.pendingNudges++;
    }
    snapshot() {
        return {
            toolCallSteps: this.toolCallSteps,
            textOnlySteps: this.textOnlySteps,
            firstStepWasText: this.firstStepWasText,
            rereadCount: this.rereadCount,
            escapedToolCalls: this.escapedToolCalls,
            pendingNudges: this.pendingNudges,
            totalSteps: this.totalSteps,
        };
    }
    /** Formata o snapshot como uma linha compacta para o console. */
    format() {
        const s = this.snapshot();
        return `[ORCH] steps=${s.totalSteps} tool=${s.toolCallSteps} text=${s.textOnlySteps} `
            + `firstText=${s.firstStepWasText} reread=${s.rereadCount} `
            + `escaped=${s.escapedToolCalls} nudges=${s.pendingNudges}`;
    }
}
exports.OrchestrationMetrics = OrchestrationMetrics;
