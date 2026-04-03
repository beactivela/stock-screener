// Map RS ratings into compact badges. Scan RS vs IBD RS are separate sources — never merge them.

function rsTierClass(value) {
  return value >= 90 ? 'text-emerald-400'
    : value >= 80 ? 'text-green-400'
    : value >= 70 ? 'text-slate-300'
    : 'text-red-400';
}

/** RS (1–99) from this app’s latest scan (`relativeStrength` on scan-results nav) — not IBD’s rating. */
function getScanRsRatingBadge(rating) {
  if (rating == null || !Number.isFinite(rating)) {
    return {
      label: 'Scan RS: –',
      className: 'text-slate-500',
      title: 'Relative strength (1–99) from this app’s latest scan (same idea as the dashboard RS column). Ticker may be missing from that snapshot.',
    };
  }
  const value = Math.round(rating);
  return {
    label: `Scan RS: ${value}`,
    className: rsTierClass(value),
    title: 'Relative strength (1–99) from this app’s latest scan. Compare separately to IBD RS from your list import.',
  };
}

/** IBD Relative Strength (1–99) from your list CSV/export — separate from Scan RS. */
function getIbdRsRatingBadge(rating) {
  if (rating == null || !Number.isFinite(rating)) {
    return {
      label: 'IBD RS: –',
      className: 'text-slate-500',
      title: 'IBD Relative Strength Rating (1–99) from your Investor’s Business Daily list import.',
    };
  }
  const value = Math.round(rating);
  return {
    label: `IBD RS: ${value}`,
    className: rsTierClass(value),
    title: 'IBD Relative Strength Rating (1–99) from your list import. Not calculated by this app.',
  };
}

function getIndustryRankBadge(rank) {
  if (rank == null || !Number.isFinite(rank)) {
    return {
      label: 'Ind: –',
      className: 'text-slate-500',
      title: 'Industry Rank not available',
    };
  }

  const value = Math.round(rank);
  const className =
    value <= 20 ? 'text-emerald-400'
    : value <= 40 ? 'text-green-400'
    : value <= 80 ? 'text-slate-300'
    : 'text-red-400';

  return {
    label: `Ind: #${value}`,
    className,
    title: 'Industry Rank from last scan (1 = best in market)',
  };
}

/** IBD Group Relative Strength is a letter grade (e.g. A-, B+), not the scan industry rank. */
function getIbdGroupRelStrBadge(grade) {
  const g = String(grade ?? '').trim();
  if (!g) {
    return {
      label: 'Ind: –',
      className: 'text-slate-500',
      title: 'IBD Group Relative Strength not available',
    };
  }
  const first = g.charAt(0).toUpperCase();
  const className =
    first === 'A' ? 'text-emerald-400'
    : first === 'B' ? 'text-green-400'
    : first === 'C' ? 'text-slate-300'
    : 'text-red-400';

  return {
    label: `Ind: ${g}`,
    className,
    title: 'IBD Group Relative Strength Rating (letter grade) from your list import — not the same as scan Industry Rank (#)',
  };
}

export {
  getIbdGroupRelStrBadge,
  getIbdRsRatingBadge,
  getIndustryRankBadge,
  getScanRsRatingBadge,
};
