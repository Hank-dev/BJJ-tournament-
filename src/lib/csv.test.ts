import { describe, expect, it } from 'vitest';
import { csvTemplate, parseCompetitorCsv } from './csv';

describe('parseCompetitorCsv', () => {
  it('parses the simplified competitor CSV format', () => {
    const result = parseCompetitorCsv(
      'name,weight,months trained\n"Jane, A.",64kg,18'
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({
      name: 'Jane, A.',
      weight: '64kg',
      monthsTrained: '18'
    });
  });

  it('supports common months-trained aliases', () => {
    const result = parseCompetitorCsv('Full Name,Weight Class,Training Months\nSam,82kg,9');

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      name: 'Sam',
      weight: '82kg',
      monthsTrained: '9'
    });
  });

  it('reports rows without names', () => {
    const result = parseCompetitorCsv('name,weight,months trained\n,77kg,12');

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toContain('Row 2 is missing a name.');
  });

  it('exports a three-column CSV template', () => {
    expect(csvTemplate()).toBe('name,weight,months trained\n');
  });
});
