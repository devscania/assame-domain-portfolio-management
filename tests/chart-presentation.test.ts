import { describe, expect, it } from 'vitest';
import { distributionGroups } from '../src/lib/chart-presentation';

describe('distribution presentation', () => {
  it('keeps all returned counts in the chart and legend when grouping small categories', () => {
    const rows = [8, 2, 4, 10, 3, 1, 6].map((value, index) => ({ label: `Group ${index}`, value }));
    const groups = distributionGroups(rows);
    expect(groups).toHaveLength(6);
    expect(groups.at(-1)).toEqual({ label: 'Other', value: 3 });
    expect(groups.reduce((sum, item) => sum + item.value, 0)).toBe(
      rows.reduce((sum, item) => sum + item.value, 0),
    );
    expect(rows.map((item) => item.value)).toEqual([8, 2, 4, 10, 3, 1, 6]);
  });
  it('does not manufacture an Other count or a positive empty slice', () => {
    expect(
      distributionGroups([
        { label: 'Known', value: 5 },
        { label: 'No records', value: 0 },
      ]),
    ).toEqual([{ label: 'Known', value: 5 }]);
    expect(distributionGroups([])).toEqual([]);
  });
});
