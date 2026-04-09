import datetime
import logging
import os
import pandas as pd
import requests
import time

logger = logging.getLogger(__name__)

from src.data.cache import get_cache
from src.data.models import (
    CompanyNews,
    CompanyNewsResponse,
    FinancialMetrics,
    FinancialMetricsResponse,
    Price,
    PriceResponse,
    LineItem,
    LineItemResponse,
    InsiderTrade,
    InsiderTradeResponse,
    CompanyFactsResponse,
)
from src.tools.market_data_env import get_market_data_mode, has_financial_datasets_key
from src.tools.stock_screener_client import fetch_bars_json, fetch_fundamentals_json
from src.tools.fmp_proxy_client import fmp_proxy_get
from src.tools.market_data_mappers import (
    bars_results_to_prices,
    fmp_key_metrics_row_to_financial_metrics,
    fundamentals_dict_to_financial_metrics,
    income_statement_rows_to_line_items,
    fmp_insider_rows_to_insider_trades,
    fmp_news_rows_to_company_news,
)
from src.tools.supabase_market_data import supabase_get_prices

_cache = get_cache()


def _make_api_request(url: str, headers: dict, method: str = "GET", json_data: dict = None, max_retries: int = 3) -> requests.Response:
    for attempt in range(max_retries + 1):
        if method.upper() == "POST":
            response = requests.post(url, headers=headers, json=json_data)
        else:
            response = requests.get(url, headers=headers)

        if response.status_code == 429 and attempt < max_retries:
            delay = 60 + (30 * attempt)
            print(f"Rate limited (429). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay}s before retrying...")
            time.sleep(delay)
            continue

        return response


# ─── Financial Datasets (legacy) ─────────────────────────────────────────────


def _fd_get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    cache_key = f"{ticker}_{start_date}_{end_date}"
    if cached_data := _cache.get_prices(cache_key):
        return [Price(**price) for price in cached_data]

    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = f"https://api.financialdatasets.ai/prices/?ticker={ticker}&interval=day&interval_multiplier=1&start_date={start_date}&end_date={end_date}"
    response = _make_api_request(url, headers)
    if response.status_code != 200:
        return []

    try:
        price_response = PriceResponse(**response.json())
        prices = price_response.prices
    except Exception as e:
        logger.warning("Failed to parse price response for %s: %s", ticker, e)
        return []

    if not prices:
        return []

    _cache.set_prices(cache_key, [p.model_dump() for p in prices])
    return prices


def _fd_get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    if cached_data := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**metric) for metric in cached_data]

    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = f"https://api.financialdatasets.ai/financial-metrics/?ticker={ticker}&report_period_lte={end_date}&limit={limit}&period={period}"
    response = _make_api_request(url, headers)
    if response.status_code != 200:
        return []

    try:
        metrics_response = FinancialMetricsResponse(**response.json())
        financial_metrics = metrics_response.financial_metrics
    except Exception as e:
        logger.warning("Failed to parse financial metrics response for %s: %s", ticker, e)
        return []

    if not financial_metrics:
        return []

    _cache.set_financial_metrics(cache_key, [m.model_dump() for m in financial_metrics])
    return financial_metrics


def _fd_search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = "https://api.financialdatasets.ai/financials/search/line-items"

    body = {
        "tickers": [ticker],
        "line_items": line_items,
        "end_date": end_date,
        "period": period,
        "limit": limit,
    }
    response = _make_api_request(url, headers, method="POST", json_data=body)
    if response.status_code != 200:
        return []

    try:
        data = response.json()
        response_model = LineItemResponse(**data)
        search_results = response_model.search_results
    except Exception as e:
        logger.warning("Failed to parse line items response for %s: %s", ticker, e)
        return []
    if not search_results:
        return []

    return search_results[:limit]


def _fd_get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_insider_trades(cache_key):
        return [InsiderTrade(**trade) for trade in cached_data]

    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    all_trades = []
    current_end_date = end_date

    while True:
        url = f"https://api.financialdatasets.ai/insider-trades/?ticker={ticker}&filing_date_lte={current_end_date}"
        if start_date:
            url += f"&filing_date_gte={start_date}"
        url += f"&limit={limit}"

        response = _make_api_request(url, headers)
        if response.status_code != 200:
            break

        try:
            data = response.json()
            response_model = InsiderTradeResponse(**data)
            insider_trades = response_model.insider_trades
        except Exception as e:
            logger.warning("Failed to parse insider trades response for %s: %s", ticker, e)
            break

        if not insider_trades:
            break

        all_trades.extend(insider_trades)

        if not start_date or len(insider_trades) < limit:
            break

        current_end_date = min(trade.filing_date for trade in insider_trades).split("T")[0]

        if current_end_date <= start_date:
            break

    if not all_trades:
        return []

    _cache.set_insider_trades(cache_key, [trade.model_dump() for trade in all_trades])
    return all_trades


def _fd_get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_company_news(cache_key):
        return [CompanyNews(**news) for news in cached_data]

    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    all_news = []
    current_end_date = end_date

    while True:
        url = f"https://api.financialdatasets.ai/news/?ticker={ticker}&end_date={current_end_date}"
        if start_date:
            url += f"&start_date={start_date}"
        url += f"&limit={limit}"

        response = _make_api_request(url, headers)
        if response.status_code != 200:
            break

        try:
            data = response.json()
            response_model = CompanyNewsResponse(**data)
            company_news = response_model.news
        except Exception as e:
            logger.warning("Failed to parse company news response for %s: %s", ticker, e)
            break

        if not company_news:
            break

        all_news.extend(company_news)

        if not start_date or len(company_news) < limit:
            break

        current_end_date = min(news.date for news in company_news).split("T")[0]

        if current_end_date <= start_date:
            break

    if not all_news:
        return []

    _cache.set_company_news(cache_key, [news.model_dump() for news in all_news])
    return all_news


# ─── Stock-screener + FMP proxy (composite / stock_screener) ─────────────────


def _screener_get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    cache_key = f"{ticker}_{start_date}_{end_date}"
    if cached_data := _cache.get_prices(cache_key):
        return [Price(**price) for price in cached_data]

    payload = fetch_bars_json(ticker, start_date, end_date)
    if not payload or not isinstance(payload.get("results"), list):
        return []

    prices = bars_results_to_prices(ticker.upper(), payload["results"], start_date, end_date)
    if not prices:
        return []

    _cache.set_prices(cache_key, [p.model_dump() for p in prices])
    return prices


def _fmp_first_row_list(data) -> dict | None:
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict) and data:
        return data
    return None


def _composite_get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    if cached_data := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**metric) for metric in cached_data]

    sym = ticker.upper().strip()
    rows: list[FinancialMetrics] = []

    data, err = fmp_proxy_get("/key-metrics-ttm", {"symbol": sym})
    if err:
        logger.debug("key-metrics-ttm %s: %s", sym, err)
    row = _fmp_first_row_list(data)
    if row:
        rows.append(fmp_key_metrics_row_to_financial_metrics(sym, row, end_date, period))

    if not rows:
        fund = fetch_fundamentals_json(sym)
        if fund:
            rows.append(fundamentals_dict_to_financial_metrics(sym, fund, end_date))

    if not rows:
        return []

    _cache.set_financial_metrics(cache_key, [m.model_dump() for m in rows[:limit]])
    return rows[:limit]


def _stock_screener_only_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    if cached_data := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**metric) for metric in cached_data]

    sym = ticker.upper().strip()
    fund = fetch_fundamentals_json(sym)
    if not fund:
        return []
    m = fundamentals_dict_to_financial_metrics(sym, fund, end_date)
    _cache.set_financial_metrics(cache_key, [m.model_dump()])
    return [m]


def _composite_search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    sym = ticker.upper().strip()
    data, err = fmp_proxy_get(
        "/income-statement",
        {"symbol": sym, "period": "quarter", "limit": min(limit, 20)},
    )
    if err:
        logger.debug("income-statement %s: %s", sym, err)
        return []
    if not isinstance(data, list):
        return []
    return income_statement_rows_to_line_items(sym, data, line_items, period, limit)


def _composite_get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_insider_trades(cache_key):
        return [InsiderTrade(**trade) for trade in cached_data]

    sym = ticker.upper().strip()
    cap = min(limit, 100)
    data, err = fmp_proxy_get(
        "/insider-trading/search",
        {"symbol": sym, "page": 0, "limit": cap},
    )
    if err:
        logger.debug("insider-trading %s: %s", sym, err)
        return []
    if not isinstance(data, list):
        return []
    trades = fmp_insider_rows_to_insider_trades(data, sym)
    if start_date:
        trades = [t for t in trades if t.filing_date and t.filing_date >= start_date[:10]]
    if end_date:
        trades = [t for t in trades if not t.filing_date or t.filing_date <= end_date[:10]]
    if not trades:
        return []

    _cache.set_insider_trades(cache_key, [trade.model_dump() for trade in trades])
    return trades


def _composite_get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    if cached_data := _cache.get_company_news(cache_key):
        return [CompanyNews(**news) for news in cached_data]

    sym = ticker.upper().strip()
    data, err = fmp_proxy_get("/news/stock-latest", {"page": 0, "limit": min(limit, 50)})
    if err:
        logger.debug("news/stock-latest: %s", err)
        return []
    if not isinstance(data, list):
        return []
    news = fmp_news_rows_to_company_news(data, sym)
    if not news:
        return []

    _cache.set_company_news(cache_key, [n.model_dump() for n in news])
    return news


def _composite_get_market_cap(ticker: str, end_date: str, api_key: str = None) -> float | None:
    sym = ticker.upper().strip()
    if end_date == datetime.datetime.now().strftime("%Y-%m-%d"):
        data, err = fmp_proxy_get("/profile", {"symbol": sym})
        if err:
            logger.debug("profile %s: %s", sym, err)
        else:
            row = _fmp_first_row_list(data)
            if row:
                mc = row.get("mktCap") or row.get("marketCap")
                if mc is not None:
                    try:
                        return float(mc)
                    except (TypeError, ValueError):
                        pass

    metrics = _composite_get_financial_metrics(sym, end_date, api_key=api_key)
    if metrics and metrics[0].market_cap is not None:
        return metrics[0].market_cap
    return None


def _fd_get_market_cap(ticker: str, end_date: str, api_key: str = None) -> float | None:
    if end_date == datetime.datetime.now().strftime("%Y-%m-%d"):
        headers = {}
        financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
        if financial_api_key:
            headers["X-API-KEY"] = financial_api_key

        url = f"https://api.financialdatasets.ai/company/facts/?ticker={ticker}"
        response = _make_api_request(url, headers)
        if response.status_code != 200:
            print(f"Error fetching company facts: {ticker} - {response.status_code}")
            return None

        data = response.json()
        response_model = CompanyFactsResponse(**data)
        return response_model.company_facts.market_cap

    financial_metrics = _fd_get_financial_metrics(ticker, end_date, api_key=api_key)
    if not financial_metrics:
        return None

    market_cap = financial_metrics[0].market_cap

    if not market_cap:
        return None

    return market_cap


# ─── Public API ──────────────────────────────────────────────────────────────


def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_get_prices(ticker, start_date, end_date, api_key=api_key)
    if mode == "supabase":
        p = supabase_get_prices(ticker, start_date, end_date)
        if p:
            return p
    return _screener_get_prices(ticker, start_date, end_date, api_key=api_key)


def get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_get_financial_metrics(ticker, end_date, period, limit, api_key=api_key)
    if mode == "stock_screener":
        return _stock_screener_only_financial_metrics(ticker, end_date, period, limit, api_key=api_key)
    if mode == "supabase":
        return _stock_screener_only_financial_metrics(ticker, end_date, period, limit, api_key=api_key)
    return _composite_get_financial_metrics(ticker, end_date, period, limit, api_key=api_key)


def search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_search_line_items(ticker, line_items, end_date, period, limit, api_key=api_key)
    if mode in ("composite", "stock_screener", "supabase"):
        return _composite_search_line_items(ticker, line_items, end_date, period, limit, api_key=api_key)
    return []


def get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_get_insider_trades(ticker, end_date, start_date, limit, api_key=api_key)
    if mode in ("composite", "stock_screener", "supabase"):
        return _composite_get_insider_trades(ticker, end_date, start_date, limit, api_key=api_key)
    return []


def get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_get_company_news(ticker, end_date, start_date, limit, api_key=api_key)
    if mode in ("composite", "stock_screener", "supabase"):
        return _composite_get_company_news(ticker, end_date, start_date, limit, api_key=api_key)
    return []


def get_market_cap(
    ticker: str,
    end_date: str,
    api_key: str = None,
) -> float | None:
    mode = get_market_data_mode()
    if mode == "financial_datasets" and has_financial_datasets_key():
        return _fd_get_market_cap(ticker, end_date, api_key=api_key)
    return _composite_get_market_cap(ticker, end_date, api_key=api_key)


def prices_to_df(prices: list[Price]) -> pd.DataFrame:
    df = pd.DataFrame([p.model_dump() for p in prices])
    df["Date"] = pd.to_datetime(df["time"])
    df.set_index("Date", inplace=True)
    numeric_cols = ["open", "close", "high", "low", "volume"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df.sort_index(inplace=True)
    return df


def get_price_data(ticker: str, start_date: str, end_date: str, api_key: str = None) -> pd.DataFrame:
    prices = get_prices(ticker, start_date, end_date, api_key=api_key)
    return prices_to_df(prices)
