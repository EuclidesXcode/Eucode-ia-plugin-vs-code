# Eucode IA

Agente de inteligencia artificial para engenharia de software, integrado diretamente ao VS Code. Conecta-se a modelos de linguagem rodando localmente via [LM Studio](https://lmstudio.ai), sem enviar nenhum dado para servidores externos.


---

## O que faz

O Eucode IA e um agente autonomo com acesso ao seu workspace. Ele nao apenas responde perguntas — ele age: le arquivos, busca simbolos, cria e edita codigo, executa comandos e mantem contexto entre sessoes.

- **Le e edita arquivos** do seu projeto diretamente, sem copiar e colar
- **Busca no workspace** por funcoes, classes, variaveis e padroes
- **Executa comandos** no terminal (build, testes, instalacao de dependencias)
- **Analisa imagens** — screenshots, diagramas, wireframes
- **Historico persistente** entre sessoes, sem perder o contexto do que foi discutido
- **100% local** — seus dados nunca saem da sua maquina

---

## Requisitos

- [LM Studio](https://lmstudio.ai) instalado e rodando com um modelo carregado
- O servidor local do LM Studio ativado (porta `1234` por padrao)
- VS Code 1.87 ou superior

O plugin foi desenvolvido e testado com o modelo **google/gemma-4-e4b** no LM Studio, mas funciona com qualquer modelo compativel com a API OpenAI (formato `/v1/chat/completions`) que suporte tool calling.

---

## Instalacao

1. Instale a extensao pelo marketplace do VS Code
2. Abra o LM Studio, carregue um modelo e ative o servidor local
3. No VS Code, abra a paleta de comandos (`Cmd+Shift+P` / `Ctrl+Shift+P`)
4. Digite **Eucode IA: Abrir Chat** e pressione Enter

---

## Como usar

### Chat de texto

Digite sua pergunta ou instrucao no campo de texto e pressione **Enter** ou clique em **Enviar**.

O agente trabalha em multiplos passos: ele pode listar diretorios, ler arquivos relevantes, buscar por simbolos e criar ou modificar arquivos — tudo de forma autonoma, mostrando o que esta fazendo em tempo real.

**Exemplos do que voce pode pedir:**

```
Quais projetos existem nesse workspace e quais tecnologias cada um usa?
```

```
Crie um arquivo de configuracao do ESLint para TypeScript nesse projeto.
```

```
Tem algum memory leak no codigo de gerenciamento de eventos? Analise e corrija.
```

```
Adicione tratamento de erro em todas as chamadas fetch do projeto.
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

### Configuracao do host

Clique no icone de engrenagem no canto superior direito para configurar o endereco do servidor da IA. Util quando:

- Voce usa uma porta diferente da padrao
- O modelo roda em outra maquina da rede local
- Voce acessa o servidor via VPN

O endereco e salvo automaticamente e persiste entre sessoes.

---

## Requisitos de Rede (LM Studio Distribuído)

**Cenário:** Você deseja rodar o LM Studio em uma máquina na rede e usar o Eucode IA no VS Code em outra máquina.
**Ação Necessária:** No LM Studio, navegue até **Server Settings** e habilite a opção **"Servir na Rede Local"**. Isso exporá a API para outros dispositivos na mesma rede.

---

## Capacidades do agente

O agente tem acesso a cinco ferramentas que usa de forma autonoma conforme necessario:

| Ferramenta | O que faz |
|---|---|
| `list_directory` | Lista arquivos e pastas, ignorando diretorios de build e dependencias |
| `read_local_file` | Le o conteudo completo de qualquer arquivo do workspace |
| `search_in_workspace` | Busca termos, funcoes e classes em todos os arquivos de codigo |
| `write_local_file` | Cria ou sobrescreve arquivos com o conteudo gerado |
| `run_command` | Executa comandos no terminal com lista de comandos permitidos |

O agente executa ate 15 passos por resposta, o suficiente para tarefas complexas como refatorar multiplos arquivos ou configurar um projeto do zero.

---

## Seguranca

O plugin roda inteiramente na sua maquina. Nenhuma informacao do seu codigo, historico ou workspace e transmitida para servidores externos.

Os comandos de terminal sao restritos a uma lista de prefixos permitidos (`node`, `npm`, `npx`, `yarn`, `tsc`, `git`, `grep`, `find`, entre outros). Comandos destrutivos como `rm -rf`, `sudo`, formatacao de disco e pipes remotos sao bloqueados por padrao.

---

## Historico e contexto

O historico das conversas e salvo em `~/.eucode-ia-history.json` (ate 60 entradas). Isso permite que o agente mantenha contexto entre sessoes — voce pode retomar uma conversa de onde parou, mesmo depois de fechar e reabrir o VS Code.

Imagens enviadas sao armazenadas apenas como resumo textual no historico, sem guardar os dados binarios.

---

## Configuracao avancada

Por padrao o plugin conecta em `http://localhost:1234`. Para alterar, clique na engrenagem no chat ou edite diretamente pelo painel de configuracoes — o endereco e persistido via `globalState` do VS Code.

---

## Nota da versao (0.3.0)

- Diff estilo VS Code no card de aprovacao: algoritmo Myers com diff real linha a linha, numeros de linha antes/depois em colunas separadas, contexto de 3 linhas ao redor das alteracoes e separador de hunk entre blocos distantes
- Syntax highlight no diff com as cores exatas do tema VS Code dark (keywords, strings, comentarios, tipos)
- Agente sempre escreve o arquivo diretamente via ferramenta — nunca mais exibe codigo no chat pedindo para o usuario aplicar manualmente
- Respostas sem raciocinio interno exposto: analises, estrategias e propostas proativas removidas das respostas
- Terminal em tempo real com bloco fixo e status-bar fora do scroll, eliminando quebra de layout

## Nota da versao (0.2.9)

- Terminal em tempo real no chat: saida aparece linha a linha diretamente no chat via streaming com `spawn`
- Bloco de terminal com estilo proprio (fundo escuro, texto claro) separado visualmente da resposta do agente
- Agente auto-continua quando detecta que o modelo anunciou uma acao sem executar ("vou criar", "agora vou", etc.)

## Nota da versao (0.2.8)

- Campo **Modelo** no painel de configuracoes: o usuario especifica o nome exato do modelo carregado (ex: `google/gemma-4-e4b`, `qwen2.5-coder:14b`, `llama3.1:8b`)
- Se o campo ficar vazio, o servidor usa o modelo padrao que estiver carregado
- Modelo configuravel funciona com LM Studio, Ollama e qualquer provedor OpenAI-compativel

---

Historico completo de versoes em [CHANGELOG.md](CHANGELOG.md).

---

## Licenca

MIT