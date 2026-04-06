/**
 * Keep only rows that match the UI "Strong buys (2+)" tab: `consensusMultiBuys` and
 * large buy position refs (already computed only from that bucket in buildConsensusBuysDigest).
 *
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 * @returns {Record<string, unknown>}
 */
export function filterConsensusDigestToStrongBuysOnly(digest) {
  const meta =
    digest.meta && typeof digest.meta === 'object'
      ? {
          ...digest.meta,
          llmScope:
            'strong_consensus_buy_only — same as Strong buys (2+) tab; other consensus tabs omitted.',
        }
      : {
          llmScope:
            'strong_consensus_buy_only — same as Strong buys (2+) tab; other consensus tabs omitted.',
        };

  return {
    meta,
    consensusMultiBuys: digest.consensusMultiBuys || [],
    singleExpertNetBuys: [],
    consensusSells: [],
    mixedNetZero: [],
    largeBuyPositions: digest.largeBuyPositions || [],
    largeSellPositions: [],
  };
}
