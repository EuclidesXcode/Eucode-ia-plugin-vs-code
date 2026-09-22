import { buildMessagesFromHistory, buildHistorySummary, HistoryEntry } from '../../src/services/history-service';

// Regression coverage for a real degenerate-repetition loop: [CONTINUE_BUTTON]
// is a UI-only sentinel (the webview uses it to render the "Continuar"
// button and always strips it before display) with zero conversational
// meaning. If it leaks into the history that gets replayed back into the
// model's own context, a small local model that sees its own prior turn
// ending in that token tends to imitate it — producing an infinite loop of
// the same sentence + "[CONTINUE_BUTTON]" until the step budget runs out.
describe('history sentinel stripping', () => {
  const entry = (role: 'user' | 'assistant', content: string): HistoryEntry => ({ role, content, timestamp: Date.now() });

  it('buildMessagesFromHistory strips a trailing [CONTINUE_BUTTON] sentinel', () => {
    const entries = [
      entry('user', 'continue a tarefa'),
      entry('assistant', 'Rodei o build com sucesso.\n\n[CONTINUE_BUTTON]'),
    ];
    const messages = buildMessagesFromHistory(entries, 5);
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Rodei o build com sucesso.');
    expect(assistantMsg?.content).not.toContain('CONTINUE_BUTTON');
  });

  it('buildHistorySummary strips the sentinel too', () => {
    const entries = [entry('assistant', 'Rodei o build.\n\n[CONTINUE_BUTTON]')];
    const summary = buildHistorySummary(entries);
    expect(summary).not.toContain('CONTINUE_BUTTON');
  });

  it('leaves normal assistant text untouched', () => {
    const entries = [entry('assistant', 'Arquivo atualizado com sucesso.')];
    const messages = buildMessagesFromHistory(entries, 5);
    expect(messages[0].content).toBe('Arquivo atualizado com sucesso.');
  });
});
