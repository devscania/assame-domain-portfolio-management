/** Group only returned records. Never infer unreturned provider/registrar counts. */
export function distributionGroups(data: { label: string; value: number }[]) {
  const sorted = [...data].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const visible = sorted.slice(0, 5);
  const remaining = sorted.slice(5).reduce((sum, item) => sum + item.value, 0);
  return remaining ? [...visible, { label: 'Other', value: remaining }] : visible;
}
