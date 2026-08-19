import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { searchInWorkspace, buildCommandEnv } from '../../src/tools/shell-tools';

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

// Regression coverage: a VS Code opened from Finder/Dock (not from a
// terminal) inherits the OS's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// which doesn't include Homebrew/nvm/pyenv — those only get added by
// .zshrc/.zprofile, which a GUI-launched app never sources. Without fixing
// this, run_command "loses" node/npx/npm even though they work fine in a
// normal terminal. buildCommandEnv() must always widen the PATH it hands to
// spawned commands (COMMON_BIN_DIRS is appended unconditionally), never
// just pass process.env.PATH through untouched.
describe('command PATH resolution (GUI-launched VS Code has a minimal PATH)', () => {
  it('always includes common Homebrew/local bin dirs, even on a minimal PATH', async () => {
    if (process.platform === 'win32') { return; } // fix is macOS/Linux-only by design
    const env = await buildCommandEnv();
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.PATH).toContain('/usr/local/bin');
  });
});
