"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_NAMES = exports.TOOLS = exports.runCommandTool = void 0;
const child_process_1 = require("child_process"); // Usando spawn para streaming
const events_1 = require("events"); // Importando EventEmitter
// ... (Mantendo as outras definições de ferramentas)
/**
 * Função refatorada para usar spawn e emitir eventos de streaming em vez de retornar um Promise resolvido.
 * O executor do agente DEVE ser adaptado para ouvir os eventos deste objeto EventEmitter,
 * tratando o stream como a resposta da ferramenta.
 * @param command O comando a ser executado.
 * @param cwd Diretório de trabalho.
 * @returns Um EventEmitter que emite 'stdout', 'stderr', e 'done' ao final do processo.
 */
const runCommandTool = (command, cwd) => {
    const emitter = new events_1.EventEmitter();
    // 1. Spawn o processo filho
    // shell: true permite que comandos complexos com pipes/redirecionamentos funcionem corretamente.
    const processChild = (0, child_process_1.spawn)(command, [], { cwd: cwd || process.cwd(), shell: true });
    let outputBuffer = '';
    // 2. Capturar STDOUT e emitir evento de saída (Chunk por Chunk)
    processChild.stdout?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stdout', chunk); // Emite o chunk recebido para o chat
    });
    // 3. Capturar STDERR e emitir evento de erro/saída padrão (Chunk por Chunk)
    processChild.stderr?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stderr', chunk); // Emite o chunk recebido para o chat
    });
    // 4. Capturar fim do processo e emitir evento de conclusão
    processChild.on('close', (code) => {
        const finalOutput = `\n===============================\n✅ Comando concluído com código ${code}.\nSaída total:\n${outputBuffer}`;
        emitter.emit('done', finalOutput); // Emite o resultado final e limpa
    });
    // 5. Capturar erro de spawn (ex: comando não encontrado, permissão negada)
    processChild.on('error', (err) => {
        const errorMsg = `\n===============================\n❌ ERRO DE EXECUCAO DO PROCESSO:\n${err.message}`;
        emitter.emit('stderr', errorMsg);
        emitter.emit('done', errorMsg);
    });
    // Retorna o emitter para que o executor possa ouvir os eventos em tempo real
    return emitter;
};
exports.runCommandTool = runCommandTool;
exports.TOOLS = [
    {
        name: 'run_command',
        description: 'Executa um comando no terminal. Use para compilar, instalar dependencias, rodar testes ou scripts. O resultado é transmitido em tempo real.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Comando a executar, ex: npm run build.' },
                cwd: { type: 'string', description: 'Diretorio de trabalho. Se omitido, usa a pasta raiz do workspace.' },
            },
            required: ['command'],
        },
    },
];
exports.TOOL_NAMES = new Set(exports.TOOLS.map(t => t.name));
