// Map RS rating values into a compact badge configuration.
function getRsRatingBadge(rating) {
  if (rating == null || !Number.isFinite(rating)) {
    return {
      label: 'RS: –',
      className: 'text-slate-500',
      title: 'RS Rating not available',
    };
  }

  const value = Math.round(rating);
  const className =
    value >= 90 ? 'text-emerald-400'
    : value >= 80 ? 'text-green-400'
    : value >= 70 ? 'text-slate-300'
    : 'text-red-400';

  return {
    label: `RS: ${value}`,
    className,
    title: 'IBD-style RS Rating (1–99)',
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
    title: 'Industry Rank (1 = best in market)',
  };
}

export { getIndustryRankBadge, getRsRatingBadge };
