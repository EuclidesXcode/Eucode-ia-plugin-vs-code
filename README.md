# Eucode IA

Agente de inteligencia artificial para engenharia de software, integrado diretamente ao VS Code. Conecta-se a modelos locais via [LM Studio](https://lmstudio.ai) ou Ollama, ou diretamente a API Anthropic (Claude) — sem enviar nenhum dado para servidores externos quando em modo local.

---

## O que faz

O Eucode IA e um agente autonomo com acesso completo ao seu workspace. Ele nao apenas responde perguntas — ele age: le arquivos, edita trechos cirurgicamente, busca simbolos, executa comandos, consulta erros do editor, faz operacoes git e pesquisa na web.

- **Streaming em tempo real** — respostas aparecem no chat conforme sao geradas, token a token
- **Edicao cirurgica** — substitui apenas o trecho exato do arquivo, sem risco de perder o restante
- **Integracao git** — status, log, diff, commit, push, branch — com controle de seguranca por tipo de operacao
- **Diagnosticos do editor** — le erros e warnings do VS Code diretamente, sem voce precisar copiar nada
- **Busca avancada** — usa ripgrep quando disponivel, com fallback para grep
- **Web search** — pesquisa documentacao e erros desconhecidos sem sair do chat
- **Executa comandos** — build, testes, instalacao de dependencias, servidores
- **Analisa imagens** — screenshots, diagramas, wireframes
- **Checklist de tarefas ao vivo** — exibe progresso passo a passo durante tarefas longas
- **Permissoes dinamicas** — voce aprova cada comando individualmente ou para a sessao toda
- **Controle de ferramentas** — habilite ou desabilite cada ferramenta individualmente nas configuracoes
- **Autocomplete inline** — sugestoes de codigo enquanto voce digita, no padrao Copilot (texto fantasma cinza, aceita com Tab)
- **Fix with Eucode** — lampada de Quick Fix em erros do editor e item no menu de contexto para refatorar selecao
- **Comandos personalizaveis** — defina atalhos `/comando` em `eucode.json` que expandem em prompts completos, com AUTO/HYBRID embutidos

---

## ◆ Modo HYBRID — IA local + IA paga como suporte (destaque)

O modo HYBRID resolve o maior dilema de quem usa IA para desenvolvimento: **custo da API paga vs. capacidade limitada de modelos locais**.

A ideia e simples: a IA local executa o trabalho principal (~70%) e a IA paga entra como **consultor estrategico** apenas em momentos criticos onde o local nao da conta — economizando ate 70% do que voce gastaria usando so a API paga, sem abrir mao da qualidade nos pontos de decisao.

### Quando a IA paga entra (5 gatilhos)

1. **Planejamento inicial** — a primeira mensagem do usuario passa pelo pago, que gera um plano detalhado em 5-10 passos. O local executa.
2. **Verificacao apos escrita/edicao** — verificacao deterministica (V1) confere no disco se o arquivo foi realmente criado. Verificacao semantica (V2) so quando ha milestones (build verde, por exemplo).
3. **Recuperacao de erro de comando** — se o local falhar 3+ vezes ao corrigir um erro de build/test, o pago analisa o stack trace e propoe correcao especifica.
4. **Recuperacao de erro de sintaxe persistente** — TypeScript errors via `get_diagnostics` que o local nao resolveu sozinho.
5. **Local travou** — `[AUTO PAUSADO]`, modelo descrevendo sem agir, etc. Antes de desistir, consulta o pago para um plano de saida.

### Provedores de suporte suportados

| Provedor | Modelo default | Quando usar |
|---|---|---|
| **Anthropic (Claude)** | `claude-sonnet-4-6` | Melhor qualidade geral para coding, raciocinio causal forte |
| **OpenAI (ChatGPT)** | `gpt-4o` | Equilibrio entre custo e qualidade, boa para revisoes |
| **Google (Gemini)** | `gemini-2.0-flash-exp` | Mais barato, rapido, contexto enorme |

Voce escolhe **um** provedor de suporte. Sua API key fica armazenada localmente no VS Code (`globalState`) e nunca e enviada para nenhum servidor alem do proprio provedor.

### Como ativar

1. Abra as configuracoes (engrenagem no chat)
2. Role ate a secao **◆ HYBRID — IA local + IA paga como suporte**
3. Ative o toggle, escolha o provedor, cole a API key, opcionalmente especifique um modelo
4. Salve
5. Clique no botao **◆ Hybrid** no header (vai ficar azul neon quando ativo)
6. Use normalmente — o suporte atua automaticamente nos 5 gatilhos

### Transparencia total

- Cada intervencao da IA paga aparece na timeline com **badge cyan azul-neon** (`◆ via Claude/GPT/Gemini`) e contexto do motivo (planejamento, verificacao, recuperacao)
- Telemetria por chamada: tokens consumidos + tempo
- **Chip comparativo no final da rodada**: mostra a divisao Local x Suporte em 3 dimensoes (chamadas / tokens / tempo)
- Se a API paga falhar (timeout, sem creditos, key invalida), o modo entra automaticamente em modo degradado e o local continua sozinho

### Modo Hybrid ≠ Modo AUTO

- **AUTO** controla se o agente pede aprovacao para escrever/rodar comandos
- **HYBRID** controla se a IA paga atua como suporte para a IA local
- Os dois podem ser ativados juntos ou separados

---

## 🎙 Modo JARVIS — voz local (Whisper) + leitura em voz alta

Pressione o botao de microfone no chat e fale com o Eucode IA. O audio e transcrito **localmente** via Whisper rodando no LM Studio (zero custo, sem enviar audio pra cloud). O agente pode responder em voz alta usando o TTS nativo do sistema.

### Como ativar

1. Abra as configuracoes (engrenagem)
2. Role ate a secao **🎙 JARVIS** e ative o toggle principal
3. Configure:
   - **Endpoint do Whisper** — geralmente `http://localhost:1234` (mesmo do LM Studio)
   - **Modelo Whisper** — `whisper-1` ou o id do modelo carregado no LM Studio
   - **Idioma** — `pt`, `en`, ou vazio para auto-detectar
4. Salve. O botao de microfone aparece no chat
5. Pressione o botao, fale, pressione de novo pra encerrar. O texto transcrito vai pro input — voce edita ou da Enter pra enviar

### Como configurar o Whisper no LM Studio (passo a passo)

O LM Studio expoe um endpoint compativel com a API da OpenAI em `/v1/audio/transcriptions`. Voce so precisa baixar um modelo Whisper.

**1. Baixar o modelo no LM Studio:**

- Abra o LM Studio
- Va em **Discover** (lupa na barra lateral)
- Pesquise por `ggerganov/whisper` ou `whisper`
- **Modelos recomendados:**
  - `ggerganov/whisper.cpp` — variantes `tiny`, `base`, `small`, `medium`, `large-v3`
  - Para **portugues + velocidade**: `whisper-small` (~500MB) — qualidade ok, rapido
  - Para **portugues + qualidade**: `whisper-medium` (~1.5GB) — equilibrio ideal
  - Para **maxima qualidade**: `whisper-large-v3` (~3GB) — mais lento mas excelente
- Clique em Download

**2. Carregar o modelo:**

- Va na aba **Local Server** (icone de servidor)
- No topo, selecione o modelo Whisper baixado no dropdown ao lado do modelo de chat (LM Studio suporta carregar varios modelos simultaneamente)
- Clique em **Start Server**
- Anote o endpoint mostrado (geralmente `http://localhost:1234`)

**3. Identificar o ID do modelo:**

- No LM Studio Local Server, expanda os detalhes do modelo carregado
- O `id` aparece em formato `ggerganov/whisper.cpp/ggml-model-Q4_K_M.bin` ou similar
- Copie esse id para o campo **Modelo Whisper** nas configuracoes do plugin
- Se nao funcionar, tente apenas `whisper-1` (alias OpenAI-compativel)

**4. Testar:**

- Abra o chat do Eucode IA
- Ative o microfone
- Fale "ola Eucode" e pressione pra parar
- O texto deve aparecer no input em 1-3 segundos

### Servidor de voz (para app mobile)

Dentro da secao JARVIS, ha um sub-toggle **"Servidor de voz (para app mobile)"**. Quando ativado, o plugin sobe um servidor HTTP local na porta `9876` (configuravel) que aceita:

- `POST /voice-input` — envia texto pra ser processado pelo agente
- `POST /transcribe` — envia audio pra ser transcrito pelo Whisper

Toggle **"Expor na rede local"** controla onde o servidor escuta:
- **OFF (padrao):** `127.0.0.1` — so apps na mesma maquina
- **ON:** `0.0.0.0` — apps mobile na mesma WiFi conseguem conectar

Clique em **"Mostrar dados de pareamento"** para ver:
- **URL** completa (ex: `http://192.168.0.10:9876`)
- **Token** de autenticacao (todo request precisa de header `Authorization: Bearer <token>`)
- **IPs locais** detectados na sua maquina

O app mobile (a desenvolver) consome esses dois endpoints. Mais detalhes do protocolo no codigo: [src/services/voice-server.ts](src/services/voice-server.ts).

### Privacidade

- **Audio nao sai da sua maquina** quando o Whisper esta no LM Studio local
- TTS usa o motor de voz nativo do VS Code/sistema (offline)
- O token de pareamento e armazenado apenas no `globalState` do VS Code

---

## Modo CHAT (conversa livre, sem tools de codigo)

No header tem um botao **Modos** que abre um dropdown com um segmented control **DEV | CHAT** + toggles de Auto e Hybrid. Em CHAT, o agente vira um assistente conversacional puro — sem acessar arquivos do projeto, sem executar comandos, sem RAG nem memoria de sessao.

### Quando usar

- Tirar duvidas gerais (programacao, ferramentas, conceitos)
- Brainstorming sobre arquitetura ou design antes de codar
- Pedir analise de URLs (com a tool `web_search` habilitada)
- Conversar sobre qualquer coisa fora do projeto

### Comportamento

- **Tools de codigo escondidas** — o modelo nao ve `read_local_file`, `edit_file`, `run_command`, etc. So `web_search` fica disponivel (se voce habilitou nas configs)
- **Sem RAG, sem memoria, sem contexto de workspace** — CHAT e isolado da tarefa de dev
- **Auto e Hybrid sao desligados automaticamente** ao entrar em CHAT, sem perder sua preferencia. Ao voltar para DEV, o estado anterior e restaurado
- **Visual diferenciado** — mensagens em CHAT recebem badge `CHAT` e borda lateral azul-violeta, para diferenciar no historico misturado com tarefas DEV
- **Mesmo modelo local** — usa o mesmo provider configurado nas configs (LM Studio, Ollama, Anthropic, etc). Sem custo adicional

### Como ativar

1. Clique no botao **Modos** no header
2. Selecione **CHAT** no segmented control
3. Os toggles Auto e Hybrid ficam acinzentados — o indicador compacto ao lado do botao mostra `Modos · CHAT`
4. Mande uma mensagem normalmente

Para voltar a programar, clique em **DEV** no mesmo dropdown.

---

## Recursos do Editor (autocomplete + fix inline)

Alem do agente conversacional, o Eucode IA oferece duas integracoes diretas com o editor — sem precisar abrir o chat. Ambas sao opt-in (desligadas por padrao) e configuraveis no painel de configuracoes na secao colapsavel **Recursos do Editor**.

### Autocomplete inline (estilo Copilot)

Sugestoes de codigo aparecem como texto fantasma cinza enquanto voce digita. Aceite com **Tab**.

- Debounce de 500ms aguardando voce parar de digitar
- Cancela requests obsoletos automaticamente quando o cursor move
- Contexto enviado ao modelo: 30 linhas antes do cursor + 5 depois
- Skip automatico em arquivos de texto plano, markdown, logs e mensagens de commit
- Funciona com qualquer linguagem que o LSP do VS Code reconheca

### Fix with Eucode

Dois pontos de entrada:

1. **Lampada de Quick Fix** — aparece em erros de TypeScript, ESLint, etc. Clique na lampada e selecione "◆ Fix with Eucode". O modelo recebe o erro + codigo e propoe correcao.
2. **Menu de contexto (botao direito)** — selecione qualquer trecho de codigo e clique com botao direito → "◆ Refactor with Eucode". Funciona mesmo sem erro, para refatoracoes voluntarias.

Antes de aplicar, voce escolhe entre:
- **Aplicar** — substitui a selecao pela sugestao
- **Visualizar** — abre a sugestao em uma aba lateral para comparar antes de decidir
- **Cancelar** — descarta a sugestao

A confirmacao mostra se a correcao veio do **modelo local** ou do **suporte HYBRID** (quando configurado).

### Comportamento com HYBRID ativo

Ambos os recursos seguem a mesma logica do modo HYBRID: **primeiro tenta o local**, e somente se o local retornar vazio ou muito fraco, faz fallback transparente para o provedor pago configurado (Claude/GPT/Gemini). Isso mantem o custo baixo — voce so paga tokens quando o local nao deu conta.

Se voce **nao tem HYBRID configurado**, o resultado do local e usado direto (mesmo que fraco). Se o modelo local estiver fora do ar, a sugestao simplesmente nao aparece — sem mensagens de erro intrusivas.

### Como ativar

1. Abra as configuracoes (engrenagem no chat)
2. Expanda a secao **Recursos do Editor**
3. Ative o toggle de **Autocomplete inline** e/ou **Fix with Eucode**
4. Salve

Os toggles funcionam independentemente — voce pode habilitar so um, ou os dois.

---

## Comandos personalizaveis (`eucode.json`)

Voce pode definir comandos de atalho em um arquivo `eucode.json`. Digite `/` no chat para ver a lista, navegue com setas, aceite com Tab. O comando expande para o `prompt` salvo e (opcionalmente) ja ativa AUTO e/ou HYBRID.

### Estrutura do arquivo

```json
[
  {
    "command": "/testar",
    "prompt": "Quero que faca o teste de ponta a ponta. Rode npm test, analise as falhas e corrija ate todos os testes passarem.",
    "description": "Roda testes E2E e corrige falhas",
    "autoMode": true,
    "hybridMode": false
  },
  {
    "command": "/refatorar-arquitetura",
    "prompt": "Analise a estrutura atual do projeto e proponha uma refatoracao da arquitetura. Foque em separacao de responsabilidades e testabilidade.",
    "description": "Plano de refatoracao arquitetural (recomenda HYBRID)",
    "autoMode": false,
    "hybridMode": true
  }
]
```

**Campos:**

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---|---|
| `command` | string | sim | Nome do atalho, deve comecar com `/` |
| `prompt` | string | sim | Texto enviado ao agente quando voce invoca o comando |
| `description` | string | nao | Texto curto que aparece no autocomplete |
| `autoMode` | boolean | nao | Forca o modo AUTO ao rodar este comando |
| `hybridMode` | boolean | nao | Forca o modo HYBRID ao rodar este comando |

### Escopo: workspace ou global

Voce escolhe onde os comandos ficam armazenados nas configuracoes do plugin:

- **Workspace** (padrao): `eucode.json` na raiz do projeto. Committable, time compartilha
- **Global**: `~/.eucode/eucode.json`. Pessoal do usuario, vale para qualquer projeto aberto

O toggle de escopo nas configuracoes troca qual arquivo o plugin esta usando. Apenas um dos dois esta ativo por vez.

### Salvar prompts longos como comando

Sempre que voce escreve um prompt com **30+ palavras** e envia, um banner amarelo aparece sugerindo "Salvar como comando". Um clique abre o dialog ja preenchido com o seu prompt, e voce define o nome do comando, descricao, e quais modos ativar.

### Como usar

1. Digite `/` no chat — o autocomplete mostra a lista
2. Use setas ↑/↓ para navegar, Tab para aceitar, Enter para enviar
3. O agente recebe o `prompt` expandido, com AUTO/HYBRID aplicados se voce configurou
4. Voce ve no chat o atalho usado: `/testar ⚡ → Quero que faca o teste...`

### Hot reload

Quando voce edita o `eucode.json` (no proprio VS Code ou em qualquer editor externo), o plugin recarrega a lista automaticamente — sem precisar reabrir o chat.

### Editar o arquivo

Nas configuracoes do plugin, na secao **Comandos personalizaveis**, clique em **Abrir eucode.json**. Se o arquivo nao existir ainda, o plugin cria um vazio.

---

## Memoria persistente por sessao

Cada sessao de chat tem um arquivo proprio em `.eucode/memory/session_<id>.json` com 3 secoes:

- **`stack`** — linguagens, frameworks e package manager detectados automaticamente do projeto na primeira rodada (lendo `package.json`, `Cargo.toml`, `pom.xml`, `pubspec.yaml`, etc)
- **`approvedCommands`** — comandos que voce aprovou via "Permitir na sessao". Antes ficavam so em memoria e voce precisava aprovar de novo a cada reload. Agora persistem
- **`decisions`** — notas curtas de decisoes do projeto, gravadas manualmente (voce) ou pelo agente

Um resumo compacto dessa memoria e injetado no system prompt em toda rodada, dando ao agente contexto persistente sem voce precisar repetir. A memoria completa fica disponivel via tool `memory_read` se o agente quiser conferir detalhes.

### Como gravar uma nota manualmente

No chat, digite:

```
/lembrar Use Zustand no lugar de Redux neste projeto
```

A nota e salva em `.eucode/memory/session_<id>.json` e passa a fazer parte do contexto que o agente recebe nas proximas rodadas.

### Agente gravando sozinho

Quando voce informa uma decisao importante durante a conversa (ex: "usamos Material UI, nao Tailwind"), o agente pode chamar `memory_remember` para persistir essa preferencia sem voce precisar pedir.

### Apagar uma sessao apaga sua memoria

Quando voce remove uma sessao no painel de sessoes, o `session_<id>.json` correspondente e apagado junto. Sem garbage collection necessario.

### Ver/editar a memoria

Nas configuracoes → secao **Memoria da sessao**, clique em **Abrir memoria da sessao atual**. Voce pode editar o JSON diretamente; o conteudo entra no proximo prompt automaticamente.

---

## Provedores suportados

| Provedor | Como conectar |
|---|---|
| **LM Studio** | Servidor local em `http://localhost:1234` (padrao) |
| **Ollama** | Qualquer endpoint OpenAI-compativel |
| **Anthropic (Claude)** | API key `sk-ant-...` — sem precisar configurar host |
| **Outro** | Qualquer servidor com `/v1/chat/completions` |

---

## Requisitos

- [LM Studio](https://lmstudio.ai) rodando com um modelo carregado, **ou** [Ollama](https://ollama.com), **ou** uma API key da Anthropic, **ou** qualquer servidor OpenAI-compativel
- VS Code 1.87 ou superior

---

## Instalacao

1. Instale a extensao pelo marketplace do VS Code
2. Configure o provedor: clique na engrenagem no header do chat
3. Para LM Studio/Ollama: abra o servidor local antes de usar
4. Para Anthropic: insira sua API key e escolha o modelo Claude

---

## Como usar

### Chat de texto

Digite sua pergunta ou instrucao no campo de texto e pressione **Enter** ou clique em **Enviar**.

O agente trabalha em multiplos passos: lista diretorios, le arquivos, busca simbolos, cria e edita codigo — mostrando o que esta fazendo em tempo real com streaming de texto e checklist de progresso.

**Exemplos do que voce pode pedir:**

```
Quais projetos existem nesse workspace e quais tecnologias cada um usa?
```

```
Corrija todos os erros de TypeScript que estao aparecendo no editor.
```

```
Crie um arquivo de configuracao do ESLint para TypeScript nesse projeto.
```

```
Tem algum memory leak no codigo de gerenciamento de eventos? Analise e corrija.
```

```
Faca um git commit com as alteracoes atuais e me mostre o diff antes.
```

```
Pesquise como usar o Zod para validar schemas em TypeScript e implemente no projeto.
```

```
Rode os testes e me explique qualquer falha que aparecer.
```

### Analise de imagens

Clique no botao de camera na area de input para anexar uma imagem. Voce pode enviar:

- Screenshots de erros ou comportamentos inesperados
- Diagramas de arquitetura para implementar
- Wireframes de interfaces para codar
- Prints de logs para depuracao

### Aprovacao de alteracoes

Antes de gravar qualquer arquivo, o agente exibe um card no chat com o diff antes/depois. Voce aceita ou rejeita com um clique.

Para comandos de terminal, aparece um dialog com tres opcoes:

- **Permitir uma vez** — executa e volta a perguntar da proxima vez
- **Permitir na sessao** — aprova esse comando para o resto da conversa
- **Bloquear** — cancela a execucao

### Modo Automatico (Beta)

Ative o botao **Auto (Beta)** no header para que o agente escreva arquivos diretamente, rode os testes apos cada edicao e corrija falhas sem interromper. Ideal para refatoracoes longas ou criacao de testes.

---

## Ferramentas do agente

Cada ferramenta pode ser habilitada ou desabilitada individualmente nas configuracoes.

| Ferramenta | O que faz |
|---|---|
| `list_directory` | Lista arquivos e pastas, ignorando node_modules, dist e similares |
| `read_local_file` | Le o conteudo completo de qualquer arquivo do workspace |
| `edit_file` | Substitui um trecho exato do arquivo sem tocar no restante (preferencial para edicoes) |
| `write_local_file` | Cria arquivos novos ou reescreve o arquivo inteiro |
| `search_in_workspace` | Busca com ripgrep (ou grep) em todos os arquivos de codigo |
| `get_diagnostics` | Consulta erros e warnings atuais do editor VS Code |
| `run_command` | Executa comandos no terminal com aprovacao dinamica |
| `run_git` | Operacoes git com controle de seguranca por categoria |
| `web_search` | Pesquisa na web via DuckDuckGo sem chave de API |
| `todo_update` | Atualiza o checklist de progresso visivel no chat |

---

## Seguranca

**Modo local:** nenhuma informacao do seu codigo, historico ou workspace e transmitida para servidores externos.

**Modo Anthropic:** as mensagens sao enviadas diretamente para `api.anthropic.com` — sem passar por nenhum servidor intermediario.

**Comandos de terminal:** sem whitelist fixa. Voce aprova cada comando individualmente ou para a sessao. Comandos destrutivos (`rm -rf`, `sudo`, pipes remotos, formatacao de disco) sao bloqueados permanentemente.

**Operacoes git:** read-only (status, log, diff) executam direto. Operacoes que modificam estado (commit, push, checkout) exigem confirmacao. Destrutivas (reset --hard, push --force) sao bloqueadas.

---

## Historico e sessoes

O historico das conversas e persistido por workspace via `globalState` do VS Code. Voce pode ter multiplas sessoes, carregar conversas anteriores ou iniciar um novo chat sem perder o contexto.

Imagens enviadas sao armazenadas apenas como resumo textual no historico, sem guardar os dados binarios.

---

## Configuracao

Clique na engrenagem no header do chat para abrir o painel de configuracoes.

- **Provedor** — LM Studio, Anthropic (Claude), ou qualquer servidor OpenAI-compativel
- **Host** — endereco completo com porta (apenas para LM Studio/Ollama)
- **Modelo** — nome exato do modelo; chips clicaveis sugerem os modelos Claude ao selecionar Anthropic
- **API Key** — obrigatoria para Anthropic (`sk-ant-...`), opcional para servidores locais
- **Ferramentas** — toggles liga/desliga para cada ferramenta disponivel

### .eucode/ — pasta de configuracao do plugin

Tudo que o Eucode IA grava no seu projeto fica organizado em uma unica pasta `.eucode/` na raiz do workspace. Ela e criada automaticamente na primeira vez que voce abre o chat:

```
seu-projeto/
└── .eucode/
    ├── .gitignore         # mantem memory/ fora do versionamento
    ├── eucodeIgnore       # padroes que o agente deve ignorar
    ├── eucode.json        # seus comandos /personalizaveis
    └── memory/
        └── session_*.json # memoria persistente por sessao
```

Versoes antigas do plugin gravavam `.eucodeIgnore` e `eucode.json` na raiz. Eles sao migrados automaticamente para dentro de `.eucode/` na primeira vez que voce abrir o chat — sem perder nenhuma configuracao.

### eucodeIgnore — filtrar arquivos do contexto

Edite `.eucode/eucodeIgnore` para excluir arquivos e pastas que o agente nao deve ler ou listar. A sintaxe e identica ao `.gitignore`:

```
# Ignorar pastas de build e dependencias
dist/
node_modules/
.cache/

# Ignorar arquivos gerados
*.min.js
coverage/

# Ignorar segredos e configs locais
.env
*.local
```

O plugin ja ignora automaticamente `node_modules`, `dist`, `.git`, `.next`, `__pycache__` e similares. O `eucodeIgnore` e para regras adicionais especificas do seu projeto.

### LM Studio em rede local

No LM Studio, va em **Server Settings** e habilite **"Servir na Rede Local"**. Depois configure o host no Eucode IA com o IP da maquina onde o LM Studio esta rodando.

### Configuracao recomendada para modelos locais (LM Studio)

As configuracoes abaixo foram validadas com o **Gemma 4 E4B** rodando em um **MacBook Air M5 16 GB** e servem como referencia para maquinas de especificacao similar. Ajuste conforme o modelo e hardware.

| Parametro | Valor recomendado | Observacao |
|---|---|---|
| **Context Length** | `2048` | Para o Gemma 4 E4B, use exatamente 2048 — valores maiores causam truncamento silencioso no slot |
| **Temperature** | `0.4` (Auto) / `0.7` (Chat) | Menor no modo Auto para mais precisao em codigo |
| **Top K Sampling** | `40` | Evita outputs verbosos; melhor que 64 para tarefas de engenharia |
| **Top P Sampling** | `0.95` | Mantido alto para diversidade controlada |
| **Min P Sampling** | `0.05` | Filtra tokens improvaveis sem restringir demais |
| **Repeat Penalty** | `1.1` | Leve — evita repeticao sem distorcer o codigo |
| **Limit Response Length** | Ativo, `1024 tokens` | Reserva metade do contexto para a resposta; o plugin gerencia o restante |
| **Context Overflow** | `Rolling Window` | Preserva tool results recentes; melhor que "Truncate Middle" para agentes |
| **CPU Threads** | `4` ou `5` | No M5, mais threads inclui nucleos de eficiencia que atrasam; 4-5 e o sweet spot |

> Estas configuracoes sao feitas no LM Studio, aba **Inference** do modelo carregado. Nao ha como defini-las pelo plugin — elas ficam salvas como preset no LM Studio.
>
> **Nota sobre Context Length:** o Eucode IA esta calibrado para janelas de 2048 tokens com o Gemma 4 E4B. Se usar um modelo com contexto maior (ex: 8192), os limites internos de poda do plugin sao conservadores mas funcionam — nao e necessario ajustar nada no plugin.

### Escolha de modelo por tipo de tarefa

A capacidade de raciocinio do agente em modo automatico depende diretamente do tamanho do modelo. Recomendacoes baseadas em uso real:

| Tamanho do modelo | Bom para | Limitacao |
|---|---|---|
| **< 7B** (Gemma 4 E4B, Phi-3-mini, Llama 3.2 3B) | Tarefas pontuais: corrigir um erro especifico, refatorar uma funcao, adicionar um endpoint, edicoes locais com contexto claro | Projetos multi-arquivo: tendem a perder o fio em tarefas que exigem raciocinio causal entre 3+ arquivos. Modo AUTO pode entrar em loop tentando corrigir o arquivo errado |
| **7B-13B** (Qwen 2.5 Coder 7B, DeepSeek Coder V2, CodeLlama 13B) | Projetos pequenos e medios: criar features completas (login + dashboard), refatorar modulos, debug com stack trace | Tarefas muito ambiciosas em uma rodada (ex: "construa um SaaS inteiro") ainda pedem intervencao humana |
| **30B+** (Qwen 2.5 Coder 32B, DeepSeek V3) ou **Claude API** | Projetos grandes, refatoracoes amplas, modo AUTO confiavel por longas execucoes | Recursos: 30B local exige 32GB+ de RAM. Claude API tem custo por token |

> **Dica pratica:** se o modo AUTO ficar pausando com `[AUTO PAUSADO]` repetidamente para tarefas que voce considera simples, o modelo provavelmente esta abaixo da capacidade necessaria. Suba uma faixa de tamanho ou divida a tarefa em pedidos menores.

### Recomendacao premium: Ministral 3 14B Reasoning (hardware potente)

Para usuarios com hardware mais potente, este modelo entrega uma experiencia significativamente superior em modo AUTO. E um modelo treinado especificamente para raciocinio passo-a-passo, com tool use nativo e janela de contexto de 256k tokens — o que resolve quase todos os problemas de pruning agressivo que afetam modelos menores.

**Por que vale a pena:**
- **Tool calling robusto:** chama as ferramentas com consistencia muito maior que modelos < 7B
- **Raciocinio causal entre arquivos:** entende fluxo de dados entre componentes, reduzindo drasticamente o cenario "modelo edita arquivo errado"
- **Contexto gigante (256k):** o agente lembra do projeto inteiro entre rodadas
- **Faixa doce 14B:** suficiente para projetos reais sem exigir 32GB+ de RAM

**Requisitos minimos por sistema operacional:**

| Sistema | RAM unificada / VRAM | Armazenamento | Observacao |
|---|---|---|---|
| **macOS (Apple Silicon)** | 16 GB minimo, 24 GB+ recomendado | 10 GB livres | M2/M3/M4 com GPU integrada. No M-series base de 16 GB feche Chrome e outros apps pesados durante uso |
| **macOS (Intel)** | Nao recomendado | — | Performance inviavel sem GPU dedicada |
| **Windows / Linux com GPU NVIDIA** | 12 GB VRAM minimo (ex: RTX 3060 12GB, RTX 4070+) | 10 GB livres | Full GPU offload garante velocidade aceitavel (15+ t/s) |
| **Windows / Linux com GPU AMD** | 16 GB VRAM (ex: RX 7900 XT) | 10 GB livres | Suporte via ROCm/Vulkan no LM Studio; performance varia |
| **Windows / Linux CPU-only** | 32 GB RAM | 10 GB livres | Funcional mas lento (3-5 t/s) — use apenas para tarefas pontuais |

**Configuracao recomendada no LM Studio:**

| Parametro | Valor |
|---|---|
| **Context Length** | `4096` para comecar; suba para `8192` se a maquina aguentar |
| **Temperature** | `0.5` (equilibrio entre coding preciso e reasoning) |
| **Top K Sampling** | `40` |
| **Top P Sampling** | `0.95` |
| **Min P Sampling** | `0.05` |
| **Repeat Penalty** | `1.05` (mais leve que para Gemma) |
| **Limit Response Length** | `2048` (reasoning models precisam de espaco para "pensar") |
| **Context Overflow** | `Rolling Window` |
| **CPU Threads** | Numero de nucleos performance da CPU (4-8 dependendo do chip) |

> **Aviso:** comece com Context Length de 4096. Nao habilite 256k de cara — vai consumir RAM em excesso e cair drasticamente a velocidade por token. Suba gradualmente conforme valida a estabilidade na sua maquina.

---

## Contexto vetorial com RAG (opcional)

O Eucode IA suporta consulta a um banco vetorial local antes de cada resposta. Quando habilitado, ele busca trechos relevantes do seu projeto (documentacao, codigo indexado, notas tecnicas) e os injeta automaticamente como contexto adicional — sem que voce precise colar nada manualmente.

**Quando usar:** projetos grandes onde o agente precisa conhecer convencoes especificas, APIs internas, arquitetura ou documentacao que nao esta no workspace aberto.

**Suporte atual:** [Chroma](https://www.trychroma.com) via API v1 (`/api/v1/collections/{name}/query`).

### Como configurar

#### 1. Instale o Chroma

```bash
pip install chromadb
```

#### 2. Inicie o servidor local

```bash
chroma run --host localhost --port 8000
```

#### 3. Indexe seu projeto

Crie um script Python para indexar os arquivos que quiser disponibilizar como contexto:

```python
import chromadb
import os

client = chromadb.HttpClient(host="localhost", port=8000)
collection = client.get_or_create_collection("eucode")

docs, ids, metas = [], [], []
for root, _, files in os.walk("./src"):
    for f in files:
        if f.endswith((".ts", ".py", ".md", ".json")):
            path = os.path.join(root, f)
            with open(path, encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
            if content.strip():
                docs.append(content[:2000])  # limite por chunk
                ids.append(path)
                metas.append({"source": path})

collection.upsert(documents=docs, ids=ids, metadatas=metas)
print(f"{len(docs)} arquivos indexados.")
```

Execute com `python index.py` a partir da raiz do projeto. Re-execute sempre que o codigo mudar.

#### 4. Ative nas configuracoes do plugin

Abra o painel de configuracoes (engrenagem no header do chat):

- Ative o toggle **RAG (Contexto Vetorial)**
- Configure o **Endpoint**: `http://localhost:8000` (padrao)
- Configure o **Collection**: nome da colecao criada (ex: `eucode`)
- Salve

O plugin passa a consultar automaticamente o Chroma a cada nova mensagem, recuperando os trechos mais relevantes e injetando-os no contexto antes da resposta. A consulta tem timeout de 5 segundos e nunca bloqueia o chat se o servidor estiver fora.

> **Dica:** se voce tem multiplos projetos, crie uma collection separada para cada um e altere o nome no config conforme troca de projeto.

---

## Ultimas versoes

### 0.10.0
- **NOVO: Modo JARVIS** — botao de microfone no chat (push-to-talk), STT 100% local via Whisper no LM Studio, TTS automatico do agente via `speechSynthesis`
- **Servidor de voz local** com endpoints `/voice-input` e `/transcribe`, protegidos por token bearer e bind seletivo (loopback ou rede)
- Preparado pra app mobile na mesma WiFi: token de pareamento UUID, header `Authorization`, IPs locais detectados automaticamente
- README com passo a passo completo de configuracao do Whisper no LM Studio (download, carregamento, id do modelo, teste)

### 0.9.1
- Texto parcial do streaming preservado quando o stream cai no meio (antes era descartado, mostrando so "Erro de conexao")
- 6 mensagens de erro especificas (rate limit, context too large, auth, timeout, conexao, server error) em vez da generica anterior
- ProjectIntel default reduzido de 40 → 20 arquivos (libera ~700 tokens em todo prompt)
- Novo toggle "ProjectIntel" na nova secao "Otimizacao de contexto" das configuracoes

### 0.9.0
- **3 novos servicos especializados** focados em sustentar tarefas longas com LLMs locais <= 10B:
  - `ProjectIntelService`: indice leve de simbolos exportados por arquivo do workspace, injetado no system prompt — agente encontra arquivos sem precisar ler todos
  - `ExecutionGuardService`: 6 guards de invariante centralizados (build pendente, arquivo errado, codigo no chat, etc), funcoes puras testaveis
  - `TaskDecomposerService`: detecta macro-tarefas, quebra em 2-8 sub-tarefas auto-contidas (com ajuda do pago), inclui step validation entre sub-tarefas
- **Slider de Intensidade HYBRID** (25/50/75/100%): usuario calibra quanto o LLM pago e invocado. Gating automatico por gatilho — 25% so usa pago em recovery critico, 100% usa em todos os gatilhos
- **AUTO mode mais resiliente**: cap aumentado de 5 para 15 tentativas, recovery via HYBRID em cada multiplo de 4 (4, 8, 12)
- ProjectIntel summary injetado em todo system prompt (skip em CHAT)

### 0.8.11
- AUTO + HYBRID mais robusto para tarefas de build/package: regras criticas no system prompt forcam sequencia read → edit → run_command → verify, sem editar duas vezes seguidas sem rodar build no meio
- Plano HYBRID inicial agora e mais conciso (3-7 steps, paths relativos, sob 200 palavras) — libera ~700 tokens a mais no contexto do modelo local
- Detector `buildPendingNoCommand`: se a tarefa pede build/package mas o modelo so editou sem rodar comando, nudge especifico orienta a executar `run_command` + verificar artefato no disco

### 0.8.6
- **NOVO: Modo CHAT** — toggle DEV/CHAT no novo dropdown "Modos" do header. Em CHAT o agente conversa livremente, sem acessar arquivos ou comandos. Util para perguntas gerais, brainstorming, analise de URL (com web_search se habilitado)
- Em CHAT: Auto e Hybrid sao automaticamente desligados (sem perder a preferencia do usuario — volta ao estado anterior em DEV)
- Tools de codigo escondidas em CHAT: so web_search disponivel
- Badge "CHAT" + borda lateral azul-violeta nas mensagens enviadas em modo CHAT
- Header reorganizado: botoes Hybrid e Auto agora ficam em um unico dropdown "Modos" com toggles individuais, indicador compacto do estado ativo
- BETA removido do botao Auto

### 0.8.4
- **NOVO: Memoria persistente por sessao** — `.eucode/memory/session_<id>.json` com stack detectado, comandos aprovados e decisoes; resumo injetado no system prompt + tools `memory_remember` / `memory_read`
- Comando `/lembrar <texto>` no chat para gravar notas manualmente
- Detecao automatica de stack (linguagens, frameworks, package manager) na primeira rodada da sessao
- Comandos "Permitir na sessao" agora persistem entre reloads
- **Reorganizacao:** todos os arquivos do plugin agora ficam em `.eucode/` na raiz do workspace (eucodeIgnore, eucode.json, memory/, .gitignore)
- Migracao automatica e silenciosa dos arquivos antigos (`.eucodeIgnore` e `eucode.json` na raiz) para dentro de `.eucode/` na primeira abertura do chat
- Notificacao com botao "Abrir pasta" quando arquivos antigos sao migrados
- `.eucode/.gitignore` criado automaticamente para manter `memory/` fora do versionamento
- Deletar uma sessao apaga o arquivo de memoria correspondente
- Botao "Abrir memoria da sessao atual" nas configuracoes

### 0.8.3
- Botao HYBRID do header agora respeita o master switch das configuracoes — desabilitado se HYBRID nao estiver ligado em Configuracoes
- Desativar HYBRID nas configs forca o botao do header para off automaticamente
- Tooltip e alerta orientam o usuario quando ele tenta usar o botao desabilitado

### 0.8.2
- **NOVO: Comandos personalizaveis** via `eucode.json` — atalhos `/comando` que expandem em prompts completos com AUTO/HYBRID opcionais
- Autocomplete inline ao digitar `/` no chat (setas ↑/↓ para navegar, Tab para aceitar)
- Escopo configuravel: `eucode.json` no workspace OU global em `~/.eucode/`
- Hot reload automatico quando o arquivo e editado
- Banner inline "Salvar como comando" aparece em prompts com 30+ palavras
- Dialog para criar comando com toggles individuais (nome, descricao, AUTO, HYBRID, escopo)
- Botao "Abrir eucode.json" na nova secao colapsavel "Comandos personalizaveis" do config

### 0.8.1
- **NOVO: Autocomplete inline** — sugestoes de codigo como texto fantasma cinza, aceita com Tab (estilo Copilot)
- **NOVO: Fix with Eucode** — Quick Fix em erros + item no menu de contexto para refatorar selecao
- Ambos seguem a logica HYBRID: local primeiro, suporte como fallback automatico
- Confirmacao do Fix com 3 botoes (Aplicar / Visualizar / Cancelar)
- Painel de config tem nova secao colapsavel "Recursos do Editor" com toggles individuais
- "Ferramentas disponiveis" tambem agora e colapsavel — painel mais limpo

### 0.8.0
- **NOVO: Modo HYBRID** — IA local + IA paga (Anthropic / OpenAI / Gemini) como suporte estrategico em momentos criticos
- 5 gatilhos: planejamento inicial, verificacao apos escrita, recuperacao de erro de comando/sintaxe, recuperacao quando o local trava
- Botao HYBRID no header e secao dedicada nas configuracoes
- Timeline com items de suporte cyan azul-neon alinhados a direita, com badge do provedor + motivo + meta
- Telemetria comparativa final: divisao Local x Suporte em 3 dimensoes (chamadas / tokens / tempo)

### 0.7.4
- Detector de arquivo errado em modo AUTO: agente para de "corrigir" o arquivo errado quando o erro aponta para outro
- Stack trace destacado nos nudges de erro: arquivos + mensagem extraidos da saida do comando
- Runtime errors em dev servers (TypeError, 500) detectados em processos long-running
- Botao "Tentar mais 5 vezes" quando o modo AUTO pausa
- Status visivel para retry de resposta vazia
- Status "Compactando contexto..." removido (ruido)
- Recomendacao de modelo premium no README: Ministral 3 14B Reasoning com requisitos por SO

### 0.7.3
- Todos os nomes de arquivo na timeline destacados em amarelo, nao apenas o primeiro

### 0.7.2
- Arquivos criados ou editados pelo agente abrem automaticamente em evidencia no editor
- Modo AUTO nao desiste mais ao receber erro de comando: continua corrigindo ate o build passar com exit code 0
- Detector de codigo dumped no chat: forca o modelo a salvar codigo via tool em vez de colar no chat
- edit_file mais tolerante: old_string vazio cria arquivo novo automaticamente; mensagens de erro didaticas guiam o modelo a se autocorrigir
- Hard timeout de 5 min em comandos: evita travamento do loop em comandos pendurados
- Loop guard de tool repetida: 3 chamadas identicas disparam correcao forcando mudanca de abordagem
- [AUTO PAUSADO] com diagnostico especifico quando o agente nao consegue concluir

### 0.7.1
- Modo AUTO: eliminado loop infinito de leitura repetida (modelo ficava relendo package.json indefinidamente)
- Modo AUTO: cache de leituras por round — read_local_file e list_directory retornam resultado cacheado sem custo de contexto
- Modo AUTO: verificacao de erros do editor apos resposta final — se o modelo escrever arquivo com erro de sintaxe, o loop continua automaticamente ate corrigir
- Modo AUTO: warnings do editor ignorados — somente erros reais ([ERROR]) bloqueiam o loop; warnings de schema do VS Code nao causam mais travamento
- Modo AUTO: modelo que planeja sem agir e forcado a executar imediatamente
- Telemetria ao vivo durante streaming: contador de tokens e tokens/s atualizados em tempo real na timeline

### 0.7.0
- Suporte a RAG opcional via Chroma — banco vetorial local configuravel nas settings
- `.eucodeIgnore`: arquivo de filtro gitignore-style para excluir arquivos/pastas do contexto do agente
- Telemetria de desempenho na timeline: tokens/s, prompt tokens e tempo total de resposta
- Distincao entre erro de infraestrutura (OOM, conexao) e contexto cheio — recuperacao automatica sem mensagem de erro para o usuario

### 0.6.3
- Timeline persistente: texto do LM permanece visivel ao iniciar nova tool call e ao finalizar a tarefa
- Recuperacao automatica de contexto: poda progressiva e retry silencioso quando o modelo retorna resposta vazia
- Notificacao nativa do macOS quando o VS Code nao esta em foco
- Timeline colorida por resultado: verde (sucesso), vermelho (erro), amarelo no nome do arquivo

### 0.6.2
- Timeline colorida por tipo de acao: leituras, escritas e comandos com cores distintas
- Classificacao automatica pelo prefixo do status

### 0.6.1
- Suporte nativo a API Anthropic (Claude) com streaming SSE
- Streaming de respostas em tempo real para todos os provedores
- Controle granular de ferramentas com toggles por ferramenta
- Modelos Claude sugeridos como chips clicaveis no config

---

Historico completo de versoes em [CHANGELOG.md](CHANGELOG.md).

---

## Licenca

MIT
