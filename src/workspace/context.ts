import * as vscode from 'vscode';
import * as path from 'path';
import { BINARY_EXTS } from '../utils/constants';

export interface WorkspaceContext {
    roots: string[];
    openFiles: { name: string; path: string }[];
    contextBlock: string;
}

export function collectWorkspaceContext(): WorkspaceContext {
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const openFiles: { name: string; path: string }[] = [];

    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const uri = (tab.input as any)?.uri as vscode.Uri | undefined;
            if (!uri) { continue; }
            if (BINARY_EXTS.has(path.extname(uri.fsPath).toLowerCase())) { continue; }
            openFiles.push({
                name: path.basename(uri.fsPath),
                path: vscode.workspace.asRelativePath(uri.fsPath),
            });
        }
    }

    const defaultRoot = roots[0] ?? '/tmp';
    let contextBlock = `# WORKSPACE\nPastas raiz: ${roots.join(', ')}\n`;
    if (openFiles.length > 0) {
        contextBlock += `Arquivos abertos: ${openFiles.map(f => f.path).join(', ')}\n`;
    }
    contextBlock += `\nRegras para criar/editar arquivos:\n- Sempre use caminhos ABSOLUTOS no filePath, ex: ${defaultRoot}/nome.ts\n- Nunca use caminhos relativos ou vazios.\n- Para entender a estrutura: use list_directory, read_local_file, search_in_workspace.`;

    return { roots, openFiles, contextBlock };
}

export function getDefaultCwd(roots: string[]): string {
    return roots.find(r => r !== '/') ?? roots[0] ?? '/tmp';
}
