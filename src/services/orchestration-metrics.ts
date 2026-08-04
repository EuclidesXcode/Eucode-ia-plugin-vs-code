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

export interface OrchestrationSnapshot {
    /** Passos que emitiram um tool_call (nativo OU recuperado do texto). */
    toolCallSteps: number;
    /** Passos em que o modelo respondeu texto puro, sem tool_call. */
    textOnlySteps: number;
    /** true se o PRIMEIRO passo da rodada foi texto puro (sintoma de
     *  "alucinar um plano antes de olhar o projeto"). */
    firstStepWasText: boolean;
    /** Quantas vezes um arquivo já lido nesta rodada foi lido de novo
     *  (sintoma de perda de contexto: o modelo esqueceu o que já viu). */
    rereadCount: number;
    /** Quantas vezes o tool_call veio malformado no corpo e precisou ser
     *  recuperado por detectEscapedToolCall (rede de segurança do parser). */
    escapedToolCalls: number;
    /** Quantas vezes o loop precisou injetar um nudge corretivo porque o
     *  modelo descreveu ação em vez de executar (detectsPendingAction). */
    pendingNudges: number;
    /** Total de passos executados na rodada. */
    totalSteps: number;
}

export class OrchestrationMetrics {
    private toolCallSteps = 0;
    private textOnlySteps = 0;
    private firstStepRecorded = false;
    private firstStepWasText = false;
    private rereadCount = 0;
    private escapedToolCalls = 0;
    private pendingNudges = 0;
    private totalSteps = 0;
    // Arquivos (path absoluto) já lidos nesta rodada — para detectar re-leitura.
    private filesRead = new Set<string>();

    /** Registra que um passo emitiu um tool_call. `viaEscape` = veio do
     *  detectEscapedToolCall (não do campo nativo). */
    recordToolStep(viaEscape: boolean): void {
        this.totalSteps++;
        this.toolCallSteps++;
        if (!this.firstStepRecorded) { this.firstStepRecorded = true; this.firstStepWasText = false; }
        if (viaEscape) { this.escapedToolCalls++; }
    }

    /** Registra que um passo respondeu texto puro (sem tool_call). */
    recordTextStep(): void {
        this.totalSteps++;
        this.textOnlySteps++;
        if (!this.firstStepRecorded) { this.firstStepRecorded = true; this.firstStepWasText = true; }
    }

    /** Registra uma leitura de arquivo. Retorna true se já tinha sido lido
     *  nesta rodada (re-leitura = sinal de perda de contexto). */
    recordFileRead(absolutePath: string): boolean {
        if (this.filesRead.has(absolutePath)) {
            this.rereadCount++;
            return true;
        }
        this.filesRead.add(absolutePath);
        return false;
    }

    /** Registra que o loop injetou um nudge de "aja em vez de descrever". */
    recordPendingNudge(): void {
        this.pendingNudges++;
    }

    snapshot(): OrchestrationSnapshot {
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
    format(): string {
        const s = this.snapshot();
        return `[ORCH] steps=${s.totalSteps} tool=${s.toolCallSteps} text=${s.textOnlySteps} `
            + `firstText=${s.firstStepWasText} reread=${s.rereadCount} `
            + `escaped=${s.escapedToolCalls} nudges=${s.pendingNudges}`;
    }
}
