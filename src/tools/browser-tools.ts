// IMPORTANTE: 'playwright' e carregado LAZY (via require dentro de launch()),
// nao com import estatico. Playwright + browsers pesam centenas de MB e nao vao
// no .vsix — so quem for usar browser_action instala. Um import estatico
// quebraria a extensao inteira quando o pacote nao estivesse presente. Aqui so
// importamos os TIPOS (apagados na compilacao, sem efeito em runtime).
import type { Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { pathToFileURL } from 'url';

// Carrega o Playwright sob demanda. Como o pacote NAO vai no .vsix (fica em
// devDependencies), tentamos resolver de varios lugares: (1) o node_modules do
// proprio plugin — util em dev; (2) a instalacao GLOBAL do npm do usuario, que
// e onde 'npm i -g playwright' coloca. Retorna null se nada resolver, para
// browser_action responder com instrucao de instalacao em vez de crashar.
function loadPlaywright(): typeof import('playwright') | null {
    // 1) resolucao padrao (node_modules local / dev)
    try { return require('playwright'); } catch { /* tenta global */ }
    // 2) resolucao global: descobre o prefixo do npm e monta o caminho.
    try {
        const { execSync } = require('child_process');
        const globalRoot = String(execSync('npm root -g', { encoding: 'utf8' })).trim();
        if (globalRoot) {
            return require(path.join(globalRoot, 'playwright'));
        }
    } catch { /* sem global tambem */ }
    return null;
}

const PLAYWRIGHT_MISSING_MSG =
    '[ERRO] O controle de navegador (browser_action) precisa do Playwright, que nao esta instalado. '
    + 'Instale uma vez com:\n\n  npm i -g playwright && npx playwright install\n\n'
    + 'ou, no projeto:\n\n  npm i playwright && npx playwright install\n\n'
    + 'Depois tente novamente.';

interface ConsoleEntry {
    type: string;
    text: string;
    location?: string;
}

interface NetworkEntry {
    method: string;
    url: string;
    status?: number;
    statusText?: string;
    resourceType?: string;
}

interface RecordedAction {
    action: string;
    params: Record<string, any>;
}

export interface BrowserActionParams {
    url?: string;
    selector?: string;
    text?: string;
    script?: string;
    attribute?: string;
    value?: string;
    key?: string;
    direction?: 'up' | 'down';
    amount?: number;
    timeoutMs?: number;
    urlContains?: string;
    method?: string;
    statusMin?: number;
    statusMax?: number;
    testName?: string;
    outputPath?: string;
}

class BrowserManager {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private consoleLogs: ConsoleEntry[] = [];
    private networkLog: NetworkEntry[] = [];
    private recordedActions: RecordedAction[] = [];
    private currentBrowserType: 'chromium' | 'webkit' = 'chromium';

    private getActivePage(): Page | null {
        if (!this.page || this.page.isClosed()) {
            return null;
        }
        return this.page;
    }

    private formatNetworkEntry(entry: NetworkEntry): string {
        const status = entry.status ?? 'pendente';
        const statusText = entry.statusText ? ` ${entry.statusText}` : '';
        const resourceType = entry.resourceType ? ` [${entry.resourceType}]` : '';
        return `${entry.method} ${entry.url} -> ${status}${statusText}${resourceType}`;
    }

    private normalizeUrl(rawUrl: string): string {
        const trimmed = rawUrl.trim();
        if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
            return pathToFileURL(trimmed).href;
        }
        return trimmed;
    }

    async launch(browserType: 'chromium' | 'webkit' = 'chromium'): Promise<Page> {
        if (this.browser && this.currentBrowserType !== browserType) {
            await this.close();
        }
        if (!this.browser || !this.browser.isConnected()) {
            const pw = loadPlaywright();
            if (!pw) { throw new Error(PLAYWRIGHT_MISSING_MSG); }
            const launcher = browserType === 'webkit' ? pw.webkit : pw.chromium;
            this.browser = await launcher.launch({ headless: false });
            this.currentBrowserType = browserType;
        }
        if (!this.context) {
            this.context = await this.browser.newContext();
        }
        if (!this.page || this.page.isClosed()) {
            this.page = await this.context.newPage();
        }
        return this.page;
    }

    async navigate(url: string, browserType: 'chromium' | 'webkit' = 'chromium'): Promise<string> {
        const targetUrl = this.normalizeUrl(url);
        const page = await this.launch(browserType);
        this.consoleLogs = [];
        this.networkLog = [];
        this.recordedActions = [];
        page.removeAllListeners('console');
        page.removeAllListeners('request');
        page.removeAllListeners('response');
        page.on('console', (msg) => {
            const location = msg.location();
            this.consoleLogs.push({
                type: msg.type(),
                text: msg.text(),
                location: location?.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : undefined,
            });
        });
        page.on('request', (req) => {
            this.networkLog.push({
                method: req.method(),
                url: req.url(),
                resourceType: req.resourceType(),
            });
        });
        page.on('response', (res) => {
            const entry = this.networkLog.find(e => e.url === res.url() && e.status === undefined);
            if (entry) {
                entry.status = res.status();
                entry.statusText = res.statusText();
            } else {
                this.networkLog.push({
                    method: 'UNKNOWN',
                    url: res.url(),
                    status: res.status(),
                    statusText: res.statusText(),
                });
            }
        });
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        this.recordedActions.push({ action: 'navigate', params: { url: targetUrl } });
        const title = await page.title();
        const html = await page.content();
        return `Pagina carregada: "${title}"\nURL: ${targetUrl}\nHTML (primeiros 2000 chars):\n${html.slice(0, 2000)}`;
    }

    getConsoleLogs(): string {
        if (this.consoleLogs.length === 0) { return 'Nenhum log de console capturado.'; }
        return this.consoleLogs.map(entry => {
            const location = entry.location ? `\nlocation: ${entry.location}` : '';
            return `[${entry.type}] ${entry.text}${location}`;
        }).join('\n');
    }

    getNetworkLog(): string {
        if (this.networkLog.length === 0) { return 'Nenhum request capturado.'; }
        return this.networkLog.map(e => this.formatNetworkEntry(e)).join('\n');
    }

    async getCookies(): Promise<string> {
        if (!this.context) { return 'Nenhum contexto de navegador ativo.'; }
        const cookies = await this.context.cookies();
        return JSON.stringify(cookies, null, 2);
    }

    async getHtml(): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const html = await page.content();
        return html.slice(0, 5000);
    }

    async click(selector: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.click(selector, { timeout: 10000 });
        this.recordedActions.push({ action: 'click', params: { selector } });
        return `Clicado em: ${selector}`;
    }

    async fill(selector: string, text: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.fill(selector, text);
        this.recordedActions.push({ action: 'type', params: { selector, text } });
        return `Texto digitado em "${selector}": "${text}"`;
    }

    async screenshot(): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const filePath = path.join(os.tmpdir(), `eucode-screenshot-${Date.now()}.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        this.recordedActions.push({ action: 'screenshot', params: { path: filePath } });
        return `Screenshot salvo em: ${filePath}`;
    }

    async evaluate(script: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const result = await page.evaluate(script);
        return JSON.stringify(result, null, 2);
    }

    async waitFor(selector: string, timeoutMs = 10000): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.waitForSelector(selector, { timeout: timeoutMs });
        this.recordedActions.push({ action: 'wait_for', params: { selector } });
        return `Elemento encontrado: ${selector}`;
    }

    async getText(selector: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const text = await page.locator(selector).first().textContent();
        if (text === null) { return `Texto encontrado em "${selector}": ""`; }
        return `Texto encontrado em "${selector}": ${text}`;
    }

    async getAttribute(selector: string, attribute: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const value = await page.locator(selector).first().getAttribute(attribute);
        if (value === null) { return `Atributo "${attribute}" nao encontrado em "${selector}".`; }
        return `Atributo "${attribute}" em "${selector}": ${value}`;
    }

    async select(selector: string, value: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.selectOption(selector, value);
        this.recordedActions.push({ action: 'select', params: { selector, value } });
        return `Selecionado em "${selector}": "${value}"`;
    }

    async hover(selector: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.hover(selector);
        this.recordedActions.push({ action: 'hover', params: { selector } });
        return `Hover em: ${selector}`;
    }

    async scroll(direction: 'up' | 'down' = 'down', amount = 800): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
        await page.evaluate((scrollAmount) => window.scrollBy(0, scrollAmount), delta);
        this.recordedActions.push({ action: 'scroll', params: { direction, amount: delta } });
        return `Scroll ${direction}: ${Math.abs(delta)}px`;
    }

    async press(key: string, selector?: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        if (selector) {
            await page.focus(selector);
        }
        await page.keyboard.press(key);
        this.recordedActions.push({ action: 'press', params: { key, selector } });
        return selector ? `Tecla "${key}" pressionada em "${selector}"` : `Tecla "${key}" pressionada`;
    }

    async clear(selector: string): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.fill(selector, '');
        this.recordedActions.push({ action: 'clear', params: { selector } });
        return `Campo limpo: ${selector}`;
    }

    async getTitle(): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        return await page.title();
    }

    async getUrl(): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        return page.url();
    }

    async reload(): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        return `Pagina recarregada: ${page.url()}`;
    }

    async wait(timeoutMs = 1000): Promise<string> {
        const page = this.getActivePage();
        if (!page) { return '[ERRO] Nenhuma pagina ativa. Use navigate primeiro.'; }
        const ms = Math.min(Math.max(timeoutMs, 0), 10000);
        await page.waitForTimeout(ms);
        return `Aguardou ${ms}ms.`;
    }

    getErrorsOnly(): string {
        const errors = this.consoleLogs.filter(entry => entry.type === 'error');
        if (errors.length === 0) { return 'Nenhum erro de console capturado.'; }
        return errors.map(entry => {
            const location = entry.location ? `\nlocation: ${entry.location}` : '';
            return `[${entry.type}] ${entry.text}${location}`;
        }).join('\n');
    }

    getNetworkErrors(): string {
        const errors = this.networkLog.filter(entry => typeof entry.status === 'number' && entry.status >= 400);
        if (errors.length === 0) { return 'Nenhum erro de rede capturado.'; }
        return errors.map(e => this.formatNetworkEntry(e)).join('\n');
    }

    networkFilter(filters: {
        urlContains?: string;
        method?: string;
        statusMin?: number;
        statusMax?: number;
    }): string {
        const method = filters.method?.toUpperCase();
        const entries = this.networkLog.filter(entry => {
            if (filters.urlContains && !entry.url.includes(filters.urlContains)) { return false; }
            if (method && entry.method.toUpperCase() !== method) { return false; }
            if (filters.statusMin !== undefined && (entry.status === undefined || entry.status < filters.statusMin)) { return false; }
            if (filters.statusMax !== undefined && (entry.status === undefined || entry.status > filters.statusMax)) { return false; }
            return true;
        });
        if (entries.length === 0) { return 'Nenhum request encontrado com os filtros informados.'; }
        return entries.map(e => this.formatNetworkEntry(e)).join('\n');
    }

    async saveTest(testName?: string, outputPath?: string): Promise<string> {
        if (this.recordedActions.length === 0) {
            return '[ERRO] Nenhuma acao gravada para gerar teste. Use navigate e interaja com a pagina primeiro.';
        }

        const timestamp = Date.now();
        const defaultDir = path.join(process.cwd(), 'tests', 'eucode-generated');
        const filePath = outputPath
            ? path.resolve(outputPath)
            : path.join(defaultDir, `browser-action-${timestamp}.spec.ts`);
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });

        const lines: string[] = [
            "import { test, expect } from '@playwright/test';",
            '',
            `test(${JSON.stringify(testName || 'fluxo gerado pelo Eucode IA')}, async ({ page }) => {`,
        ];

        for (const recorded of this.recordedActions) {
            const params = recorded.params;
            switch (recorded.action) {
                case 'navigate':
                    lines.push(`  await page.goto(${JSON.stringify(params.url)});`);
                    break;
                case 'wait_for':
                    lines.push(`  await page.waitForSelector(${JSON.stringify(params.selector)});`);
                    break;
                case 'type':
                    lines.push(`  await page.fill(${JSON.stringify(params.selector)}, ${JSON.stringify(params.text)});`);
                    break;
                case 'click':
                    lines.push(`  await page.click(${JSON.stringify(params.selector)});`);
                    break;
                case 'select':
                    lines.push(`  await page.selectOption(${JSON.stringify(params.selector)}, ${JSON.stringify(params.value)});`);
                    break;
                case 'hover':
                    lines.push(`  await page.hover(${JSON.stringify(params.selector)});`);
                    break;
                case 'press':
                    if (params.selector) {
                        lines.push(`  await page.focus(${JSON.stringify(params.selector)});`);
                    }
                    lines.push(`  await page.keyboard.press(${JSON.stringify(params.key)});`);
                    break;
                case 'clear':
                    lines.push(`  await page.fill(${JSON.stringify(params.selector)}, '');`);
                    break;
                case 'screenshot':
                    lines.push("  await page.screenshot({ path: 'screenshot.png', fullPage: true });");
                    break;
                case 'scroll':
                    lines.push(`  await page.evaluate(() => window.scrollBy(0, ${JSON.stringify(params.amount)}));`);
                    break;
            }
        }

        lines.push('});');
        lines.push('');
        lines.push(`// Generated by Eucode IA at ${new Date().toISOString()}`);

        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        return `Teste Playwright salvo em: ${filePath}`;
    }

    async close(): Promise<void> {
        if (this.page && !this.page.isClosed()) { await this.page.close(); }
        if (this.context) { await this.context.close(); }
        if (this.browser) { await this.browser.close(); }
        this.browser = null;
        this.context = null;
        this.page = null;
        this.consoleLogs = [];
        this.networkLog = [];
        this.recordedActions = [];
    }
}

export const browserManager = new BrowserManager();

export async function executeBrowserAction(
    action: string,
    params: BrowserActionParams,
    browserType: 'chromium' | 'webkit' = 'chromium'
): Promise<string> {
    try {
        switch (action) {
            case 'navigate':
                if (!params.url) { return '[ERRO] Parametro url e obrigatorio para navigate.'; }
                return await browserManager.navigate(params.url, browserType);
            case 'get_html':
                return await browserManager.getHtml();
            case 'get_console':
                return browserManager.getConsoleLogs();
            case 'get_network':
                return browserManager.getNetworkLog();
            case 'get_cookies':
                return await browserManager.getCookies();
            case 'click':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para click.'; }
                return await browserManager.click(params.selector);
            case 'type':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para type.'; }
                if (params.text === undefined) { return '[ERRO] Parametro text e obrigatorio para type.'; }
                return await browserManager.fill(params.selector, params.text);
            case 'screenshot':
                return await browserManager.screenshot();
            case 'evaluate':
                if (!params.script) { return '[ERRO] Parametro script e obrigatorio para evaluate.'; }
                return await browserManager.evaluate(params.script);
            case 'close':
                await browserManager.close();
                return 'Navegador fechado com sucesso.';
            case 'wait_for':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para wait_for.'; }
                return await browserManager.waitFor(params.selector, params.timeoutMs);
            case 'get_text':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para get_text.'; }
                return await browserManager.getText(params.selector);
            case 'get_attribute':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para get_attribute.'; }
                if (!params.attribute) { return '[ERRO] Parametro attribute e obrigatorio para get_attribute.'; }
                return await browserManager.getAttribute(params.selector, params.attribute);
            case 'select':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para select.'; }
                if (params.value === undefined) { return '[ERRO] Parametro value e obrigatorio para select.'; }
                return await browserManager.select(params.selector, params.value);
            case 'hover':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para hover.'; }
                return await browserManager.hover(params.selector);
            case 'scroll':
                return await browserManager.scroll(params.direction, params.amount);
            case 'press':
                if (!params.key) { return '[ERRO] Parametro key e obrigatorio para press.'; }
                return await browserManager.press(params.key, params.selector);
            case 'clear':
                if (!params.selector) { return '[ERRO] Parametro selector e obrigatorio para clear.'; }
                return await browserManager.clear(params.selector);
            case 'get_title':
                return await browserManager.getTitle();
            case 'get_url':
                return await browserManager.getUrl();
            case 'reload':
                return await browserManager.reload();
            case 'wait':
                return await browserManager.wait(params.timeoutMs);
            case 'get_errors_only':
                return browserManager.getErrorsOnly();
            case 'get_network_errors':
                return browserManager.getNetworkErrors();
            case 'network_filter':
                return browserManager.networkFilter({
                    urlContains: params.urlContains,
                    method: params.method,
                    statusMin: params.statusMin,
                    statusMax: params.statusMax,
                });
            case 'save_test':
                return await browserManager.saveTest(params.testName, params.outputPath);
            default:
                return `[ERRO] Acao desconhecida: "${action}". Acoes validas: navigate, get_html, get_console, get_network, get_cookies, click, type, screenshot, evaluate, close, wait_for, get_text, get_attribute, select, hover, scroll, press, clear, get_title, get_url, reload, wait, get_errors_only, get_network_errors, network_filter, save_test`;
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Playwright ausente: retorna a instrucao de instalacao sem ruido.
        if (msg.includes('browser_action) precisa do Playwright') || msg.startsWith('[ERRO] O controle de navegador')) {
            return msg;
        }
        return `[ERRO] Falha em browser_action (${action}): ${msg}`;
    }
}
