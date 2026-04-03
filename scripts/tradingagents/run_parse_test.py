"""Unit tests for scripts/tradingagents/run.py analyst CSV parsing. Run:

  .venv-tradingagents/bin/python scripts/tradingagents/run_parse_test.py

  or: .venv-tradingagents/bin/python -m unittest scripts/tradingagents/run_parse_test.py
"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


def _load_run_module():
    run_path = Path(__file__).resolve().parent / "run.py"
    spec = importlib.util.spec_from_file_location("tradingagents_run_for_test", run_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ParseAnalystCsvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Name must not be `run` — shadows unittest.TestCase.run().
        cls.run_mod = _load_run_module()

    def test_empty_string_uses_full_default_order(self):
        self.assertEqual(
            self.run_mod._parse_analyst_csv(""),
            list(self.run_mod.DEFAULT_ANALYSTS_ORDER),
        )

    def test_dedupes_preserving_order(self):
        self.assertEqual(
            self.run_mod._parse_analyst_csv("market,news,market"),
            ["market", "news"],
        )

    def test_invalid_raises(self):
        with self.assertRaises(ValueError):
            self.run_mod._parse_analyst_csv("market,not_an_analyst")

    def test_subset(self):
        self.assertEqual(
            self.run_mod._parse_analyst_csv("fundamentals,market"),
            ["fundamentals", "market"],
        )


if __name__ == "__main__":
    unittest.main()
