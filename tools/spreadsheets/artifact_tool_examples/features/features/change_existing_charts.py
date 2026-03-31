from __future__ import annotations

from pathlib import Path

from artifact_tool import SpreadsheetArtifact


def main() -> None:
    file_path = Path(__file__).resolve().parent / ".." / "sample_xlsx" / "weather_sf.xlsx"
    spreadsheet = SpreadsheetArtifact.read(file_path=file_path)

    dashboard = spreadsheet.sheet("Dashboard")

    print(f"Charts before deletion: {len(dashboard.charts)}")
    for i, chart in enumerate(dashboard.charts):
        print(f"Chart {i}: {chart.title}")

    del dashboard.charts[0]

    print(f"Charts after deletion: {len(dashboard.charts)}")
    for i, chart in enumerate(dashboard.charts):
        print(f"Chart {i}: {chart.title}")


if __name__ == "__main__":
    main()
