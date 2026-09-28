import { formatStoneDate, stonePositionLabel, type StoneSummary } from '../../utils/curlingStones';

export default function StoneDetailsList({ stone }: { stone: StoneSummary }) {
  const current = stone.current;
  const items: Array<{ label: string; value: string }> = [
    { label: 'WCF registration number', value: stone.wcfRegistrationNumber },
    { label: 'AL serial number', value: stone.alSerialNumber },
    { label: 'Position', value: stonePositionLabel(current) },
    { label: 'Side in play', value: current ? `Side ${current.side}` : '—' },
    { label: 'Last position change', value: formatStoneDate(current?.effectiveDate) || '—' },
    { label: 'Last textured', value: formatStoneDate(stone.lastMaintenance.texturing) || '—' },
    { label: 'Last band narrowing', value: formatStoneDate(stone.lastMaintenance.bandNarrowing) || '—' },
    { label: 'Last imprinted', value: formatStoneDate(stone.lastMaintenance.imprinting) || '—' },
  ];
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</dt>
          <dd className="text-sm text-gray-900 dark:text-gray-100">{item.value}</dd>
        </div>
      ))}
      {stone.notes ? (
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes</dt>
          <dd className="whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">{stone.notes}</dd>
        </div>
      ) : null}
    </dl>
  );
}
