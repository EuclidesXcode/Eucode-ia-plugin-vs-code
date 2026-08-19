"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_ACTION_PATTERNS = void 0;
exports.detectsPendingAction = detectsPendingAction;
// Detecta quando o modelo NARROU uma acao ("vou instalar as dependencias",
// "Chame `run_command` para...") em vez de efetivamente chamar uma tool.
// Modelos locais pequenos fazem isso com frequencia — descrevem o proximo
// passo como se fosse suficiente. Em modo AUTO isso e tratado como "ainda nao
// terminou" e gera um nudge corretivo (ver loop.ts).
exports.PENDING_ACTION_PATTERNS = [
    /vou criar/i, /vou escrever/i, /vou gerar/i, /vou adicionar/i,
    /vou implementar/i, /vou modificar/i, /vou editar/i, /vou atualizar/i,
    /vou executar/i, /vou rodar/i, /vou instalar/i, /vou fazer/i, /vou come[çc]ar/i,
    /vou refatorar/i, /vou corrigir/i, /vou ajustar/i, /vou focar/i,
    /vou usar/i, /vou aplicar/i, /vou tentar/i, /vou verificar/i,
    /vou procurar/i, /vou buscar/i, /vou ler/i, /vou analisar/i, /vou listar/i, /vou abrir/i,
    /agora vou/i, /agora crio/i, /agora escrevo/i, /agora corrijo/i,
    /a seguir vou/i, /em seguida vou/i, /enquanto isso/i,
    // Modo imperativo/instrucional (o modelo se dirigindo a si mesmo em vez de
    // narrar em 1a pessoa) — ex: "Chame `run_command` para instalar..." em vez
    // de chamar a tool de fato. Gramaticalmente diferente de "vou X", entao
    // precisa dos proprios padroes.
    /\bchame\b/i, /\bchamar\s+(a\s+)?(ferramenta|tool|fun[çc][aã]o)\b/i,
    /\binvoque\b/i, /\binvocar\s+(a\s+)?(ferramenta|tool)\b/i,
    /\bexecute\s+(o\s+|a\s+)?(ferramenta|tool|fun[çc][aã]o|comando)\b/i,
    /\brode\s+(o\s+|a\s+)?(comando|ferramenta|tool)\b/i,
    /\bcall\s+(the\s+)?(tool|function)\b/i, /\binvoke\s+(the\s+)?(tool|function)\b/i,
    /criando o arquivo/i, /escrevendo o arquivo/i, /refatorando/i,
    /criei o arquivo/i, /arquivo foi criado/i, /arquivo criado/i,
    /escrevi o arquivo/i, /gravei o arquivo/i,
    /criei o mock/i, /gerei o arquivo/i,
    /eu removi/i, /removi os/i, /apaguei os/i, /deletei os/i,
    /eu criei/i, /eu escrevi/i, /eu atualizei/i, /eu modifiquei/i,
    /eu executei/i, /executei os testes/i, /rodei os testes/i,
    /testes passaram/i, /testes foram executados/i,
    /atualizei o/i, /modifiquei o/i, /corrigi o/i,
    /i will create/i, /i will write/i, /i will now/i, /i'll create/i, /i'll write/i,
    /i have created/i, /i've created/i, /i have written/i, /file has been created/i,
    /i will refactor/i, /i will fix/i, /i will update/i,
    /i removed/i, /i deleted/i, /i updated/i, /i modified/i,
    /i ran the tests/i, /tests passed/i, /i executed/i,
];
function detectsPendingAction(text, autoMode = false) {
    const toCheck = autoMode
        ? text
        : text.split('\n').filter(l => l.trim()).slice(-6).join(' ');
    return exports.PENDING_ACTION_PATTERNS.some(p => p.test(toCheck));
}
