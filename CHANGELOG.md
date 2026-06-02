# Changelog

## 0.9.1

Foco: corrigir cenarios onde o streaming caia silenciosamente e a UI mostrava apenas "Erro de conexao com o modelo" generico, descartando texto que ja havia sido gerado.

- **Preservacao de texto parcial**: quando o stream cai depois de ja ter gerado tokens (ex: rede instavel, timeout, rate limit no meio da resposta), o texto acumulado e devolvido ao usuario com aviso de interrupcao em vez de descartado. Aplica em `callAI` e `callAnthropicAI`
- **Diagnostico de erro estruturado**: nova funcao `classifyApiError` mapeia a mensagem bruta do HTTP em causa raiz (rate_limit / context_too_large / auth / timeout / connection / server_error / unknown) e gera mensagem especifica para o usuario
- **6 mensagens de erro especificas** no lugar da generica "Erro de conexao":
  - `429 / rate limit` → "Limite de chamadas atingido. Aguarde alguns segundos..."
  - `context too large` → "A conversa excedeu o limite de tokens. Inicie uma nova sessao..."
  - `401 / 403 / unauthorized` → "API key invalida ou sem permissao..."
  - `timeout` → "O modelo demorou demais. Em modelos locais, verifique a memoria..."
  - `connection / ECONNREFUSED` → "Nao foi possivel conectar. Verifique se o LM Studio esta rodando..."
  - `5xx server errors` → "Erro no servidor do provedor. Tente novamente..."
- `console.error` agora loga objeto estruturado `{ reason, rawMessage, partialLen }` para debug
- **ProjectIntel reduzido e configuravel**: cap de 40 → 20 arquivos, max chars/linha de 140 → 120. Libera ~700-1000 tokens em todo prompt
- **Novo toggle "ProjectIntel" nas configuracoes** dentro de nova secao "Otimizacao de contexto". Default: ligado. Desligar e recomendado em modelos < 4B ou monorepos grandes
- `runAgentLoop` aceita `projectIntelEnabled?: boolean` (default true)
- `EucodeSettings.projectIntelEnabled` persistido em globalState

## 0.9.0

Minor bump por mudancas arquiteturais grandes focadas em garantir o desenvolvimento continuo com modelos locais <= 10B params:

**3 novos servicos especializados (foundation para Fase 1):**

- `ProjectIntelService` ([src/services/project-intel.ts](src/services/project-intel.ts)): indice leve de simbolos exportados por arquivo do workspace, com cache por mtime. Resumo compacto (40 arquivos, 140 chars/linha) injetado no system prompt em cada rodada — o modelo encontra arquivos por nome de funcao/classe sem precisar ler todos. Suporta TS/JS/Python/Go/Rust nativamente, hooks para outras linguagens. Cap de 400 arquivos e 200KB/arquivo para nao explodir em monorepos
- `ExecutionGuardService` ([src/services/execution-guard.ts](src/services/execution-guard.ts)): centraliza 6 guards de invariante que antes estavam espalhados pelo loop.ts (dumped code in chat, wrong file edit, build pending no command, command failed, build not passed, model planning). Cada guard e uma funcao pura testavel. Inclui detector de loop (mesma tool + mesmos args 3+ vezes seguidas)
- `TaskDecomposerService` ([src/services/task-decomposer.ts](src/services/task-decomposer.ts)): detecta macro-tarefas via heuristica local + LLM pago. Quebra em 2-8 sub-tarefas auto-contidas (cada uma cabe em uma rodada do modelo local). Inclui `validateStep()` que pede ao pago para validar resultado de cada sub-tarefa antes de avancar (step validation com aprovacao/rejeicao + correctionPrompt opcional)

**Slider de Intensidade HYBRID (25/50/75/100%):**

- Novo controle nas configuracoes: 4 niveis de uso do LLM pago. Permite o usuario calibrar custo vs robustez
- `25%` — Minimo: apenas recovery critico quando o modelo trava de vez
- `50%` (default) — Equilibrado: recovery + planejamento de tarefas grandes
- `75%` — Agressivo: adiciona validacao entre sub-tarefas (step validation)
- `100%` — Maximo: todos os gatilhos (planejamento, verificacao de escrita, verificacao de build, recovery, validacao)
- Cada `HybridReason` tem um threshold minimo de intensidade. `askSupport()` faz gating automatico via `hybridAllowsTrigger()`
- Slider segmentado de 4 botoes no painel de config, hint dinamico explica o que cada nivel faz

**AUTO mode mais resiliente:**

- Cap de tentativas aumentado de 5 para **15**
- Recovery via HYBRID acontece em cada multiplo de 4 (tentativas 4, 8, 12) em vez de apenas no penultimo strike
- Mensagem de recovery inclui contador `Tentativa N/15` para o pago entender a urgencia

**ProjectIntel injetado no system prompt:**

- Antes do contextBlock e ragContext, o modelo recebe lista compacta de simbolos do projeto
- Cabecalho `# PROJECT INDEX (N files indexed)` seguido de `path — symA, symB, symC` por arquivo
- Skip em CHAT mode (irrelevante para conversa livre)

## 0.8.11

Foco: melhorar comportamento do AUTO+HYBRID em tarefas de build/package onde o modelo local (14B, 2048 ctx) parava apos editar arquivos sem rodar o comando de build.

- **System prompt AUTO reforcado** com regras CRITICAS para tarefas de build/package/compile/deploy/vsix/release: sequencia obrigatoria de read → edit → run_command → verify; proibido editar duas vezes consecutivas sem rodar build no meio; proibido declarar pronto sem verificar artefato no disco
- **Plano HYBRID mais conciso**: novo system prompt instrui o pago a gerar 3-7 steps em paths RELATIVOS, sob 200 palavras (antes podia gerar 1000+ tokens com paths absolutos repetidos). Cap de output reduzido de 600 para 350 tokens — sobra ~700 tokens a mais no contexto do local
- **Plano HYBRID exige step de build + verificacao** quando a tarefa pede build/compile/package: instrucao explicita pro pago incluir `run_command` + `list_directory` no plano
- **Novo detector `buildPendingNoCommand`** como safety net: se o prompt do usuario mentions build/package/compile/deploy/vsix/release/marketplace E o modelo editou arquivos sem rodar nenhum comando de build, o nudge agora e especifico: "Voce editou arquivos mas NAO rodou o comando de build. Execute run_command agora com o comando apropriado. Depois use list_directory para verificar o artefato"
- Novo helper `lastBuildAttempted(messages)`: varre as tool_calls da rodada procurando `run_command` com termos de build (build, compile, package, tsc, vsce, webpack, rollup, esbuild, jest, vitest, pytest, cargo build, go build, mvn, gradle)

## 0.8.6

- **NOVO: Modo CHAT** — segmented control DEV/CHAT no dropdown de Modos. Em CHAT o agente conversa livremente sem tools de codigo, sem RAG, sem memoria de sessao. Util para perguntas gerais, analise de sites (com web_search se habilitado), brainstorming
- Em CHAT, AUTO e HYBRID sao automaticamente desabilitados (visualmente e funcionalmente)
- System prompt dedicado em CHAT_SYSTEM_PROMPT — conversacional, sem ceremonia de coding agent
- effectiveAutoMode / effectiveHybridConfig: CHAT forca ambos para off no runAgentLoop sem afetar a preferencia do usuario (volta ao estado anterior ao retornar para DEV)
- Tools filtradas em CHAT: so web_search disponivel (se habilitado pelo usuario), tools de leitura/escrita/execucao escondidas
- Reorganizacao do header: novo dropdown "Modos" agrupa DEV/CHAT + Auto + Hybrid em um unico botao limpo. Antes eram 2 botoes separados (Hybrid e Auto BETA) no header
- BETA removido do botao Auto
- Resumo compacto no botao Modos mostra o estado ativo (ex: "Modos · AUTO · HYBRID" ou "Modos · CHAT")
- Badge "CHAT" + borda lateral azul-violeta nas mensagens enviadas em modo CHAT, para diferenciar visualmente no historico
- HistoryEntry estendido com campo opcional `mode` ('dev' | 'chat') — persistido entre sessoes
- agent_response inclui mode na mensagem para o webview pintar a bubble do agente

## 0.8.5

- Republicacao de 0.8.4 com bump de versao (sem mudancas funcionais)

## 0.8.4

- **NOVO: Memoria persistente por sessao** em `.eucode/memory/session_<id>.json` com 3 secoes: `stack` (detectado automaticamente), `approvedCommands` (persistidos), `decisions` (notas)
- src/services/memory-service.ts: loadSessionMemory, rememberApprovedCommand, rememberDecision, detectAndRememberStack, buildMemorySummary, dumpMemoryAsJson, deleteSessionMemory
- Detector de stack na primeira rodada: le package.json (Node + frameworks como nextjs/react/vue/svelte/express/nestjs/jest/vitest), requirements.txt/pyproject.toml/Pipfile (Python + django/flask/fastapi), Cargo.toml (Rust), go.mod (Go), pom.xml/build.gradle (Java/Kotlin), pubspec.yaml (Dart/Flutter)
- Resumo de memoria injetado no system prompt em toda rodada (cap de 6 decisoes + 8 comandos recentes)
- 2 novas tools para o agente: `memory_remember` (salvar nota, max 500 chars, dedup) e `memory_read` (ler memoria completa)
- Comando `/lembrar <texto>` no chat para o usuario gravar manualmente — interceptado antes de chamar o agente
- Comandos "Permitir na sessao" agora persistem em disco: nao precisa reaprovar apos reload
- **Reorganizacao de arquivos do plugin para `.eucode/`**: novo src/services/workspace-init.ts cria a pasta com layout padronizado na primeira abertura do chat
- Layout: `.eucode/.gitignore` (ignora memory/), `.eucode/eucodeIgnore`, `.eucode/eucode.json`, `.eucode/memory/session_*.json`
- Migracao automatica e silenciosa: `.eucodeIgnore` e `eucode.json` da raiz sao movidos para `.eucode/` (fs.rename com fallback para fs.copyFile)
- Notificacao info com botao "Abrir pasta" lista os arquivos migrados na primeira execucao apos o update
- utils/ignore.ts: prefere `.eucode/eucodeIgnore` mas mantem retrocompat com `.eucodeIgnore` na raiz
- custom-commands.ts: prefere `.eucode/eucode.json` (workspace) ou `~/.eucode/eucode.json` (global)
- Deletar sessao via painel remove o session_<id>.json correspondente (sem garbage collection)
- Botao "Abrir memoria da sessao atual" + nova secao colapsavel "Memoria da sessao" nas configs
- Handlers no extension: `remember_decision`, `remember_decision_result`, `open_memory_file`
- Atualizado scope label de "eucode.json na raiz" para ".eucode/eucode.json"
- README com nova secao "Memoria persistente por sessao" + secao ".eucode/ — pasta de configuracao"

## 0.8.3

- Botao HYBRID do header agora respeita o master switch das configuracoes: se HYBRID nao estiver ativado em Configuracoes → HYBRID, o botao fica desabilitado (opacidade reduzida, cursor not-allowed)
- Click no botao desabilitado mostra alerta orientando o usuario a ativar nas configuracoes primeiro
- Desativar HYBRID nas configuracoes forca o botao do header para off automaticamente
- Ativar HYBRID nas configuracoes nao liga o botao automaticamente — usuario clica para usar (separa intencao "permitido" de intencao "usar agora")

## 0.8.2

- **NOVO: Comandos personalizaveis em eucode.json** — defina atalhos `/comando` que expandem em prompts completos. Cada comando pode opcionalmente forcar AUTO e/ou HYBRID ao rodar
- Estrutura do arquivo: array de objetos `{ command, prompt, description?, autoMode?, hybridMode? }`. Validacao com mensagens de erro nao-bloqueantes (comandos invalidos sao ignorados e logados)
- Escopo configuravel (toggle nas configs): **workspace** (`eucode.json` na raiz do projeto, committable) ou **global** (`~/.eucode/eucode.json`, pessoal). So um ativo por vez
- Autocomplete inline quando o usuario digita `/` no chat: dropdown mostra comandos disponiveis com icone categorizado (bolt = AUTO, diamond = HYBRID, auto_awesome = ambos, terminal = nenhum)
- Navegacao por teclado: setas ↑/↓ para selecionar, Tab para aceitar, Esc para fechar
- Hot reload automatico via `vscode.workspace.createFileSystemWatcher` (workspace) ou `fs.watch` (global, debounced 200ms) quando o arquivo e editado
- Banner amarelo "Salvar como comando" aparece automaticamente quando o usuario envia prompt com 30+ palavras — clique abre dialog pre-preenchido
- Dialog dedicado para criar comando: campos nome, descricao, prompt, toggles AUTO e HYBRID, radio de escopo. Validacao client-side + erro do backend (ex: duplicata)
- Nova secao colapsavel "Comandos personalizaveis" no painel de config com radio de escopo e botao "Abrir eucode.json"
- Botao "Abrir eucode.json" cria o arquivo vazio (`[\n]`) se nao existir e abre no editor para edicao
- src/services/custom-commands.ts: loadCommands, appendCommand, parseSlashInput, watchCommandsFile
- 3 novos handlers no extension: `save_command`, `open_commands_file`, `change_commands_scope`
- README com secao dedicada a comandos personalizaveis (estrutura, escopo, hot reload, banner, como usar)

## 0.8.1

- **NOVO: Autocomplete inline** — sugestoes de codigo enquanto voce digita (texto fantasma cinza, aceita com Tab). Debounce de 500ms, cancela requests obsoletos quando o cursor move, contexto de 30 linhas antes + 5 depois. Skip automatico em plaintext/markdown/log/git-commit
- **NOVO: Fix with Eucode** — lampada de Quick Fix em erros do editor + item de menu de contexto para refatorar selecao. Confirmacao com 3 botoes (Aplicar / Visualizar / Cancelar), Visualizar abre diff lateral antes de aplicar
- Ambos os recursos seguem a logica HYBRID: local primeiro, suporte (Claude/GPT/Gemini) como fallback quando o local retorna vazio ou fraco
- Confirmacao do Fix informa se a sugestao veio do local ou do suporte HYBRID
- Camada unificada completion-service.ts: getCompletion(settings, req) chama o modelo local em modo non-streaming e ja faz o fallback transparente
- Defaults: ambas as features sao opt-in (desligadas por padrao) — usuario habilita nas configuracoes
- Novo painel colapsavel "Recursos do Editor" com toggles individuais para autocomplete e Fix
- "Ferramentas disponiveis" tambem agora e um painel colapsavel — reduz o tamanho visual do painel de configuracoes
- Comando `eucode-ia.fixWithEucode` exposto no command palette + menu de contexto (gated por context key)

## 0.8.0

- **NOVO: Modo HYBRID** — IA local + IA paga (Anthropic / OpenAI / Gemini) como suporte estrategico. Opcao A (consultor textual silencioso): o pago nao chama tools, apenas injeta orientacao no contexto do local
- 5 gatilhos para a IA paga: planejamento inicial, verificacao apos escrita (V1 deterministica + V2 semantica), recuperacao de erro de comando, recuperacao de erro de sintaxe persistente, recuperacao quando o local trava
- Cliente hybrid-client.ts com adaptadores para Anthropic (messages API), OpenAI (chat/completions) e Gemini (generateContent). Timeout 30s, modo degradado em erro
- Botao HYBRID no header (cyan #00d4ff quando ativo) ao lado do AUTO
- Painel de configuracoes ganha secao destacada HYBRID: dropdown provedor, API key, modelo (default por provedor)
- Defaults: claude-sonnet-4-6 / gpt-4o / gemini-2.0-flash-exp
- Timeline com items de suporte alinhados a direita, cyan azul-neon, badge "via Claude/GPT/Gemini" + motivo + detalhe + meta (tokens/tempo)
- Telemetria comparativa: chip "Divisao Local x Suporte" no final da rodada em 3 dimensoes (chamadas / tokens / tempo, formato % / %)
- API keys armazenadas localmente em globalState, nunca enviadas para servidores alem do proprio provedor
- README com secao HYBRID em destaque imediatamente apos a apresentacao do plugin

## 0.7.4

- Parser de stack trace na saida de comandos: extrai caminhos file.ext:line:col e popula counters.lastErrorFiles
- Detector de arquivo errado em modo AUTO: se o erro aponta para arquivo A mas o modelo editou arquivo B, nudge especifico avisa "WRONG FILE. You edited X but the error is in Y"
- run_command detecta runtime errors em processos long-running: server inicia mas joga TypeError/500 nao e mais reportado como sucesso
- Bloco ERROR LOCATION incluido em todos os nudges de comando falho com paths + summary destacados
- Status visivel para resposta vazia: "Modelo retornou vazio — recarregando contexto (tentativa N/3)" substitui itens silenciosos com bullet
- Botao "Tentar mais 5 vezes" no chat quando [AUTO PAUSADO]: click reenvia mensagem de continuacao sem o usuario reescrever prompt
- Status "Compactando contexto..." removido da timeline (ruido — pruning continua acontecendo em silencio)
- Todos os nomes de arquivo na timeline destacados em amarelo, nao apenas o primeiro
- README: tabela de modelos por tipo de tarefa (<7B, 7B-13B, 30B+) com limitacoes praticas
- README: recomendacao do Ministral 3 14B Reasoning para hardware potente, com requisitos minimos por SO (macOS Apple Silicon, Windows/Linux com GPU NVIDIA/AMD, CPU-only) e configuracao de sampling especifica
- README: nota explicita sobre comecar com Context Length 4096 antes de subir para 256k

## 0.7.3

- Todos os nomes de arquivo na timeline destacados em amarelo, nao apenas o primeiro: listas como "Abertos no editor: a.ts, b.tsx, c.json" agora tem cada arquivo pintado individualmente para identificacao rapida

## 0.7.2

- Arquivo criado/editado abre automaticamente em evidencia no editor (preview: false, preserveFocus: true), com throttle de 1.5s por path
- Modo AUTO nao desiste mais ao receber erro de comando: novos counters lastCommandFailed e lastBuildPassed forcam continuacao ate o build passar com exit code 0
- run_command sinaliza falhas explicitas ao modelo com prefixo [FAILED exit=N] e instrucao "diagnose and fix"
- Detector de codigo dumped no chat: se o modelo escrever bloco de codigo grande (>200 chars) sem chamar tool, loop em AUTO injeta correcao forcando uso de write_local_file/edit_file
- edit_file com old_string vazio nao falha mais com erro terminal: cria arquivo novo automaticamente ou retorna mensagem explicativa com opcoes acionaveis
- Erro "old_string not found" agora inclui preview do arquivo e instrucao para chamar read_local_file primeiro
- System prompt do AUTO reescrito com regras estritas e exemplos negativos (proibido terminar com "vou tentar")
- [AUTO PAUSADO] retorna motivo especifico do bloqueio quando atinge cap de 5 tentativas
- Hard timeout de 5 min em run_command: SIGTERM + SIGKILL apos 2s, exit code 124 (convencao GNU timeout)
- Loop guard de tool repetida: 3+ chamadas identicas disparam [LOOP DETECTED] forcando mudanca de abordagem
- Fila de mensagens injetadas durante chamadas lentas (substitui slot unico last-write-wins)
- emitTelemetry helper extraido: telemetria sempre emitida em todos os pontos de saida do loop
- Diagnostics check usa counters.filesWritten em vez de filesReadThisRound (correto para detectar erros em arquivos modificados)
- Guard rapido em detectEscapedToolCall: evita CPU spike em respostas longas sem hints de tool call
- Remocao de variavel morta filesWrittenThisRound

## 0.7.1

- Modo AUTO: cache de leituras por round — read_local_file e list_directory retornam resultado cacheado, eliminando releituras repetidas do mesmo arquivo
- Modo AUTO: loop infinito de leitura eliminado — isGarbage agora so dispara em respostas completamente vazias, nao em respostas curtas legitimas
- Modo AUTO: pruning preventivo aumentado para keepPairs=3, evitando que o modelo perca o contexto dos resultados das ferramentas recentes
- Modo AUTO: modelo forcado a agir quando retorna texto sem ter escrito nenhum arquivo (Stop planning — act now)
- Modo AUTO: verificacao automatica de erros do editor apos resposta final — agente continua corrigindo ate os erros de TypeScript/build desaparecerem
- Modo AUTO: warnings do VS Code ignorados — somente [ERROR] bloqueia o loop; avisos de schema do editor nao causam mais travamento
- Modo AUTO: historico do ultimo par incluido para o modelo nao perder contexto da conversa anterior
- Modo AUTO: maxSteps reduzido de 200 para 40; instrucao clara de finalizacao no system prompt
- Modo AUTO: pendingActionStreak limita a 3 tentativas de descricao sem acao antes de retornar
- Telemetria ao vivo durante streaming: contador de tokens e tokens/s atualizados em tempo real na timeline via requestAnimationFrame
- Telemetria: item "Gerando" criado ao primeiro chunk, atualizado continuamente, finalizado com dados definitivos do servidor ao concluir
- Telemetria: item live removido automaticamente se o stream for interrompido por tool call (era preamble, nao resposta final)

## 0.7.0

- Suporte a RAG opcional via Chroma — banco vetorial local configuravel nas settings (toggle + endpoint + collection)
- RAG injeta contexto semantico relevante no system prompt antes de cada resposta; timeout de 5s, nunca bloqueia o chat
- .eucodeIgnore: arquivo de filtro gitignore-style na raiz do workspace para excluir arquivos/pastas do contexto do agente
- Telemetria de desempenho na timeline: chips com tokens/s, prompt tokens e tempo total de resposta ao final de cada rodada
- Distincao entre erro de infraestrutura (OOM, conexao) e contexto cheio — sentinel __INFRA_ERROR__ retorna mensagem direta sem retry
- Sentinel __ABORTED__ para cancelamento pelo usuario, separado de outros erros
- Notificacao nativa macOS via osascript quando VS Code nao esta em foco

## 0.6.3

- Timeline persistente: texto do LM permanece visivel ao iniciar nova tool call — convertido em markdown fixo em vez de sumido
- Timeline nao fecha ao finalizar: a bolha do agente permanece no chat com toda a timeline visivel para o usuario ler no seu tempo
- Correcao de ID duplicado: cada rodada do agente tem sua propria timeline isolada, evitando que status e texto fossem para a rodada errada
- Recuperacao automatica de contexto em ambos os modos (normal e Auto): resposta vazia ou truncada dispara poda progressiva e retry silencioso sem mostrar erro ao usuario
- Poda preventiva calibrada para 2048 tokens: limites de output de ferramentas ajustados, historico reduzido para 1 par
- Notificacao nativa do macOS via osascript quando o VS Code nao esta em foco
- Timeline colorida por resultado: itens ficam vermelhos quando o comando falha (exit code != 0), verdes quando bem-sucedido
- Nome de arquivo destacado em amarelo dentro dos itens da timeline
- System prompt compactado (~50% menor) para preservar tokens para o trabalho do agente

## 0.6.2

- Timeline colorida por tipo de acao: leituras de arquivo em azul, escritas/edicoes em amarelo, comandos/git/busca em verde-azulado
- Classificacao automatica de itens da timeline pelo prefixo do status (Reading, Writing, Editing, Running, git, Searching)
- Cores aplicadas ao completar o item (done), mantendo branco enquanto ativo para nao distrair durante execucao

## 0.6.1

- Suporte nativo a API Anthropic (Claude): provider dedicado com endpoint `/v1/messages`, headers `x-api-key` e `anthropic-version`, conversao automatica do historico para o formato Anthropic (tool_use, tool_result)
- Streaming de respostas em tempo real: tokens aparecem no chat conforme sao gerados, para todos os provedores (SSE para OpenAI-compat e Anthropic)
- Terminal separado da bolha de resposta: output de comandos exibido em row propria acima do texto gerado, sem mistura de conteudo
- Texto streaming em branco puro com `white-space: pre-wrap`; markdown renderizado apenas na resposta final completa
- Controle granular de ferramentas: painel no config com toggle liga/desliga por ferramenta (explorar diretorios, ler, editar, escrever, buscar, diagnosticos, terminal, git, web search, checklist)
- Modelos Claude sugeridos como chips clicaveis no config quando provider e Anthropic (Opus 4.7, Sonnet 4.6, Haiku 4.5)
- Campo Host ocultado automaticamente ao selecionar Anthropic; API Key torna-se obrigatoria
- Verificacao de conexao Anthropic via `GET /v1/models` (leve, sem custo de token)
- Erros da API propagados com mensagem detalhada (body JSON do erro exposto ao usuario)

## 0.5.0

- Edicao cirurgica com `edit_file`: substitui apenas o trecho exato do arquivo sem sobrescrever o restante — ferramenta preferencial para edicoes parciais
- Integracao git completa com `run_git`: operacoes read-only (status, log, diff, branch) executam direto; operacoes que modificam estado (commit, push, checkout) exigem confirmacao; destrutivas (reset --hard, push --force) sao bloqueadas
- Diagnosticos do editor com `get_diagnostics`: agente consulta erros e warnings do VS Code diretamente, sem pedir para o usuario copiar mensagens de erro
- Busca avancada com ripgrep: `search_in_workspace` usa `rg` quando disponivel (mais rapido, com contexto por arquivo), com fallback automatico para grep
- Permissoes dinamicas de comandos: whitelist fixa removida; cada comando exibe dialog com tres opcoes — Bloquear, Permitir uma vez, Permitir na sessao
- Web search com `web_search`: busca via DuckDuckGo Instant Answer API sem chave de API, com fallback para scraping HTML
- Checklist de tarefas na UI: agente pode atualizar um painel de progresso ao vivo dentro da bolha de loading durante tarefas multi-step (`todo_update`)
- System prompt e todas as instrucoes para o LLM reescritos em ingles para melhor desempenho com modelos locais
- Integracao git: `run_command` para git substituido por ferramenta dedicada `run_git` com controle de seguranca por categoria de operacao

## 0.4.1

- Protecao contra perda de conteudo em edicoes: write_local_file em arquivo existente exige read_local_file previo na mesma rodada
- Prompt reforçado: regras explicitas para preservar conteudo acumulado ao editar arquivos com multiplas solicitacoes

## 0.4.0

- Notificacoes do sistema funcionando corretamente: rastreia foco via onDidChangeWindowState em vez de checar vscode.window.state.focused no momento da chamada
- Notifica quando agente conclui tarefa e quando aguarda aprovacao de arquivo, sempre que o VS Code nao estiver em foco

## 0.3.9

- Correcao: modelo retornando vazio apos tool call agora continua o loop em vez de encerrar com "Nao foi possivel obter resposta"
- Historico filtrado: respostas de erro nao sao mais enviadas ao modelo como contexto (evita contaminacao do comportamento)

## 0.3.8

- Notificacao ao usuario quando o agente conclui a tarefa e o VS Code nao esta em foco
- Notificacao corrigida para usar vscode.window.state.focused (janela do sistema), nao visibilidade do painel

## 0.3.7

- Botao Stop com mesmo tamanho e estilo do botao Enviar (alinhamento corrigido)
- Barra de contexto acima do input mostra os arquivos abertos no editor, atualiza ao trocar de aba
- Botao Injetar aparece no lugar de Enviar durante execucao do agente
- Protecao contra remocao de codigo: write_local_file verifica referencias externas antes de remover simbolos
- Regra de remocao adicionada ao prompt: busca obrigatoria antes de apagar funcoes ou exports
- Botao Stop e Enviar nivelados verticalmente com align-items center

## 0.3.6

- Botao Stop para abortar execucao do agente a qualquer momento
- Injecao de mensagem durante execucao: usuario pode enviar mensagem enquanto agente roda
- Terminal unico: fecha bloco anterior ao iniciar novo comando
- Modo auto sem limite de passos: step reseta a cada tool call, limite de 200 iteracoes

## 0.3.5

- Modo Automatico (Beta): botao no header que ativa escrita direta de arquivos sem card de aprovacao
- Apos cada write_local_file no modo auto, agente roda os testes automaticamente e corrige falhas em loop
- Deteccao ampliada de acoes fingidas: modelo nao consegue mais dizer "eu criei", "eu removi", "executei os testes" sem ter chamado a ferramenta
- Em modo auto, mensagem de retorno explicita instrui o modelo a usar a ferramenta em vez de descrever
- Botao Auto (Beta) fica verde quando ativo, com tooltip descritivo

## 0.3.4

- Prompt reescrito: instrui o agente a explorar o workspace com ferramentas antes de responder qualquer pergunta sobre o projeto
- Analise de imagem: temperature reduzida para respostas mais diretas, filtro de limpeza remove raciocinio interno exposto por modelos locais
- Regras mais claras contra exposicao de raciocinio interno (Goal, Context, Action Plan, etc.)

## 0.3.3

- Correcao de workspace: ignora raiz do sistema operacional quando nenhum projeto valido esta aberto
- Aviso claro ao usuario quando nenhuma pasta de projeto esta aberta no VS Code

## 0.3.2

- Icone [E] na Activity Bar: acesso rapido ao chat sem precisar digitar comando
- Chat registrado como WebviewView — abre como aba no painel lateral, pode ser arrastado para qualquer posicao
- Icone SVG monocromatico [E] otimizado com proporcoes balanceadas

## 0.3.1

- Multiplas sessoes de chat com titulo gerado automaticamente da primeira mensagem
- Painel de sessoes no header: lista conversas anteriores, permite carregar ou excluir individualmente
- Botao "Novo chat" inicia sessao limpa sem perder o historico anterior
- Card de aprovacao de arquivo some do chat apos aceitar ou rejeitar
- Agente auto-continua ao detectar mais padroes de acao pendente: "vou refatorar", "vou corrigir", "vou focar", "enquanto isso" e variantes em ingles
- Janela de deteccao de acao pendente ampliada de 4 para 6 linhas
- Limite de passos do agente aumentado de 10 para 20
- Status contextual exibido diretamente na bolha de loading ao lado das 3 bolinhas, substituindo o status-bar externo
- Terminal inserido dentro da bolha de loading (abaixo do status), eliminando quebra de layout
- Prompt simplificado: instrucoes diretas e imperativas, sem secoes que o modelo usava como template de raciocinio

## 0.3.0

- Diff estilo VS Code no card de aprovacao: algoritmo Myers com diff real linha a linha, numeros de linha antes/depois em colunas separadas, contexto de 3 linhas ao redor das alteracoes e separador de hunk entre blocos distantes
- Syntax highlight no diff com as cores exatas do tema VS Code dark (keywords, strings, comentarios, tipos)
- Agente sempre escreve o arquivo diretamente via ferramenta — nunca mais exibe codigo no chat pedindo para o usuario aplicar manualmente
- Respostas sem raciocinio interno exposto: analises, estrategias e propostas proativas removidas das respostas
- Terminal em tempo real com bloco fixo e status-bar fora do scroll, eliminando quebra de layout
- Parsing robusto de tool call: reconhece JSON com tool_calls[], formato direto e tags de modelos locais
- Processos longos (npm start, node, python) resolvem automaticamente apos detectar servidor pronto ou timeout de 8s
- Status contextual no lugar de "Passo X/10 pensando": mensagens descritivas por acao
- Agente auto-continua quando modelo anuncia acao sem executar ("vou criar", "agora vou", etc.)

## 0.2.9

- Terminal em tempo real no chat: saida aparece linha a linha diretamente no chat via streaming com `spawn`
- Bloco de terminal com estilo proprio (fundo escuro, texto claro) separado visualmente da resposta do agente
- Saida de stdout e stderr transmitida via streaming, substituindo abordagem que acumulava tudo e exibia so no final

## 0.2.8

- Campo Modelo no painel de configuracoes: o usuario especifica o nome exato do modelo carregado
- Se o campo ficar vazio, o servidor usa o modelo padrao que estiver carregado
- Modelo configuravel funciona com LM Studio, Ollama e qualquer provedor OpenAI-compativel

## 0.2.7

- Icones Material Symbols Rounded em toda a interface: configuracoes, camera, enviar, fechar, historico, copiar codigo, aceitar/rejeitar arquivos
- Botao de envio agora exibe icone de seta + texto
- Avatar do agente substituido por icone robot; avatar do usuario exibido com icone de pessoa

## 0.2.6

- Aprovacao de edicao de arquivos: antes de gravar qualquer arquivo, o agente exibe um card no chat com o conteudo antes e depois (diff visual) — o usuario aceita ou rejeita com um clique
- Arquivos novos mostram badge "Novo" em verde; arquivos editados mostram badge "Editar" em amarelo
- Se rejeitado, o agente recebe feedback e pode tentar uma abordagem diferente
- Respostas mais rapidas: limite de passos reduzido de 15 para 10, historico enviado ao modelo reduzido de 8 para 5 pares
- Historico removido do bloco de sistema (era enviado em duplicata)

## 0.2.5

- Historico de conversa isolado por workspace: cada pasta/projeto mantem seu proprio contexto de chat
- Ao trocar de workspace no VS Code, o historico e recarregado automaticamente para o contexto correto
- Historico persistido via globalState do VS Code por chave de workspace
- Agente responde no idioma do usuario: portugues por padrao, mas adapta se a conversa for em outro idioma

## 0.2.4

- Novo tema visual: fundo escuro profundo com accent azul (#3a7bd5)
- Avatares de mensagem, bubbles de usuario com gradiente azul-escuro e borda destacada
- Animacao de carregamento com tres pontos em bounce
- Blocos de codigo redesenhados com label de linguagem

## 0.2.3

- Botao "Retomar conversa" no header: historico da sessao anterior restaurado com um clique
- Chat nao reinicia mais ao mudar de aba no VS Code (retainContextWhenHidden)
- Timeout de resposta aumentado para 10 minutos

## 0.2.2

- Correcao de leitura de arquivos: dotfiles como .gitignore e .env agora aparecem na listagem
- Correcao do loop do agente: sequencia assistant + tool segue o formato correto da API
- Historico limpo na inicializacao: entradas de erro de conexao removidas automaticamente

## 0.2.1

- Correcao de conexao HTTP com o LM Studio — erro de protocolo SSL ao usar http://localhost

## 0.2.0

- Suporte a multiplos provedores de IA: LM Studio, Anthropic, Ollama e qualquer servidor OpenAI-compativel
- Campo de API Key no painel de configuracao (opcional para servidores locais)
- Indicador de conexao no header
- Ping automatico no servidor ao abrir o chat e apos salvar configuracoes

## 0.1.0

Lancamento inicial do Eucode IA.

- Chat com agente autonomo integrado ao workspace
- Leitura, criacao e edicao de arquivos via ferramentas
- Busca por simbolos e padroes no codigo com grep
- Execucao de comandos no terminal com lista de permissoes
- Analise de imagens (screenshots, diagramas, wireframes)
- Historico persistente entre sessoes
- Configuracao de host para uso em rede local ou VPN
