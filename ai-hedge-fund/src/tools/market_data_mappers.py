"""Map stock-screener bars, Yahoo fundamentals JSON, and FMP payloads into api.py Pydantic models."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from src.data.models import (
    CompanyNews,
    FinancialMetrics,
    InsiderTrade,
    LineItem,
    Price,
)


def bars_results_to_prices(ticker: str, results: list[dict], start_date: str, end_date: str) -> list[Price]:
    """Filter bars by date range; map t,o,h,l,c,v to Price."""
    out: list[Price] = []
    s = start_date
    e = end_date
    for b in results:
        if not isinstance(b, dict):
            continue
        t_raw = b.get("t")
        if t_raw is None:
            continue
        if isinstance(t_raw, (int, float)):
            ts = t_raw / 1000.0 if t_raw > 1e12 else float(t_raw)
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            try:
                dt = datetime.fromisoformat(str(t_raw).replace("Z", "+00:00"))
            except ValueError:
                continue
        day = dt.strftime("%Y-%m-%d")
        if day < s or day > e:
            continue
        time_str = dt.isoformat()
        o = float(b.get("o", 0) or 0)
        h = float(b.get("h", 0) or 0)
        l_ = float(b.get("l", 0) or 0)
        c = float(b.get("c", 0) or 0)
        v = int(b.get("v", 0) or 0)
        if any(math.isnan(x) for x in (o, h, l_, c) if isinstance(x, float)):
            continue
        out.append(
            Price(open=o, high=h, low=l_, close=c, volume=v, time=time_str),
        )
    out.sort(key=lambda p: p.time)
    return out


def _num(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def fmp_key_metrics_row_to_financial_metrics(
    ticker: str,
    row: dict[str, Any],
    report_period: str,
    period: str = "ttm",
) -> FinancialMetrics:
    """Best-effort map FMP key-metrics-ttm (or ratios) row to FinancialMetrics."""
    cur = str(row.get("reportedCurrency") or row.get("currency") or "USD")
    return FinancialMetrics(
        ticker=ticker,
        report_period=report_period,
        period=period,
        currency=cur,
        market_cap=_num(row.get("marketCap")),
        enterprise_value=_num(row.get("enterpriseValueTTM") or row.get("enterpriseValue")),
        price_to_earnings_ratio=_num(row.get("peRatioTTM") or row.get("peRatio")),
        price_to_book_ratio=_num(row.get("pbRatioTTM") or row.get("priceToBookRatio")),
        price_to_sales_ratio=_num(row.get("priceToSalesRatioTTM") or row.get("priceToSalesRatio")),
        enterprise_value_to_ebitda_ratio=_num(row.get("enterpriseValueOverEBITDATTM")),
        enterprise_value_to_revenue_ratio=_num(row.get("evToSalesTTM") or row.get("enterpriseValueMultiple")),
        free_cash_flow_yield=_num(row.get("freeCashFlowYieldTTM")),
        peg_ratio=_num(row.get("pegRatioTTM")),
        gross_margin=_num(row.get("grossProfitMarginTTM") or row.get("grossMarginTTM")),
        operating_margin=_num(row.get("operatingProfitMarginTTM") or row.get("operatingMarginTTM")),
        net_margin=_num(row.get("netProfitMarginTTM") or row.get("netMarginTTM")),
        return_on_equity=_num(row.get("roeTTM") or row.get("returnOnEquityTTM")),
        return_on_assets=_num(row.get("returnOnAssetsTTM")),
        return_on_invested_capital=_num(row.get("returnOnInvestedCapitalTTM")),
        asset_turnover=_num(row.get("assetTurnoverTTM")),
        inventory_turnover=_num(row.get("inventoryTurnoverTTM")),
        receivables_turnover=_num(row.get("receivablesTurnoverTTM")),
        days_sales_outstanding=_num(row.get("daysOfSalesOutstandingTTM")),
        operating_cycle=_num(row.get("operatingCycleTTM")),
        working_capital_turnover=_num(row.get("workingCapitalTurnoverRatioTTM")),
        current_ratio=_num(row.get("currentRatioTTM")),
        quick_ratio=_num(row.get("quickRatioTTM")),
        cash_ratio=_num(row.get("cashRatioTTM")),
        operating_cash_flow_ratio=_num(row.get("operatingCashFlowRatioTTM")),
        debt_to_equity=_num(row.get("debtToEquityTTM") or row.get("debtToEquityRatioTTM")),
        debt_to_assets=_num(row.get("debtToAssetsTTM")),
        interest_coverage=_num(row.get("interestCoverageTTM")),
        revenue_growth=_num(row.get("revenueGrowth")),
        earnings_growth=_num(row.get("epsgrowth") or row.get("epsGrowth")),
        book_value_growth=_num(row.get("bookValuegrowth") or row.get("bookValueGrowth")),
        earnings_per_share_growth=_num(row.get("epsgrowth") or row.get("growthEPS")),
        free_cash_flow_growth=_num(row.get("freeCashFlowGrowth")),
        operating_income_growth=_num(row.get("operatingIncomeGrowth")),
        ebitda_growth=_num(row.get("ebitdagrowth") or row.get("ebitdaGrowth")),
        payout_ratio=_num(row.get("payoutRatioTTM") or row.get("dividendPayoutRatioTTM")),
        earnings_per_share=_num(row.get("netIncomePerShareTTM") or row.get("epsTTM")),
        book_value_per_share=_num(row.get("bookValuePerShareTTM")),
        free_cash_flow_per_share=_num(row.get("freeCashFlowPerShareTTM")),
    )


def fundamentals_dict_to_financial_metrics(ticker: str, f: dict[str, Any], end_date: str) -> FinancialMetrics:
    """Map GET /api/fundamentals/:ticker merged object (camelCase Yahoo raw) to FinancialMetrics."""
    return FinancialMetrics(
        ticker=ticker,
        report_period=end_date,
        period="ttm",
        currency=str(f.get("currency") or "USD"),
        market_cap=_num(f.get("marketCap")),
        enterprise_value=_num(f.get("enterpriseValue")),
        price_to_earnings_ratio=_num(f.get("trailingPE") or f.get("forwardPE")),
        price_to_book_ratio=_num(f.get("priceToBook")),
        price_to_sales_ratio=_num(f.get("priceToSalesTrailing12Months")),
        enterprise_value_to_ebitda_ratio=_num(f.get("enterpriseToEbitda")),
        enterprise_value_to_revenue_ratio=_num(f.get("enterpriseToRevenue")),
        free_cash_flow_yield=None,
        peg_ratio=_num(f.get("pegRatio")),
        gross_margin=_num(f.get("grossMargins")),
        operating_margin=_num(f.get("operatingMargins") or f.get("operatingMargin")),
        net_margin=_num(f.get("profitMargins")),
        return_on_equity=_num(f.get("returnOnEquity")),
        return_on_assets=_num(f.get("returnOnAssets")),
        return_on_invested_capital=None,
        asset_turnover=None,
        inventory_turnover=None,
        receivables_turnover=None,
        days_sales_outstanding=None,
        operating_cycle=None,
        working_capital_turnover=None,
        current_ratio=_num(f.get("currentRatio")),
        quick_ratio=_num(f.get("quickRatio")),
        cash_ratio=None,
        operating_cash_flow_ratio=None,
        debt_to_equity=_num(f.get("debtToEquity")),
        debt_to_assets=None,
        interest_coverage=None,
        revenue_growth=_num(f.get("revenueGrowth")),
        earnings_growth=_num(f.get("earningsGrowth")),
        book_value_growth=None,
        earnings_per_share_growth=None,
        free_cash_flow_growth=None,
        operating_income_growth=None,
        ebitda_growth=None,
        payout_ratio=_num(f.get("payoutRatio")),
        earnings_per_share=_num(f.get("trailingEps") or f.get("epsTrailing")),
        book_value_per_share=_num(f.get("bookValue")),
        free_cash_flow_per_share=None,
    )


def income_statement_rows_to_line_items(
    ticker: str,
    rows: list[dict[str, Any]],
    requested: list[str],
    period: str,
    limit: int,
) -> list[LineItem]:
    """Map FMP income-statement rows to LineItem (extra fields allowed)."""
    if not rows:
        return []
    out: list[LineItem] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        rp = str(row.get("date") or row.get("calendarYear") or row.get("filingDate") or "")[:10] or "2000-01-01"
        cur = str(row.get("reportedCurrency") or row.get("currency") or "USD")
        extras: dict[str, Any] = {}
        for k, v in row.items():
            if k in ("symbol", "cik", "finalLink"):
                continue
            if isinstance(v, (dict, list)):
                continue
            extras[str(k)] = v
        req_lower = [x.strip().lower() for x in requested if x.strip()]
        if req_lower:
            filtered = {
                k: v
                for k, v in extras.items()
                if any(r in k.lower() for r in req_lower)
            }
            extras = filtered if filtered else extras
        try:
            out.append(
                LineItem(
                    ticker=ticker,
                    report_period=rp,
                    period=period,
                    currency=cur,
                    **extras,
                )
            )
        except Exception:
            continue
    return out


def fmp_insider_rows_to_insider_trades(rows: list[dict[str, Any]], ticker: str) -> list[InsiderTrade]:
    out: list[InsiderTrade] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        filing_raw = r.get("filingDate") or r.get("lastDate") or r.get("transactionDate") or ""
        filing = str(filing_raw)[:10] if filing_raw else "1900-01-01"
        out.append(
            InsiderTrade(
                ticker=ticker,
                issuer=r.get("companyName") or r.get("issuer") or None,
                name=r.get("reportingName") or r.get("name") or None,
                title=r.get("typeOfOwner") or r.get("reportingTitle") or r.get("title") or None,
                is_board_director=bool(r.get("isDirector")) if r.get("isDirector") is not None else None,
                transaction_date=r.get("transactionDate") or r.get("transactionStartDate"),
                transaction_shares=_num(r.get("securitiesTransacted") or r.get("securitiesOwned")),
                transaction_price_per_share=_num(r.get("price")),
                transaction_value=_num(r.get("value")),
                shares_owned_before_transaction=_num(r.get("securitiesOwnedBeforeTransaction")),
                shares_owned_after_transaction=_num(r.get("securitiesOwnedFollowingTransaction")),
                security_title=r.get("securityName") or r.get("securityTitle"),
                filing_date=filing,
            )
        )
    return out


def fmp_news_rows_to_company_news(rows: list[dict[str, Any]], ticker: str) -> list[CompanyNews]:
    out: list[CompanyNews] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        sym = (r.get("symbol") or r.get("ticker") or "").upper()
        if sym and sym != ticker.upper():
            continue
        pub = r.get("publishedDate") or r.get("date") or ""
        if pub and "T" not in str(pub):
            pub = f"{str(pub)[:10]}T12:00:00Z"
        title = r.get("title") or r.get("text") or ""
        if not str(title).strip():
            continue
        out.append(
            CompanyNews(
                ticker=ticker,
                title=str(title)[:2000],
                author=r.get("author"),
                source=str(r.get("site") or r.get("source") or "unknown"),
                date=str(pub)[:32] if pub else "",
                url=str(r.get("url") or r.get("link") or ""),
                sentiment=r.get("sentiment") or None,
            )
        )
    return out
