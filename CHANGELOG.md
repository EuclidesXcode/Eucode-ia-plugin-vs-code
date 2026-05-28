# Changelog

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
