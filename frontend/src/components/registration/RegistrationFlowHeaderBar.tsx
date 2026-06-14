import { memo } from 'react';
import Button from '../Button';

type RegistrationFlowHeaderBarProps = {
  backLabel: string;
  onBack: () => void;
  headerTitle: string;
  showStartOver: boolean;
  loading: boolean;
  onStartOver: () => void;
};

function RegistrationFlowHeaderBar({
  backLabel,
  onBack,
  headerTitle,
  showStartOver,
  loading,
  onStartOver,
}: RegistrationFlowHeaderBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-emerald-100 pb-4">
      <div className="order-1 shrink-0">
        <Button type="button" variant="secondary" className="text-sm" onClick={onBack}>
          {backLabel}
        </Button>
      </div>
      {headerTitle ? (
        <p className="order-3 w-full basis-full text-center text-sm font-medium text-gray-700 sm:order-2 sm:w-auto sm:flex-1 sm:basis-auto">
          {headerTitle}
        </p>
      ) : null}
      <div className="order-2 ms-auto shrink-0 sm:order-3 sm:ms-0">
        {showStartOver ? (
          <Button type="button" variant="secondary" className="text-sm" disabled={loading} onClick={onStartOver}>
            Start over
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default memo(RegistrationFlowHeaderBar);
