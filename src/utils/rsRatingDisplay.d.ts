export type RsRatingBadge = {
  label: string;
  className: string;
  title: string;
};

export function getRsRatingBadge(rating: number | null): RsRatingBadge;
export function getIndustryRankBadge(rank: number | null): RsRatingBadge;
