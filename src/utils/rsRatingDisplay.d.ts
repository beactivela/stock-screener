export type RsRatingBadge = {
  label: string;
  className: string;
  title: string;
};

export function getScanRsRatingBadge(rating: number | null | undefined): RsRatingBadge;
export function getIbdRsRatingBadge(rating: number | null | undefined): RsRatingBadge;
export function getIndustryRankBadge(rank: number | null | undefined): RsRatingBadge;
export function getIbdGroupRelStrBadge(grade: string | null | undefined): RsRatingBadge;
