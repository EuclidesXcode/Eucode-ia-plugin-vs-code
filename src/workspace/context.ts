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

    const validRoots = roots.filter(r => r !== '/' && r !== 'C:\\' && r.length > 3);
    const defaultRoot = validRoots[0] ?? roots[0] ?? '/tmp';
    let contextBlock = '';

    if (validRoots.length === 0) {
        contextBlock = `# WORKSPACE\nNo project open in VS Code. Tell the user they need to open a project folder (File > Open Folder) before continuing.`;
    } else {
        contextBlock = `# WORKSPACE\nRoot folders: ${validRoots.join(', ')}\n`;
        if (openFiles.length > 0) {
            contextBlock += `Open files: ${openFiles.map(f => f.path).join(', ')}\n`;
        }
        contextBlock += `\nRules for creating/editing files:\n- Always use ABSOLUTE paths in filePath, e.g.: ${defaultRoot}/name.ts\n- Never use relative or empty paths.\n- To understand the structure: use list_directory, read_local_file, search_in_workspace.`;
    }

    return { roots, openFiles, contextBlock };
}

export function getDefaultCwd(roots: string[]): string {
    const valid = roots.filter(r => r !== '/' && r !== 'C:\\' && r.length > 3);
    return valid[0] ?? roots[0] ?? '/tmp';
}

export function collectDiagnostics(): string {
    const all = vscode.languages.getDiagnostics();
    const lines: string[] = [];

    for (const [uri, diags] of all) {
        const rel = vscode.workspace.asRelativePath(uri.fsPath);
        for (const d of diags) {
            if (d.severity !== vscode.DiagnosticSeverity.Error && d.severity !== vscode.DiagnosticSeverity.Warning) {
                continue;
            }
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
            const line = d.range.start.line + 1;
            const col = d.range.start.character + 1;
            lines.push(`[${sev}] ${rel}:${line}:${col} — ${d.message}`);
            if (lines.length >= 30) { break; }
        }
        if (lines.length >= 30) { break; }
    }

    if (lines.length === 0) { return ''; }
    return `# EDITOR DIAGNOSTICS\n${lines.join('\n')}`;
}
