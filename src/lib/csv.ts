export interface CsvCompetitorRow {
  name: string;
  weight?: string;
  monthsTrained?: string;
}

export interface CsvParseResult {
  rows: CsvCompetitorRow[];
  errors: string[];
}

export const csvTemplateHeaders = ['name', 'weight', 'months trained'];

const headerAliases: Record<string, keyof CsvCompetitorRow> = {
  name: 'name',
  competitor: 'name',
  fullname: 'name',
  full_name: 'name',
  weight: 'weight',
  weightclass: 'weight',
  weight_class: 'weight',
  monthstrained: 'monthsTrained',
  months_trained: 'monthsTrained',
  trainingmonths: 'monthsTrained',
  training_months: 'monthsTrained',
  months: 'monthsTrained'
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
}

function parseCsvCells(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentCell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i += 1;
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) rows.push(currentRow);

  return rows;
}

export function parseCompetitorCsv(input: string): CsvParseResult {
  const rows = parseCsvCells(input);
  const errors: string[] = [];

  if (rows.length === 0) {
    return { rows: [], errors: ['CSV file is empty.'] };
  }

  const headers = rows[0].map((header) => headerAliases[normalizeHeader(header)]);
  if (!headers.includes('name')) {
    errors.push('CSV must include a name column.');
  }

  const parsedRows: CsvCompetitorRow[] = [];

  rows.slice(1).forEach((cells, rowIndex) => {
    const parsed: Partial<CsvCompetitorRow> = {};

    cells.forEach((cell, cellIndex) => {
      const key = headers[cellIndex];
      if (key && cell.trim()) parsed[key] = cell.trim();
    });

    if (!parsed.name) {
      errors.push(`Row ${rowIndex + 2} is missing a name.`);
      return;
    }

    parsedRows.push(parsed as CsvCompetitorRow);
  });

  return { rows: parsedRows, errors };
}

export function csvTemplate(): string {
  return `${csvTemplateHeaders.join(',')}\n`;
}
