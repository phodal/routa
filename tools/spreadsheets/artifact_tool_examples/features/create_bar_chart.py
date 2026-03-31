from __future__ import annotations

from pathlib import Path

from oaiproto.coworker.pptx.chart_pb2 import BarDirection, BarGrouping, Chart

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.models.charts import BarChart


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("Scores")
    game_sheet = spreadsheet.sheet("MyFavoriteGame")

    # Seed some data
    game_sheet["A1:C1"].values = [["Player", "Game 1", "Game 2"]]
    game_sheet["A2:C5"].values = [
        ["Vicky", 120, 100],
        ["Emily", 134, 95],
        ["Dibyo", 95, 110],
        ["Bobby", 105, 105],
    ]

    # Set up some ranges to use as labels (categories) and values for the charts
    labels = game_sheet.range("A2:A5")
    game1 = game_sheet.range("B2:B5")
    game2 = game_sheet.range("C2:C5")

    # Add a vertical bar chart to the cell range E2:I14
    chart1 = game_sheet.charts.add(
        game_sheet.range("E2:I14"),
        Chart.ChartType.CHART_TYPE_BAR,
        title="Game Scores",
    )
    chart1.add_series("Game 1", categories_range=labels, values_range=game1)
    chart1.add_series("Game 2", categories_range=labels, values_range=game2)

    # Add a horizontal bar chart to the cell range E17:I29
    chart2 = game_sheet.charts.add(
        game_sheet.range("E17:I29"),
        Chart.ChartType.CHART_TYPE_BAR,
        title="Total Scores",
    )
    assert isinstance(chart2, BarChart)
    chart2.bar_direction = BarDirection.BAR_DIRECTION_BAR
    chart2.bar_grouping = BarGrouping.BAR_GROUPING_STACKED
    chart2.add_series("Game 1", categories_range=labels, values_range=game1)
    chart2.add_series("Game 2", categories_range=labels, values_range=game2)

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "create_bar_chart"
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path}")

    spreadsheet.save(
        file_type=FileOutputType.C_STAR_PROTO_JSON,
        filename=output_dir / "workbook__auto.json",
        overwrite=True,
    )

    # output_path = spreadsheet.export()
    # print(f"Spreadsheet exported to {output_path}")


if __name__ == "__main__":
    main()
