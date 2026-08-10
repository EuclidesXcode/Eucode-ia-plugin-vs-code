import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { searchInWorkspace } from '../../src/tools/shell-tools';

describe('searchInWorkspace', () => {
  it('searches source files without requiring a Unix shell', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eucode-search-'));
    const filePath = path.join(root, 'sample.ts');
    fs.writeFileSync(filePath, 'export const targetSymbol = true;\n', 'utf8');

    const result = await searchInWorkspace('targetSymbol', root);

    expect(result).toContain(filePath);
    expect(result).toContain('targetSymbol');
  });
});
