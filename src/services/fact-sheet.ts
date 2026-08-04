/**
 * FactSheet — scratchpad de FATOS destilados da rodada, sempre reinjetado no
 * contexto do modelo.
 *
 * Problema que resolve: numa janela de ~2048 tokens, ler 2 arquivos ja enche o
 * contexto. A poda (pruneRoundToolMessages) descarta os pares tool antigos para
 * caber — inclusive a leitura de um arquivo. O modelo pequeno entao ESQUECE o
 * que leu e re-le o mesmo arquivo, ate acabar os passos. (Sintoma confirmado em
 * uso real: "repetia a leitura do mesmo arquivo".)
 *
 * Solucao: no momento em que um tool result chega, destilamos o essencial
 * (arquivo lido + seus simbolos, arquivo escrito, ultimo erro) para este bloco.
 * Como o bloco e SEMPRE reinjetado no prompt, a poda pode descartar o texto
 * bruto da leitura à vontade — o FATO permanece. O modelo perde o conteudo
 * literal, mas nunca o "chao" (o que existe, o que ele ja fez).
 *
 * 100% deterministico: nenhuma chamada a LLM, nenhuma heuristica de linguagem.
 * Extracao de simbolos e regex pura. Zero risco de alucinar no resumo.
 */

export interface FactSheetOptions {
    /** Teto rigido de caracteres do bloco final. Calibrado para nao roubar
     *  contexto do modelo pequeno. Default 600 (~150 tokens). */
    maxChars?: number;
    /** Simbolos mostrados por arquivo. Default 6. */
    maxSymbolsPerFile?: number;
}

interface ReadFact {
    /** basename do arquivo lido. */
    name: string;
    /** simbolos exportados/definidos, destilados da leitura. */
    symbols: string[];
    /** numero de linhas do arquivo (da uma nocao de tamanho ao modelo). */
    lines: number;
}

export class FactSheet {
    private reads = new Map<string, ReadFact>();   // key: basename
    private written = new Set<string>();           // basenames escritos/editados
    private lastError = '';
    private readonly maxChars: number;
    private readonly maxSymbolsPerFile: number;

    constructor(opts: FactSheetOptions = {}) {
        this.maxChars = opts.maxChars ?? 600;
        this.maxSymbolsPerFile = opts.maxSymbolsPerFile ?? 6;
    }

    /** Registra a leitura de um arquivo. `content` e o conteudo bruto lido;
     *  `extractSymbols` e injetado pelo chamador (reusa a funcao do loop, sem
     *  duplicar regex). Substitui o fato anterior do mesmo arquivo. */
    recordRead(name: string, content: string, extractSymbols: (code: string) => string[]): void {
        // Ignora resultados de erro — nao sao leitura util.
        if (!content || content.startsWith('[ERRO') || content.startsWith('[ERROR')) { return; }
        const symbols = extractSymbols(content);
        const lines = content.split('\n').length;
        this.reads.set(name, { name, symbols, lines });
    }

    /** Registra que um arquivo foi escrito ou editado nesta rodada. */
    recordWrite(name: string): void {
        this.written.add(name);
    }

    /** Registra o resumo do ultimo erro (ja destilado pelo loop). */
    recordError(summary: string): void {
        this.lastError = (summary || '').slice(0, 160);
    }

    /** true se ha algum fato para mostrar. */
    hasFacts(): boolean {
        return this.reads.size > 0 || this.written.size > 0 || this.lastError.length > 0;
    }

    /** Monta o bloco de fatos, respeitando o teto de caracteres. Retorna ''
     *  quando nao ha fatos (para o loop poder filtrar com .filter(Boolean)). */
    build(): string {
        if (!this.hasFacts()) { return ''; }

        const parts: string[] = ['## FATOS CONHECIDOS (ja descoberto — nao re-descubra)'];

        if (this.reads.size > 0) {
            const readLines = Array.from(this.reads.values()).map(f => {
                const syms = f.symbols.slice(0, this.maxSymbolsPerFile).join(', ');
                return syms
                    ? `- ${f.name} (${f.lines} linhas) expoe: ${syms}`
                    : `- ${f.name} (${f.lines} linhas) — ja lido`;
            });
            parts.push('Arquivos ja lidos:', ...readLines);
        }

        if (this.written.size > 0) {
            parts.push(`Arquivos ja escritos/editados: ${Array.from(this.written).join(', ')}`);
        }

        if (this.lastError) {
            parts.push(`Ultimo erro: ${this.lastError}`);
        }

        let block = parts.join('\n');
        // Teto rigido: se passar, corta em limite de linha e sinaliza.
        if (block.length > this.maxChars) {
            block = block.slice(0, this.maxChars);
            const lastNl = block.lastIndexOf('\n');
            if (lastNl > 0) { block = block.slice(0, lastNl); }
            block += '\n- (...)';
        }
        return block;
    }
}
