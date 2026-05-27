import * as https from 'https';

function httpsGet(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

export async function webSearch(query: string): Promise<string> {
    const encoded = encodeURIComponent(query);

    // Tenta DuckDuckGo Instant Answer API primeiro (sem chave)
    try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
        const raw = await httpsGet(apiUrl, 10000);
        const data = JSON.parse(raw);

        const results: string[] = [];

        if (data.AbstractText) {
            results.push(`**${data.Heading}**\n${data.AbstractText}\nFonte: ${data.AbstractURL}`);
        }

        if (data.RelatedTopics?.length) {
            for (const topic of data.RelatedTopics.slice(0, 4)) {
                if (topic.Text && topic.FirstURL) {
                    results.push(`- ${topic.Text}\n  ${topic.FirstURL}`);
                }
            }
        }

        if (results.length > 0) {
            return `Resultados para "${query}":\n\n${results.join('\n\n')}`;
        }
    } catch {
        // fallback abaixo
    }

    // Fallback: scraping basico do HTML do DuckDuckGo
    try {
        const htmlUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
        const html = await httpsGet(htmlUrl, 10000);

        const snippets: string[] = [];
        // Extrai titulos e snippets dos resultados
        const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

        const titles: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = resultPattern.exec(html)) !== null && titles.length < 5) {
            const title = m[2].replace(/<[^>]+>/g, '').trim();
            if (title) { titles.push(title); }
        }

        const snips: string[] = [];
        while ((m = snippetPattern.exec(html)) !== null && snips.length < 5) {
            const snip = m[1].replace(/<[^>]+>/g, '').trim();
            if (snip) { snips.push(snip); }
        }

        for (let i = 0; i < Math.min(titles.length, snips.length, 5); i++) {
            snippets.push(`**${titles[i]}**\n${snips[i]}`);
        }

        if (snippets.length > 0) {
            return `Resultados para "${query}":\n\n${snippets.join('\n\n')}`;
        }

        return `Nenhum resultado encontrado para "${query}". Tente reformular a busca.`;
    } catch (e) {
        return `[ERRO] Falha na busca web: ${e instanceof Error ? e.message : String(e)}`;
    }
}
