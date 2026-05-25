# Changelog

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
