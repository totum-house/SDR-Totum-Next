/**
 * csv.ts — parser de CSV e normalização de telefone para o import de leads.
 *
 * Escrito à mão em vez de puxar uma lib: o que entra aqui é um arquivo
 * de 3 colunas exportado do Excel ou do CRM, e as duas coisas que
 * realmente quebram um parser ingênuo são aspas com vírgula dentro e o
 * ponto-e-vírgula do Excel em português. Ambas cabem em 40 linhas.
 */

export type CsvRow = Record<string, string>;

/**
 * Excel em pt-BR exporta com ';' porque a vírgula é separador decimal.
 * Detecta pelo cabeçalho: o separador certo é o que aparece mais vezes
 * na primeira linha (fora de aspas).
 */
function detectDelimiter(headerLine: string): string {
  let inQuotes = false;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

/**
 * Parser RFC-4180 no essencial: aspas duplas escapam separador e quebra
 * de linha, `""` vira uma aspa literal.
 */
export function parseCsv(text: string): CsvRow[] {
  // BOM do Excel vira parte do nome da primeira coluna se não for tirado
  // — o cabeçalho viraria "﻿phone" e a coluna `phone` sumiria.
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.trim()) return [];

  const delimiter = detectDelimiter(clean.split('\n')[0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: CsvRow = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    return obj;
  });
}

/**
 * Normaliza telefone brasileiro para o formato que o OpenWA usa
 * (só dígitos, com DDI).
 *
 * LIMITAÇÃO CONHECIDA — o nono dígito. O WhatsApp entrega o remetente de
 * celulares brasileiros ora com 13 dígitos (55 + DDD + 9 + 8 dígitos),
 * ora com 12 (sem o 9), dependendo de quando o número foi registrado.
 * Um lead importado como 5531999990001 e uma resposta chegando de
 * 553199990001 viram DUAS linhas em `leads`, porque a UNIQUE é
 * (workspace_id, phone_e164) e as strings diferem.
 *
 * Não é resolvido aqui de propósito: a correção certa é o motor procurar
 * o lead pelas duas variantes ao receber inbound, e isso mexe no
 * webhook_handler — mudança que merece seu próprio commit e seus testes.
 * Enquanto isso, o import guarda a forma canônica (com o 9).
 *
 * → dígitos normalizados, ou null se não parecer telefone.
 */
export function normalizePhoneBR(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;

  // Já veio com DDI 55
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // Sem DDI: 10 (fixo) ou 11 (celular) dígitos
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  // Outro DDI qualquer, tamanho plausível de E.164
  if (digits.length >= 11 && digits.length <= 15) return digits;

  return null;
}

/** Tags aceitas como "a;b;c" ou "a,b,c" — o que a pessoa digitou no Excel. */
export function parseTags(raw: string): string[] {
  return String(raw || '')
    .split(/[;,|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export type ParsedLead = {
  phone_e164: string;
  name: string | null;
  tags: string[];
};

export type ImportPreview = {
  valid: ParsedLead[];
  invalid: { line: number; raw: string; reason: string }[];
  duplicatesInFile: number;
};

/**
 * CSV → leads prontos para o insert, já sem duplicata interna.
 *
 * Linha inválida NÃO aborta o import: devolve na lista `invalid` para a
 * tela mostrar. Um arquivo de 100 leads com 3 telefones tortos deve
 * importar 97 e apontar os 3 — recusar o arquivo inteiro obrigaria a
 * pessoa a caçar o erro no Excel sem nenhuma pista de onde ele está.
 */
export function leadsFromCsv(text: string): ImportPreview {
  const rows = parseCsv(text);
  const valid: ParsedLead[] = [];
  const invalid: ImportPreview['invalid'] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  rows.forEach((row, idx) => {
    const line = idx + 2; // +1 do cabeçalho, +1 porque humano conta de 1
    const rawPhone = row.phone || row.telefone || row.celular || row.whatsapp || '';
    const phone = normalizePhoneBR(rawPhone);

    if (!phone) {
      invalid.push({
        line,
        raw: rawPhone || JSON.stringify(row).slice(0, 60),
        reason: rawPhone ? 'telefone inválido' : 'sem coluna phone/telefone',
      });
      return;
    }
    if (seen.has(phone)) { duplicatesInFile += 1; return; }
    seen.add(phone);

    valid.push({
      phone_e164: phone,
      name: (row.name || row.nome || '').trim() || null,
      tags: parseTags(row.tags || row.tag || ''),
    });
  });

  return { valid, invalid, duplicatesInFile };
}
