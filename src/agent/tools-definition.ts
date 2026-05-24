import { ToolDefinition } from '../services/api-client';

export const TOOLS: ToolDefinition[] = [
    {
        name: 'list_directory',
        description: 'Lista arquivos e subpastas de um diretorio. Use para mapear a estrutura antes de ler arquivos.',
        parameters: {
            type: 'object',
            properties: {
                dirPath: { type: 'string', description: 'Caminho absoluto do diretorio.' },
            },
            required: ['dirPath'],
        },
    },
    {
        name: 'read_local_file',
        description: 'Le o conteudo completo de um arquivo. Use apos identificar o arquivo via list_directory ou search_in_workspace.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Caminho absoluto do arquivo.' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'search_in_workspace',
        description: 'Busca um termo, funcao, classe ou variavel nos arquivos do workspace. Retorna arquivos e linhas que contem o termo. Use antes de ler arquivos inteiros.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Termo a buscar, ex: "class AuthService" ou "useState".' },
                dirPath: { type: 'string', description: 'Diretorio onde buscar. Se omitido, usa a pasta raiz do workspace.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'write_local_file',
        description: 'Cria ou sobrescreve um arquivo com o conteudo fornecido. Sempre use caminho absoluto.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Caminho absoluto do arquivo, ex: /Users/dev/projeto/src/index.ts' },
                content: { type: 'string', description: 'Conteudo completo do arquivo.' },
            },
            required: ['filePath', 'content'],
        },
    },
    {
        name: 'run_command',
        description: 'Executa um comando no terminal. Use para compilar, instalar dependencias, rodar testes ou scripts.',
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

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
