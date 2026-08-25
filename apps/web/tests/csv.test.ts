/**
 * csv.test.ts — o parser do import de leads.
 *
 * Vale testar com cuidado porque as falhas aqui são silenciosas: um
 * telefone mal normalizado não dá erro, ele cria um lead duplicado que
 * consome cota de warm-up conversando com a mesma pessoa duas vezes.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, normalizePhoneBR, parseTags, leadsFromCsv } from '../lib/csv';

describe('parseCsv', () => {
  it('lê um CSV simples com vírgula', () => {
    const rows = parseCsv('phone,name\n5531999998888,Rael\n5511999990002,Maria');
    expect(rows).toEqual([
      { phone: '5531999998888', name: 'Rael' },
      { phone: '5511999990002', name: 'Maria' },
    ]);
  });

  it('detecta ponto-e-vírgula do Excel em português', () => {
    const rows = parseCsv('phone;name\n5531999998888;Rael');
    expect(rows[0]).toEqual({ phone: '5531999998888', name: 'Rael' });
  });

  it('respeita vírgula dentro de aspas', () => {
    const rows = parseCsv('phone,name\n5531999998888,"Silva, Rael"');
    expect(rows[0].name).toBe('Silva, Rael');
  });

  it('aspas duplicadas viram uma aspa literal', () => {
    const rows = parseCsv('phone,name\n5531999998888,"o ""Rael"""');
    expect(rows[0].name).toBe('o "Rael"');
  });

  it('aceita quebra de linha dentro de campo entre aspas', () => {
    const rows = parseCsv('phone,name\n5531999998888,"linha1\nlinha2"');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('linha1\nlinha2');
  });

  it('tira o BOM do Excel — senão a primeira coluna some', () => {
    const rows = parseCsv('﻿phone,name\n5531999998888,Rael');
    expect(rows[0].phone).toBe('5531999998888');
  });

  it('normaliza CRLF do Windows', () => {
    const rows = parseCsv('phone,name\r\n5531999998888,Rael\r\n');
    expect(rows).toHaveLength(1);
  });

  it('cabeçalho é case-insensitive', () => {
    const rows = parseCsv('PHONE,Name\n5531999998888,Rael');
    expect(rows[0].phone).toBe('5531999998888');
  });

  it('arquivo vazio ou só com cabeçalho devolve lista vazia', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('phone,name')).toEqual([]);
  });
});

describe('normalizePhoneBR', () => {
  it('mantém número que já veio com DDI', () => {
    expect(normalizePhoneBR('5531999990001')).toBe('5531999990001');
    expect(normalizePhoneBR('553199990001')).toBe('553199990001');
  });

  it('acrescenta 55 em número sem DDI', () => {
    expect(normalizePhoneBR('31999990001')).toBe('5531999990001');
    expect(normalizePhoneBR('3132189504')).toBe('553132189504');
  });

  it('ignora formatação humana', () => {
    expect(normalizePhoneBR('+55 (31) 99999-0001')).toBe('5531999990001');
    expect(normalizePhoneBR('31 9 9999 0001')).toBe('5531999990001');
  });

  it('recusa o que não é telefone', () => {
    expect(normalizePhoneBR('')).toBe(null);
    expect(normalizePhoneBR('abc')).toBe(null);
    expect(normalizePhoneBR('123')).toBe(null);
    expect(normalizePhoneBR('9'.repeat(20))).toBe(null);
  });
});

describe('parseTags', () => {
  it('aceita ; , e | como separador', () => {
    expect(parseTags('quente;bh')).toEqual(['quente', 'bh']);
    expect(parseTags('quente, bh')).toEqual(['quente', 'bh']);
    expect(parseTags('quente|bh')).toEqual(['quente', 'bh']);
  });

  it('descarta vazios e espaços', () => {
    expect(parseTags(' quente ;; bh ')).toEqual(['quente', 'bh']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('leadsFromCsv', () => {
  it('converte o formato documentado na tela de import', () => {
    const out = leadsFromCsv('phone,name,tags\n5531999990001,Rael,quente;bh');
    expect(out.valid).toEqual([
      { phone_e164: '5531999990001', name: 'Rael', tags: ['quente', 'bh'] },
    ]);
    expect(out.invalid).toHaveLength(0);
  });

  it('aceita os nomes de coluna em português', () => {
    const out = leadsFromCsv('telefone,nome\n31999990001,Rael');
    expect(out.valid[0]).toMatchObject({ phone_e164: '5531999990001', name: 'Rael' });
  });

  it('linha inválida não aborta o arquivo — importa o resto e aponta a linha', () => {
    const out = leadsFromCsv(
      'phone,name\n5531999990001,Rael\nabc,Torto\n5511999990002,Maria'
    );
    expect(out.valid).toHaveLength(2);
    expect(out.invalid).toHaveLength(1);
    // linha 3 do arquivo: 1 é o cabeçalho
    expect(out.invalid[0]).toMatchObject({ line: 3, reason: 'telefone inválido' });
  });

  it('duplicata dentro do próprio arquivo entra uma vez só', () => {
    const out = leadsFromCsv(
      'phone,name\n5531999990001,Rael\n+55 (31) 99999-0001,Rael de novo'
    );
    expect(out.valid).toHaveLength(1);
    expect(out.duplicatesInFile).toBe(1);
  });

  it('nome vazio vira null, não string vazia', () => {
    const out = leadsFromCsv('phone,name\n5531999990001,');
    expect(out.valid[0].name).toBe(null);
  });

  it('arquivo sem coluna de telefone reporta todas as linhas como inválidas', () => {
    const out = leadsFromCsv('nome,email\nRael,a@b.com');
    expect(out.valid).toHaveLength(0);
    expect(out.invalid[0].reason).toBe('sem coluna phone/telefone');
  });
});
