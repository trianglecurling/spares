import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';

export type RegistrationBillingOwedLine = {
  description: string;
  amountMinor: number;
};

type RegistrationBillingOwedModalProps = {
  isOpen: boolean;
  curlerName: string;
  lines: RegistrationBillingOwedLine[];
  discountLines: RegistrationBillingOwedLine[];
  subtotalMinor: number;
  discountMinor: number;
  owedMinor: number;
  onClose: () => void;
};

function money(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function LineRow({ description, amountMinor }: RegistrationBillingOwedLine) {
  const discount = amountMinor < 0;
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-800 dark:text-gray-200">{description}</span>
      <span
        className={`whitespace-nowrap tabular-nums ${
          discount ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {money(amountMinor)}
      </span>
    </div>
  );
}

export default function RegistrationBillingOwedModal({
  isOpen,
  curlerName,
  lines,
  discountLines,
  subtotalMinor,
  discountMinor,
  owedMinor,
  onClose,
}: RegistrationBillingOwedModalProps) {
  const hasLines = lines.length > 0 || discountLines.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Owed for ${curlerName}`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Current membership, rostered leagues, sabbaticals, discounts, and name tags.
        </p>
        {hasLines ? (
          <>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <LineRow key={`charge-${index}-${line.description}`} {...line} />
              ))}
              {discountLines.map((line, index) => (
                <LineRow key={`discount-${index}-${line.description}`} {...line} />
              ))}
            </div>
            <dl className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-800/40">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-gray-700 dark:text-gray-300">Subtotal</dt>
                <dd className="m-0 tabular-nums text-sm font-medium text-gray-900 dark:text-gray-100">
                  {money(subtotalMinor)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-gray-700 dark:text-gray-300">Discounts</dt>
                <dd
                  className={`m-0 tabular-nums text-sm font-medium ${
                    discountMinor > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {discountMinor > 0 ? `−${money(discountMinor)}` : money(0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-gray-200 pt-3 dark:border-gray-600">
                <dt className="text-sm font-semibold text-gray-700 dark:text-gray-300">Owed</dt>
                <dd className="m-0 tabular-nums text-base font-semibold text-gray-900 dark:text-gray-100">
                  {money(owedMinor)}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <InlineStateMessage title="No charges" description={`${curlerName} currently owes ${money(owedMinor)}.`} />
        )}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
