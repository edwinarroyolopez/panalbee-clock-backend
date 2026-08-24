import type { AffiliateFinanceBalanceView } from './affiliate-detail.view';

export interface ExpectedBalanceRow {
  _id: string;
  expectedMinor: number;
}

export interface LedgerBalanceRow {
  _id: string;
  creditsMinor: number;
  reversalsMinor: number;
  paidMinor: number;
}

export interface ReservedBalanceRow {
  _id: string;
  reservedMinor: number;
}

export function affiliateBalanceViews(
  expectedRows: ExpectedBalanceRow[],
  ledgerRows: LedgerBalanceRow[],
  reservedRows: ReservedBalanceRow[],
): AffiliateFinanceBalanceView[] {
  const expectedByCurrency = new Map(
    expectedRows.map(({ _id, expectedMinor }) => [_id, expectedMinor]),
  );
  const ledgerByCurrency = new Map(ledgerRows.map((item) => [item._id, item]));
  const reservedByCurrency = new Map(
    reservedRows.map(({ _id, reservedMinor }) => [_id, reservedMinor]),
  );
  const currencies = new Set([
    ...expectedByCurrency.keys(),
    ...ledgerByCurrency.keys(),
    ...reservedByCurrency.keys(),
  ]);
  return [...currencies].sort().map((currency) => {
    const ledger = ledgerByCurrency.get(currency);
    const earnedMinor =
      (ledger?.creditsMinor ?? 0) - (ledger?.reversalsMinor ?? 0);
    const paidMinor = ledger?.paidMinor ?? 0;
    const reservedMinor = reservedByCurrency.get(currency) ?? 0;
    const balanceMinor = earnedMinor - paidMinor;
    return {
      currency,
      expectedMinor: expectedByCurrency.get(currency) ?? 0,
      earnedMinor,
      paidMinor,
      reservedMinor,
      balanceMinor,
      availableMinor: balanceMinor - reservedMinor,
    };
  });
}
