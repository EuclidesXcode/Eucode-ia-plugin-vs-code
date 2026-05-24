import * as path from 'path';
import * as fs from 'fs';

export interface ValidationResult {
    ok: boolean;
    error?: string;
}

export function validateFilePath(filePath: string, workspaceRoot?: string): ValidationResult {
    if (!filePath || filePath.trim() === '') {
        const hint = workspaceRoot ?? '/tmp';
        return { ok: false, error: `filePath vazio. Use um caminho absoluto, ex: ${hint}/nome.ts` };
    }

    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot ?? '/tmp', filePath);

    if (!path.extname(fullPath)) {
        return {
            ok: false,
            error: `filePath sem extensao — parece ser um diretorio: "${fullPath}". Informe o nome completo incluindo extensao, ex: ${fullPath}/index.ts`,
        };
    }

    try {
        if (fs.statSync(fullPath).isDirectory()) {
            return {
                ok: false,
                error: `"${fullPath}" e um diretorio. Informe o nome completo do arquivo, ex: ${fullPath}/index.ts`,
            };
        }
    } catch {
        // path does not exist yet — valid for writes
    }

    return { ok: true };
}

export function resolveFilePath(filePath: string, workspaceRoot?: string): string {
    return path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot ?? '/tmp', filePath);
}

export function isToolArgString(value: unknown, name: string): ValidationResult {
    if (typeof value !== 'string' || value.trim() === '') {
        return { ok: false, error: `Argumento "${name}" deve ser uma string nao vazia.` };
    }
    return { ok: true };
}
