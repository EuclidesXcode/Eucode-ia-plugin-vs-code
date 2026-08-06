"use strict";
/**
 * DocumentExtractor — extrai TEXTO legivel de formatos que nao sao texto puro
 * (Office xlsx/docx, diagramas drawio), para que o agente possa "ler" esses
 * arquivos sem despejar binario cru no contexto.
 *
 * Por que existe: o read_local_file fazia readFileSync(..., 'utf8') em QUALQUER
 * arquivo. Um .xlsx/.docx e um ZIP de XMLs — lido como utf8 vira milhares de
 * tokens de lixo ilegivel, que enchem a janela do modelo pequeno e, no MLX,
 * estouram o KV cache -> crash de Metal OOM (Insufficient Memory). Um .drawio e
 * XML de texto, mas com linhas gigantes que tambem estouram o contexto.
 *
 * Estrategia: extrai o texto REAL (celulas, paragrafos, rotulos de formas) e,
 * se passar do teto derivado da janela de contexto, entrega um RESUMO
 * estrutural em vez do conteudo inteiro. Assim o modelo entende o arquivo sem
 * estourar a RAM.
 *
 * Zero dependencia externa: usa apenas `zlib` nativo do Node para inflar as
 * entries do ZIP (Office e ZIP+deflate). Nao incha o .vsix.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTRACTABLE_EXTS = void 0;
exports.isExtractable = isExtractable;
exports.extractDocument = extractDocument;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
// Extensoes que este modulo sabe extrair. read_local_file delega a nos.
exports.EXTRACTABLE_EXTS = new Set(['.xlsx', '.xlsm', '.docx', '.drawio', '.pptx']);
function isExtractable(filePath) {
    return exports.EXTRACTABLE_EXTS.has(path.extname(filePath).toLowerCase());
}
function readCentralDirectory(buf) {
    // Acha o End Of Central Directory (assinatura 0x06054b50) varrendo do fim.
    let eocd = -1;
    const minPos = Math.max(0, buf.length - 65557); // 64KB comment max + 22
    for (let i = buf.length - 22; i >= minPos; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        return [];
    }
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const cdCount = buf.readUInt16LE(eocd + 10);
    const entries = [];
    let p = cdOffset;
    for (let n = 0; n < cdCount && p + 46 <= buf.length; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) {
            break;
        }
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
        entries.push({ name, method, localOffset, compSize });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
function inflateEntry(buf, entry) {
    // No local header, o nome/extra podem ter tamanhos diferentes do CD.
    const lo = entry.localOffset;
    if (lo + 30 > buf.length) {
        return null;
    }
    const lNameLen = buf.readUInt16LE(lo + 26);
    const lExtraLen = buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + entry.compSize);
    try {
        const data = entry.method === 8 ? zlib.inflateRawSync(comp) : comp;
        return data.toString('utf8');
    }
    catch {
        return null;
    }
}
function readZipMember(buf, entries, name) {
    const e = entries.find(x => x.name === name);
    return e ? inflateEntry(buf, e) : null;
}
// Remove tags XML, decodifica entidades comuns e normaliza espacos em branco.
function xmlToText(xml) {
    return xml
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
// ── Extratores por formato ─────────────────────────────────────────────
function extractDocx(buf, entries) {
    const doc = readZipMember(buf, entries, 'word/document.xml');
    if (!doc) {
        return '[Nao foi possivel ler word/document.xml]';
    }
    // Cada <w:p> e um paragrafo; <w:t> sao os runs de texto dentro dele.
    const paras = doc.split(/<w:p[ >]/).map(block => {
        const runs = [...block.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
        return runs.join('');
    }).filter(p => p.trim().length > 0);
    return paras.join('\n');
}
function extractXlsx(buf, entries) {
    // sharedStrings.xml guarda os textos; as sheets referenciam por indice.
    const shared = readZipMember(buf, entries, 'xl/sharedStrings.xml');
    const strings = shared
        ? [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
        : [];
    const sheets = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
    const parts = [];
    for (const sheet of sheets) {
        const xml = inflateEntry(buf, sheet);
        if (!xml) {
            continue;
        }
        const rows = [];
        // Cada <row> tem <c> (celulas). Uma celula com t="s" guarda um INDICE
        // em sharedStrings (o texto real); t="inlineStr" guarda o texto direto
        // em <is><t>; sem t, o <v> e um numero literal.
        for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
            const cells = [];
            // Captura cada <c ...>...</c> inteiro para inspecionar tipo + valor.
            for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
                const attrs = cellMatch[1];
                const inner = cellMatch[2];
                const typeMatch = attrs.match(/\bt="([^"]*)"/);
                const type = typeMatch ? typeMatch[1] : '';
                if (type === 's') {
                    // shared string: <v>indice</v>
                    const v = inner.match(/<v>([^<]*)<\/v>/);
                    if (v) {
                        cells.push(strings[parseInt(v[1], 10)] ?? '');
                    }
                }
                else if (type === 'inlineStr') {
                    const t = inner.match(/<t[^>]*>([^<]*)<\/t>/);
                    if (t) {
                        cells.push(t[1]);
                    }
                }
                else {
                    const v = inner.match(/<v>([^<]*)<\/v>/);
                    if (v) {
                        cells.push(v[1]);
                    }
                }
            }
            if (cells.some(c => c.trim() !== '')) {
                rows.push(cells.join(' | '));
            }
        }
        if (rows.length > 0) {
            const sheetName = sheet.name.replace('xl/worksheets/', '').replace('.xml', '');
            parts.push(`# Planilha ${sheetName} (${rows.length} linhas)\n${rows.join('\n')}`);
        }
    }
    return { text: parts.join('\n\n'), sheetCount: sheets.length };
}
function extractPptx(buf, entries) {
    const slides = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name));
    const parts = [];
    for (const slide of slides) {
        const xml = inflateEntry(buf, slide);
        if (!xml) {
            continue;
        }
        const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' ');
        if (text.trim()) {
            parts.push(text.trim());
        }
    }
    return parts.join('\n');
}
function extractDrawio(raw) {
    // .drawio e XML de texto, mas com linhas gigantes. Extrai os rotulos das
    // formas (atributo value=) e a estrutura, descartando geometria/estilo.
    const labels = [...raw.matchAll(/value="([^"]+)"/g)]
        .map(m => xmlToText(m[1]))
        .filter(v => v.length > 0);
    const uniq = Array.from(new Set(labels));
    const header = `# Diagrama drawio (${uniq.length} elementos rotulados)`;
    return `${header}\n${uniq.join('\n')}`;
}
/**
 * Extrai o texto legivel de um arquivo Office/drawio. Retorna o conteudo real,
 * ou — se exceder maxChars — um resumo estrutural + o inicio do conteudo.
 * Nunca lanca: em erro, retorna uma string de diagnostico.
 */
function extractDocument(filePath, opts) {
    const ext = path.extname(filePath).toLowerCase();
    let buf;
    try {
        buf = fs.readFileSync(filePath);
    }
    catch (e) {
        return `[ERRO] Nao foi possivel abrir "${path.basename(filePath)}": ${e instanceof Error ? e.message : String(e)}`;
    }
    let full = '';
    let structureNote = '';
    try {
        if (ext === '.drawio') {
            full = extractDrawio(buf.toString('utf8'));
        }
        else {
            const entries = readCentralDirectory(buf);
            if (entries.length === 0) {
                return `[ERRO] "${path.basename(filePath)}" nao parece um arquivo ${ext} valido (ZIP nao reconhecido).`;
            }
            if (ext === '.docx') {
                full = extractDocx(buf, entries);
                structureNote = `Documento Word — ${full.split('\n').filter(Boolean).length} paragrafos`;
            }
            else if (ext === '.xlsx' || ext === '.xlsm') {
                const r = extractXlsx(buf, entries);
                full = r.text;
                structureNote = `Planilha Excel — ${r.sheetCount} aba(s)`;
            }
            else if (ext === '.pptx') {
                full = extractPptx(buf, entries);
                structureNote = 'Apresentacao PowerPoint';
            }
        }
    }
    catch (e) {
        return `[ERRO] Falha ao extrair texto de "${path.basename(filePath)}": ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!full.trim()) {
        return `[AVISO] "${path.basename(filePath)}" foi lido mas nao continha texto extraivel (pode ser so imagens/graficos).`;
    }
    const banner = `[Conteudo extraido de ${path.basename(filePath)}${structureNote ? ' — ' + structureNote : ''}]`;
    if (full.length <= opts.maxChars) {
        return `${banner}\n${full}`;
    }
    // Passou do teto: resumo estrutural + o inicio do conteudo (que cabe).
    const head = full.slice(0, opts.maxChars);
    const lastNl = head.lastIndexOf('\n');
    const trimmed = lastNl > opts.maxChars * 0.5 ? head.slice(0, lastNl) : head;
    return `${banner}\n[ARQUIVO GRANDE: mostrando o inicio (${trimmed.length} de ${full.length} chars). Peca trechos especificos se precisar de mais.]\n${trimmed}\n[...conteudo truncado...]`;
}
