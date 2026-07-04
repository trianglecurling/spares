import { describe, expect, test } from 'bun:test';
import {
  buildBenefits,
  estimateAnnualDuesWithSettings,
  type DuesEstimateInput,
} from './duesEstimatorLogic.js';

const testSettings = {
  season: { id: 1, name: '2025-2026', startDate: '2025-09-01', endDate: '2026-08-31' },
  fallSession: { id: 10, seasonId: 1, name: 'Fall', startDate: '2025-09-01', endDate: '2025-12-31' },
  winterSession: { id: 11, seasonId: 1, name: 'Winter', startDate: '2026-01-01', endDate: '2026-05-31' },
  priceConfig: {
    regularMembershipFeeMinor: 20000,
    socialMembershipFeeMinor: 5000,
    spareOnlyIcePrivilegeFeeMinor: 8000,
    sabbaticalFeeMinor: 5000,
    juniorRecreationalFeeMinor: 10000,
    defaultLeagueFeeMinor: 12000,
  },
  discountSettings: {
    student: { amountType: 'percent' as const, amountValue: 30 },
    reciprocal: { amountType: 'dollar' as const, amountValue: 7500 },
    winterOnly: { amountType: 'dollar' as const, amountValue: 5000 },
  },
};

describe('duesEstimatorService', () => {
  const baseInput: DuesEstimateInput = {
    fall: { membershipType: 'none', iceTime: 'none' },
    winter: { membershipType: 'none', iceTime: 'none' },
    studentDiscount: false,
    reciprocalDiscount: false,
  };

  test('regular membership in fall plus one league each session charges membership once', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        fall: { membershipType: 'regular', iceTime: '1_league' },
        winter: { membershipType: 'regular', iceTime: '1_league' },
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(32000);
    expect(estimate.winter.totalMinor).toBe(12000);
    expect(estimate.annualTotalMinor).toBe(44000);
  });

  test('winter-only regular membership receives winter-only discount on membership', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        winter: { membershipType: 'regular', iceTime: '1_league' },
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(0);
    expect(estimate.winter.totalMinor).toBe(27000);
    expect(estimate.annualTotalMinor).toBe(27000);
  });

  test('student discount applies to membership and leagues', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        fall: { membershipType: 'regular', iceTime: '1_league' },
        winter: { membershipType: 'regular', iceTime: '1_league' },
        studentDiscount: true,
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(22400);
    expect(estimate.winter.totalMinor).toBe(8400);
    expect(estimate.annualTotalMinor).toBe(30800);
  });

  test('benefits include annual list when curling in both sessions', () => {
    const benefits = buildBenefits({
      fall: { membershipType: 'regular', iceTime: '1_league' },
      winter: { membershipType: 'regular', iceTime: '1_league' },
    });

    expect(benefits.annual.length).toBeGreaterThan(0);
    expect(benefits.fall.length).toBeGreaterThan(0);
    expect(benefits.winter.length).toBeGreaterThan(0);
  });
});
