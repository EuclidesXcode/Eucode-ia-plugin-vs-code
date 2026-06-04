export type CommandRisk = 'safe' | 'dangerous' | 'blocked';

export interface CommandSafetyResult {
    risk: CommandRisk;
    reason?: string;
}

const BLOCKED_COMMANDS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brm\s+-[^\n]*r[^\n]*f[^\n]*(?:\/|~)(?:\s|$)/i, reason: 'pode apagar diretorios raiz ou home.' },
    { pattern: /\bdel\s+\/f\s+\/s\s+\/q\s+[a-zA-Z]:\\?(?:\s|$)/i, reason: 'pode apagar arquivos de uma unidade inteira.' },
    { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'pode formatar uma unidade de disco.' },
    { pattern: /\bshutdown\b/i, reason: 'pode desligar o sistema.' },
    { pattern: /\breboot\b/i, reason: 'pode reiniciar o sistema.' },
    { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: 'parece uma fork bomb.' },
];

const DANGEROUS_COMMANDS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\brm\s+-[^\n]*r[^\n]*f\b/i, reason: 'remove arquivos recursivamente e sem confirmacao.' },
    { pattern: /\bdel\s+\/s\b/i, reason: 'remove arquivos recursivamente no Windows.' },
    { pattern: /\brmdir\s+\/s\b/i, reason: 'remove diretorios recursivamente no Windows.' },
    { pattern: /\bRemove-Item\b[\s\S]*-Recurse\b/i, reason: 'remove itens recursivamente no PowerShell.' },
    { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'descarta alteracoes locais do Git.' },
    { pattern: /\bgit\s+clean\s+-[^\n]*[fd][^\n]*\b/i, reason: 'remove arquivos nao rastreados pelo Git.' },
    { pattern: /\b(?:npm|pnpm|yarn)\s+publish\b/i, reason: 'publica pacote em registro externo.' },
    { pattern: /\bsudo\b/i, reason: 'executa comando com privilegios elevados.' },
    { pattern: /\bcurl\b[\s\S]*\|\s*(?:bash|sh|zsh|powershell|pwsh)\b/i, reason: 'baixa e executa script remoto.' },
    { pattern: /\bwget\b[\s\S]*\|\s*(?:bash|sh|zsh|powershell|pwsh)\b/i, reason: 'baixa e executa script remoto.' },
    { pattern: /\bchmod\s+-R\s+777\b/i, reason: 'altera permissoes recursivamente de forma insegura.' },
];

export function classifyCommandRisk(command: string): CommandSafetyResult {
    const trimmed = command.trim();

    for (const rule of BLOCKED_COMMANDS) {
        if (rule.pattern.test(trimmed)) {
            return { risk: 'blocked', reason: rule.reason };
        }
    }

    for (const rule of DANGEROUS_COMMANDS) {
        if (rule.pattern.test(trimmed)) {
            return { risk: 'dangerous', reason: rule.reason };
        }
    }

    return { risk: 'safe' };
}

export function validateCommandSafety(command: string): CommandSafetyResult {
    return classifyCommandRisk(command);
}
