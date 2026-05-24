import * as fs from 'fs';
import * as path from 'path';
import { BINARY_EXTS, IGNORED_DIRS } from '../utils/constants';
import { validateFilePath, resolveFilePath } from '../utils/validation';

export async function listDirectory(dirPath: string): Promise<string> {
    try {
        const fullPath = path.resolve(dirPath);
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const lines: string[] = [];
        for (const entry of entries) {
            if (IGNORED_DIRS.has(entry.name)) { continue; }
            if (entry.isDirectory()) {
                lines.push(`${entry.name}/`);
            } else if (!BINARY_EXTS.has(path.extname(entry.name).toLowerCase())) {
                lines.push(entry.name);
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
