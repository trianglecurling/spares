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

  test('social membership in fall still allows winter-only discount on winter regular membership', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        fall: { membershipType: 'social', iceTime: 'none' },
        winter: { membershipType: 'regular', iceTime: '1_league' },
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(5000);
    expect(estimate.winter.totalMinor).toBe(27000);
    expect(estimate.annualTotalMinor).toBe(32000);
  });

  test('regular membership in fall waives winter social membership fee', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        fall: { membershipType: 'regular', iceTime: '1_league' },
        winter: { membershipType: 'social', iceTime: 'none' },
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(32000);
    expect(estimate.winter.totalMinor).toBe(0);
    expect(estimate.annualTotalMinor).toBe(32000);
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

  test('annual benefits apply when any session has a membership selection', () => {
    const regularBothSessions = buildBenefits({
      fall: { membershipType: 'regular', iceTime: 'spare_only' },
      winter: { membershipType: 'regular', iceTime: '1_league' },
    });
    expect(regularBothSessions.annual.length).toBeGreaterThan(0);
    expect(regularBothSessions.annual).toContain(
      'Ability to participate in the Triangle Club Bonspiel (usually in March/April)',
    );

    const socialFallOnly = buildBenefits({
      fall: { membershipType: 'social', iceTime: 'none' },
      winter: { membershipType: 'none', iceTime: 'none' },
    });
    expect(socialFallOnly.annual.length).toBeGreaterThan(0);
    expect(socialFallOnly.annual).not.toContain(
      'Ability to participate in the Triangle Club Bonspiel (usually in March/April)',
    );

    const noMembership = buildBenefits({
      fall: { membershipType: 'none', iceTime: 'none' },
      winter: { membershipType: 'none', iceTime: 'none' },
    });
    expect(noMembership.annual).toHaveLength(0);
  });

  test('three leagues are charged at the default league fee', () => {
    const estimate = estimateAnnualDuesWithSettings(
      {
        ...baseInput,
        fall: { membershipType: 'regular', iceTime: '3_leagues' },
      },
      testSettings,
    );

    expect(estimate.fall.totalMinor).toBe(56000);
  });
});
