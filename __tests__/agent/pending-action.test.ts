import { detectsPendingAction } from '../../src/agent/pending-action';

// Regression coverage for a real "described but didn't execute" miss in AUTO
// mode: the model wrote a narrated plan ("Chame `run_command` para instalar
// as dependências.") instead of actually calling the tool, and the agent
// returned that text straight to the user as if the task were done — no
// corrective nudge, no retry. The gap was twofold: (1) PENDING_ACTION_PATTERNS
// only covered first-person future tense ("vou X"), not the model giving
// itself an imperative instruction ("Chame X"); (2) "vou começar" wasn't in
// the list either. Both are now covered.
describe('detectsPendingAction', () => {
  it('catches the exact narrated-but-not-executed text from the reported bug', () => {
    const text = 'Entendido. Vou começar a transformar o projeto em um front Next.js com a tela de login estilizada com MUI. Primeiro, vamos instalar as dependências necessárias para o Next.js e MUI.\n\nChame `run_command` para instalar as dependências.';
    expect(detectsPendingAction(text, true)).toBe(true);
  });

  it('catches imperative self-instruction in Portuguese', () => {
    expect(detectsPendingAction('Chame a ferramenta run_command agora.', true)).toBe(true);
    expect(detectsPendingAction('Execute o comando de build para verificar.', true)).toBe(true);
    expect(detectsPendingAction('Rode o comando npm install.', true)).toBe(true);
  });

  it('catches imperative self-instruction in English', () => {
    expect(detectsPendingAction('Call the tool to install dependencies.', true)).toBe(true);
    expect(detectsPendingAction('Invoke the function run_command now.', true)).toBe(true);
  });

  it('catches "vou começar" (previously missing from the pattern list)', () => {
    expect(detectsPendingAction('Vou começar agora.', true)).toBe(true);
  });

  it('does not flag a plain final answer with no action language', () => {
    const text = 'O projeto ja tem as dependencias do Next.js instaladas e a tela de login em src/Login.tsx usa Material UI conforme pedido.';
    expect(detectsPendingAction(text, true)).toBe(false);
  });

  // Regression coverage for a real bug: the model claimed it had already
  // pushed the project to GitHub ("subiu o projeto") in a round where
  // run_git wasn't even offered as a tool (hidden by the phase-gating
  // heuristic, which didn't recognize "GitHub"/"subir" as git-relevant
  // keywords) — a hallucinated success claim with zero tool call behind it.
  it('catches a false claim of having pushed/uploaded to GitHub', () => {
    expect(detectsPendingAction('Consegui, subi o projeto para o repositorio com sucesso.', true)).toBe(true);
    expect(detectsPendingAction('Enviei o codigo para o GitHub.', true)).toBe(true);
    expect(detectsPendingAction('Publiquei o repositorio no GitHub.', true)).toBe(true);
    expect(detectsPendingAction('Fiz o push das alteracoes.', true)).toBe(true);
  });
});
