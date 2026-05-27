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

---

## Ultimas versoes

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
