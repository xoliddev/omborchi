/** CSV / Excel export and spreadsheet import helpers. */
export type Cell = string | number | boolean | null | undefined;
export interface Column<T> {
  header: string;
  value: (row: T) => Cell;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv<T>(name: string, rows: T[], cols: Column<T>[]) {
  const lines = [cols.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => cols.map((c) => csvCell(c.value(r))).join(','))];
  // BOM so Excel opens UTF-8 (Cyrillic, o‘ g‘) correctly.
  download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export async function exportXlsx<T>(name: string, rows: T[], cols: Column<T>[]) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const data = [
    cols.map((c) => ({ value: c.header, fontWeight: 'bold' as const })),
    ...rows.map((r) => cols.map((c) => {
      const v = c.value(r);
      return v === undefined || v === null ? null : { value: v };
    })),
  ];
  await writeExcelFile(data as never).toFile(`${name}.xlsx`);
}

/** Read the first sheet of an .xlsx or a .csv file into header-keyed objects. */
export async function readSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  let matrix: unknown[][];
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    matrix = parseCsv(await file.text());
  } else {
    const { readSheet } = await import('read-excel-file/browser');
    matrix = (await readSheet(file)) as unknown[][];
  }
  const [header, ...rest] = matrix;
  if (!header) return [];
  const keys = header.map((h) => normaliseHeader(String(h ?? '')));
  return rest
    .filter((r) => r.some((c) => c !== null && c !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
}

const HEADER_ALIASES: Record<string, string> = {
  nomi: 'name', nom: 'name', 'mahsulot': 'name', name: 'name', 'название': 'name', 'наименование': 'name',
  kategoriya: 'category', category: 'category', 'категория': 'category',
  birlik: 'unit', unit: 'unit', 'ед': 'unit', 'единица': 'unit',
  sku: 'sku', artikul: 'sku', 'артикул': 'sku',
  shtrixkod: 'barcode', barcode: 'barcode', 'штрихкод': 'barcode', 'штрих-код': 'barcode',
  tannarx: 'cost', cost: 'cost', 'себестоимость': 'cost', 'закупка': 'cost',
  narx: 'retail', retail: 'retail', 'chakana': 'retail', 'цена': 'retail', 'розница': 'retail',
  ulgurji: 'wholesale', wholesale: 'wholesale', 'опт': 'wholesale',
  minimal: 'minStock', minstock: 'minStock', 'min': 'minStock', 'минимум': 'minStock',
  qoldiq: 'qty', qty: 'qty', 'miqdor': 'qty', 'остаток': 'qty', 'количество': 'qty',
};

function normaliseHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/[\s_.]+/g, '').replace(/[‘’'`]/g, '');
  return HEADER_ALIASES[k] ?? h.trim();
}

export function parseCsv(text: string): string[][] {
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/^\ufeff/, '')));
}

export const IMPORT_TEMPLATE = [
  ['name', 'category', 'unit', 'sku', 'barcode', 'cost', 'retail', 'wholesale', 'minStock', 'qty'],
  ['Choy Ahmad 100 g', 'Oziq-ovqat / Choy', 'dona', 'CH-100', '4780000000014', 28000, 34000, 31000, 5, 24],
  ['Guruch Lazer', 'Oziq-ovqat / Bakaleya', 'kg', 'GR-LZ', '', 21500, 26000, 24000, 20, 100],
];

export function downloadTemplate() {
  download(new Blob(['\ufeff' + IMPORT_TEMPLATE.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'omborchi-import-template.csv');
}
