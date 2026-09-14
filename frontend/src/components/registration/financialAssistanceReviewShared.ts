export const FINANCIAL_ASSISTANCE_PERCENTS = [0, 25, 50, 75] as const;

export type FinancialAssistancePercent = (typeof FINANCIAL_ASSISTANCE_PERCENTS)[number];

export type FinancialAssistanceReviewStatus = 'approved' | 'partially_approved' | 'denied';

export type FinancialAssistanceReviewSummary = {
  requestId: number;
  requestedPercent: number;
  approvedPercent: number | null;
  status: string;
};

export function financialAssistanceReviewDecision(
  requestedPercent: number,
  approvedPercent: number,
): {
  status: FinancialAssistanceReviewStatus;
  approvedPercentage: number;
} {
  const approvedPercentage = Math.max(0, Math.min(100, approvedPercent));
  if (approvedPercentage <= 0) {
    return { status: 'denied', approvedPercentage: 0 };
  }
  if (approvedPercentage === requestedPercent) {
    return { status: 'approved', approvedPercentage };
  }
  return { status: 'partially_approved', approvedPercentage };
}

export function financialAssistancePercentOptions(requestedPercent: number): Array<{
  value: string;
  label: string;
}> {
  const percents = new Set<number>(FINANCIAL_ASSISTANCE_PERCENTS);
  if (Number.isFinite(requestedPercent)) percents.add(requestedPercent);
  return [...percents]
    .filter((percent) => percent >= 0)
    .sort((left, right) => left - right)
    .map((percent) => ({
      value: String(percent),
      label:
        percent === 0
          ? 'No assistance (0%)'
          : percent === requestedPercent
            ? `${percent}% (requested)`
            : `${percent}%`,
    }));
}

export function defaultApprovedAssistancePercent(assistance: {
  requestedPercent: number;
  approvedPercent: number | null;
  status: string;
}): number {
  if (assistance.approvedPercent != null && assistance.status !== 'pending') {
    return assistance.approvedPercent;
  }
  return assistance.requestedPercent;
}

export function canReviewFinancialAssistance(
  assistance:
    | {
        requestId?: number | null;
        requestedPercent: number;
        approvedPercent: number | null;
        status: string;
      }
    | null
    | undefined,
): assistance is FinancialAssistanceReviewSummary {
  return assistance != null && Number.isInteger(assistance.requestId) && (assistance.requestId ?? 0) > 0;
}
