/**
 * Reading a trainer's file in the browser: the .xlsx reader against a real
 * workbook written by another library, hand-built edge cases, and CSV.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { readXlsx, unzipText } from '@/features/personal-training/xlsx';
import { readSpreadsheet, SpreadsheetError } from '@/features/personal-training/spreadsheet';

const fixture = new Uint8Array(readFileSync(path.resolve(__dirname, 'fixtures/trainer-clients.xlsx')));

/** A minimal zip writer, so edge cases can be written as XML in the test. */
function zip(files: Record<string, string>, compress = false): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = compress ? new Uint8Array(deflateRawSync(raw)) : raw;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, compress ? 8 : 0, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, compress ? 8 : 0, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    cd.set(n, 46);
    chunks.push(local, data); central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

const workbook = (sheets: string, pr = '') => `<?xml version="1.0"?><workbook xmlns:r="x">${pr}<sheets>${sheets}</sheets></workbook>`;
const rels = (n: number) => `<Relationships>${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
const file = (name: string, bytes: Uint8Array) => new File([bytes], name);

describe('reading a real workbook', () => {
  it('reads every sheet with its name, in order', async () => {
    const sheets = await readXlsx(fixture);
    expect(sheets.map((s) => s.name)).toEqual(['Clients', 'Sarah K', 'Tom B', 'Weigh-ins', 'Pricing']);
  });

  it('keeps rows where Excel has them, including the blank row under a title', async () => {
    const [clients] = await readXlsx(fixture);
    expect(clients.rows[0]).toEqual(['Kavi Strength Coaching — client list']);
    expect(clients.rows[1]).toEqual([]);
    expect(clients.rows[2]).toEqual(['Name', 'E-mail', 'Phone', 'Goal', 'Injuries / limitations', 'Started']);
    // Rich text is flattened; "&" survives the XML; an empty cell keeps its column.
    expect(clients.rows[3]).toEqual(['Sarah Kim', 'sarah.kim@example.com', '+1 (555) 010-2233', 'First pull-up & lose 10 lb', 'Left shoulder impingement', '2026-01-12']);
    expect(clients.rows[5]).toEqual(['Aisha Rahman', '', '', 'General fitness', 'Lower back — cleared', '2026-06-01']);
  });

  it('turns date cells into unambiguous dates whatever their display format, and leaves numbers as numbers', async () => {
    const sheets = await readXlsx(fixture);
    const sarah = sheets[1].rows;
    expect(sarah[2]).toEqual(['2026-09-01', 'Upper', 'Lat pulldown', '3x10', '90', '7', 'felt good']);
    expect(sarah[3]).toEqual(['', '', 'DB bench press', '3x8', '30', '8']);
    expect(sarah[8][4]).toBe('32.5');
    const tom = sheets[2].rows;
    expect(tom[5][0]).toBe('2026-09-09'); // a date with a time of day
    expect(tom[6][0]).toBe('TBC');
    const weights = sheets[3].rows;
    expect(weights[1]).toEqual(['Sarah Kim', '2026-09-01', '152.4']);
    expect(weights[3][2]).toBe('210.3'); // not 210.30000000000001
    expect(weights[4][2]).toBe('171.3'); // a formula's stored result
  });
});

describe('workbooks written by other tools', () => {
  it('handles inline strings, prefixed tags, cells without references, booleans, errors and the 1904 date system', async () => {
    const sheet = `<x:worksheet xmlns:x="m"><x:sheetData>
      <x:row><x:c t="inlineStr"><x:is><x:t>Name</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t xml:space="preserve">Date </x:t></x:is></x:c><x:c t="str"><x:v>A &lt; B</x:v></x:c></x:row>
      <x:row r="3"><x:c r="A3" t="s"><x:v>0</x:v></x:c><x:c r="B3" s="1"><x:v>44805</x:v></x:c><x:c r="C3" t="b"><x:v>1</x:v></x:c><x:c r="D3" t="e"><x:v>#DIV/0!</x:v></x:c><x:c r="F3"><x:v>12</x:v></x:c></x:row>
    </x:sheetData></x:worksheet>`;
    const bytes = zip({
      'xl/workbook.xml': workbook('<sheet name="Q&amp;A" sheetId="1" r:id="rId1"/>', '<workbookPr date1904="1"/>'),
      'xl/_rels/workbook.xml.rels': rels(1),
      'xl/sharedStrings.xml': '<sst><si><r><t>Mé</t></r><r><t>lanie_x000D_</t></r><rPh><t>ignored</t></rPh></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[$-409]d\\-mmm\\-yy;@"/><numFmt numFmtId="165" formatCode="0.0 &quot;days&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': sheet,
    }, true);
    const [s] = await readXlsx(bytes);
    expect(s.name).toBe('Q&A');
    expect(s.rows[0]).toEqual(['Name', 'Date', 'A < B']);
    expect(s.rows[1]).toEqual([]);
    // 44805 in the 1904 system is 1462 days later than in the 1900 system.
    expect(s.rows[2]).toEqual(['Mélanie', '2026-09-02', 'TRUE', '', '', '12']);
  });

  it('does not mistake a number format with quoted letters for a date', async () => {
    const bytes = zip({
      'xl/workbook.xml': workbook('<sheet name="A" sheetId="1" r:id="rId1"/>'),
      'xl/_rels/workbook.xml.rels': rels(1),
      'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="165" formatCode="0.0 &quot;days&quot;"/></numFmts><cellXfs><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" s="0"><v>45000</v></c><c r="B1" s="1"><v>45000</v></c></row></sheetData></worksheet>',
    });
    expect((await readXlsx(bytes))[0].rows[0]).toEqual(['45000', '2023-03-15']);
  });

  it('rejects something that is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('PK not really a zip'))).rejects.toThrow();
    await expect(readXlsx(zip({ 'hello.txt': 'hi' }))).rejects.toThrow('Not an Excel workbook');
    expect((await unzipText(zip({ 'a.txt': 'one', 'b.txt': 'two' }, true), (n) => n === 'b.txt')).get('b.txt')).toBe('two');
  });
});

describe('readSpreadsheet', () => {
  it('reads .xlsx by content, not by file name', async () => {
    const upload = await readSpreadsheet(file('export.dat', fixture));
    expect(upload.fileName).toBe('export.dat');
    expect(upload.sheets).toHaveLength(5);
  });

  it('reads CSV, naming the sheet after the file', async () => {
    const upload = await readSpreadsheet(file('clients 2026.csv', new TextEncoder().encode('﻿Name,Goal\r\n"Kim, Sarah","Lose 10 lb"\r\n')));
    expect(upload.sheets).toEqual([{ name: 'clients 2026', rows: [['Name', 'Goal'], ['Kim, Sarah', 'Lose 10 lb']] }]);
  });

  it('reads a CSV saved by Excel on Windows in its own code page', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('Name;Goal\n'), 0x52, 0x65, 0x6e, 0xe9, 0x65, ...new TextEncoder().encode(';Squat 100\n')]);
    expect((await readSpreadsheet(file('a.csv', bytes))).sheets[0].rows[1]).toEqual(['Renée', 'Squat 100']);
  });

  it('says so when the file is the old .xls format, empty, or too large', async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readSpreadsheet(file('old.xls', xls))).rejects.toMatchObject({ problem: 'notReadable' });
    await expect(readSpreadsheet(file('empty.csv', new TextEncoder().encode('\n\n')))).rejects.toBeInstanceOf(SpreadsheetError);
    const huge = { name: 'big.xlsx', size: 30 * 1024 * 1024 } as File;
    await expect(readSpreadsheet(huge)).rejects.toMatchObject({ problem: 'tooBig' });
  });
});
