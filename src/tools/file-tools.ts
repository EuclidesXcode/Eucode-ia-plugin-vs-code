import * as fs from 'fs';
import * as path from 'path';
import { BINARY_EXTS } from '../utils/constants';
import { validateFilePath, resolveFilePath } from '../utils/validation';
import { isIgnored } from '../utils/ignore';

export type EditFileResult = { ok: true; summary: string } | { ok: false; error: string };

export async function listDirectory(dirPath: string, workspaceRoot?: string): Promise<string> {
    try {
        const fullPath = path.resolve(dirPath);
        const root = workspaceRoot || fullPath;
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const lines: string[] = [];
        for (const entry of entries) {
            const relPath = path.relative(root, path.join(fullPath, entry.name));
            if (isIgnored(entry.name, relPath, root)) { continue; }
            if (entry.isDirectory()) {
                lines.push(`${entry.name}/`);
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (!BINARY_EXTS.has(ext)) {
                    lines.push(entry.name);
                }
            }
        }
        return lines.length > 0 ? lines.join('\n') : '(pasta vazia)';
    } catch (e) {
        return `[ERRO] Nao foi possivel listar ${dirPath}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function readLocalFile(filePath: string, workspaceRoot?: string): Promise<string> {
    try {
        const fullPath = resolveFilePath(filePath, workspaceRoot);
        return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        return `[ERRO] Nao foi possivel ler ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function editLocalFile(
    filePath: string,
    oldString: string,
    newString: string,
    workspaceRoot?: string
): Promise<string> {
    const fullPath = resolveFilePath(filePath, workspaceRoot);
    let current: string;
    try {
        current = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        return `[ERRO] Nao foi possivel ler "${filePath}": ${e instanceof Error ? e.message : String(e)}`;
    }

    const count = current.split(oldString).length - 1;
    if (count === 0) {
        return `[ERROR] old_string was not found in "${path.basename(filePath)}". Check that the text is exact (spaces, line breaks, special characters).`;
    }
    if (count > 1) {
        return `[ERROR] old_string appears ${count} times in "${path.basename(filePath)}". Provide a more specific and unique string.`;
    }

    const updated = current.replace(oldString, newString);
    try {
        fs.writeFileSync(fullPath, updated, 'utf8');
        const oldLines = oldString.split('\n').length;
        const newLines = newString.split('\n').length;
        return `[OK] "${path.basename(filePath)}" edited: -${oldLines} line(s), +${newLines} line(s).`;
    } catch (e) {
        return `[ERRO] Falha ao gravar "${fullPath}": ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function writeLocalFile(filePath: string, content: string, workspaceRoot?: string): Promise<string> {
    const validation = validateFilePath(filePath, workspaceRoot);
    if (!validation.ok) { return `[ERRO] ${validation.error}`; }

    const fullPath = resolveFilePath(filePath, workspaceRoot);
    try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        return `[OK] Arquivo gravado: ${fullPath}`;
    } catch (e) {
        return `[ERRO] Falha ao gravar "${fullPath}": ${e instanceof Error ? e.message : String(e)}`;
    }
}
