export function buildNewsPrompt({ ticker, date, volumeContext, articles = [] } = {}) {
  const cleanTicker = String(ticker || '').trim().toUpperCase();
  const cleanDate = String(date || '').trim();

  const header = `Find the most likely news catalyst for ${cleanTicker} on ${cleanDate}.`;
  const context = volumeContext
    ? [
        `Volume context:`,
        `- Volume: ${volumeContext.volume ?? 'n/a'}`,
        `- 20d avg volume: ${volumeContext.avgVolume ?? 'n/a'}`,
        `- Volume ratio: ${volumeContext.ratio ?? 'n/a'}`,
        `- Close: ${volumeContext.close ?? 'n/a'}`,
        `- Day change: ${volumeContext.changePct != null ? `${volumeContext.changePct}%` : 'n/a'}`,
      ].join('\n')
    : 'Volume context: n/a';

  const newsList = articles.length
    ? [
        `Articles (Yahoo Finance first; use these as evidence):`,
        ...articles.map((a) => `- ${a.title} (${a.source || 'source'}): ${a.url}`),
      ].join('\n')
    : 'No relevant news found in the provided sources.';

  return [
    header,
    '',
    context,
    '',
    newsList,
    '',
    'Task: Summarize why price + volume moved on that date. Be concise, cite article titles, and call out uncertainty if evidence is thin.',
  ].join('\n');
}
