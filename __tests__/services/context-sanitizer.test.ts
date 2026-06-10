import { ContextSanitizer } from '../../src/services/context-sanitizer';

describe('ContextSanitizer', () => {
    const s = new ContextSanitizer();

    describe('stripGenericNoise', () => {
        it('removes ANSI escape codes', () => {
            const raw = '\x1b[31mFAIL\x1b[0m test/foo.ts\x1b[1m bold\x1b[0m';
            const out = s.stripGenericNoise(raw, 'light');
            expect(out).not.toMatch(/\x1b\[/);
            expect(out).toContain('FAIL test/foo.ts');
        });

        it('collapses multiple blank lines into one', () => {
            const raw = 'a\n\n\n\n\nb';
            expect(s.stripGenericNoise(raw, 'light')).toBe('a\n\nb');
        });

        it('strips trailing whitespace', () => {
            const raw = 'line one   \nline two\t';
            expect(s.stripGenericNoise(raw, 'light')).toBe('line one\nline two');
        });

        it('trims leading/trailing blank lines', () => {
            const raw = '\n\nhello\n\n';
            expect(s.stripGenericNoise(raw, 'light')).toBe('hello');
        });

        it('drops progress noise only in aggressive mode', () => {
            const raw = 'npm WARN deprecated foo@1.0.0\nbuilding...\nDone';
            expect(s.stripGenericNoise(raw, 'light')).toContain('npm WARN deprecated');
            expect(s.stripGenericNoise(raw, 'aggressive')).not.toContain('npm WARN deprecated');
        });

        it('collapses consecutive identical lines in aggressive mode', () => {
            const raw = 'tick\ntick\ntick\ndone';
            expect(s.stripGenericNoise(raw, 'aggressive')).toBe('tick\ndone');
        });
    });

    describe('cleanCommandOutput', () => {
        it('preserves error lines and the tail when output is large (aggressive)', () => {
            const filler = Array.from({ length: 60 }, (_, i) => `info line ${i}`).join('\n');
            const raw = `${filler}\nError: cannot find module 'x'\n${Array.from({ length: 20 }, (_, i) => `more ${i}`).join('\n')}\nTests: 1 failed`;
            const out = s.cleanCommandOutput(raw, 'aggressive');
            expect(out).toContain("Error: cannot find module 'x'");
            expect(out).toContain('Tests: 1 failed'); // tail preserved
        });

        it('keeps the tail (conclusion) when there are no errors', () => {
            const raw = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
            const out = s.cleanCommandOutput(raw, 'aggressive');
            expect(out).toContain('line 79');
            expect(out).toContain('...[inicio omitido]');
        });

        it('is a no-op in light mode', () => {
            const raw = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
            expect(s.cleanCommandOutput(raw, 'light')).toBe(raw);
        });
    });

    describe('cleanGitOutput', () => {
        it('drops unchanged context lines from a diff', () => {
            const diff = [
                'diff --git a/foo.ts b/foo.ts',
                '@@ -1,5 +1,5 @@',
                ' unchanged 1',
                ' unchanged 2',
                '-old line',
                '+new line',
                ' unchanged 3',
            ].join('\n');
            const out = s.cleanGitOutput(diff);
            expect(out).toContain('-old line');
            expect(out).toContain('+new line');
            expect(out).toContain('@@ -1,5 +1,5 @@');
            expect(out).not.toContain('unchanged 1');
            expect(out).toMatch(/linhas de contexto/);
        });

        it('leaves non-diff git output untouched', () => {
            const status = 'On branch main\nnothing to commit, working tree clean';
            expect(s.cleanGitOutput(status)).toBe(status);
        });
    });

    describe('cleanSearchOutput', () => {
        it('deduplicates identical match lines preserving order', () => {
            const raw = 'foo.ts:1: match\nbar.ts:2: match\nfoo.ts:1: match';
            expect(s.cleanSearchOutput(raw)).toBe('foo.ts:1: match\nbar.ts:2: match');
        });
    });

    describe('truncate', () => {
        it('keeps head and tail when over the limit', () => {
            const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
            const out = s.truncate('run_command', text, 'light');
            expect(out.length).toBeLessThan(text.length);
            expect(out).toContain('line 0');
            expect(out).toContain('line 499'); // tail survives
            expect(out).toMatch(/omitidos para economizar contexto/);
        });

        it('returns text unchanged when under the limit', () => {
            const text = 'short output';
            expect(s.truncate('run_command', text, 'light')).toBe(text);
        });

        it('uses a tighter limit in aggressive mode', () => {
            expect(s.limitFor('read_local_file', 'aggressive'))
                .toBeLessThan(s.limitFor('read_local_file', 'light'));
        });
    });

    describe('clean (entry point)', () => {
        it('returns short status markers untouched', () => {
            expect(s.clean('write_local_file', '[OK] Arquivo gravado: /x.ts')).toBe('[OK] Arquivo gravado: /x.ts');
        });

        it('selects aggressive mode from autoMode flag', () => {
            const raw = 'tick\ntick\ntick\nresult';
            expect(s.clean('run_command', raw, { autoMode: true })).not.toContain('tick\ntick');
        });

        it('keeps full noise in light (manual) mode', () => {
            const raw = 'npm WARN deprecated foo\nok';
            expect(s.clean('run_command', raw, { autoMode: false })).toContain('npm WARN deprecated');
        });

        it('handles empty input', () => {
            expect(s.clean('run_command', '')).toBe('');
        });
    });
});
