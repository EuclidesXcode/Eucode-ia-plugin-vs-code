import { classifyCommandRisk } from '../../src/tools/command-safety';

describe('command safety guard', () => {
  it('allows ordinary safe commands', () => {
    expect(classifyCommandRisk('npm test')).toEqual({ risk: 'safe' });
  });

  it('marks destructive project commands as dangerous', () => {
    expect(classifyCommandRisk('git reset --hard').risk).toBe('dangerous');
    expect(classifyCommandRisk('Remove-Item -Recurse ./tmp').risk).toBe('dangerous');
  });

  it('blocks commands that can affect the machine irreversibly', () => {
    expect(classifyCommandRisk('rm -rf /').risk).toBe('blocked');
    expect(classifyCommandRisk('format C:').risk).toBe('blocked');
    expect(classifyCommandRisk('shutdown /s').risk).toBe('blocked');
  });
});
