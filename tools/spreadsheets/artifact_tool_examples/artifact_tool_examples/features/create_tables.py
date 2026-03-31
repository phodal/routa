from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("Scores")
    first_sheet = spreadsheet.sheet("FirstGame")

    # Seed some data
    first_sheet.range("A1:C1").set_values([["Player", "Game", "Score"]])
    first_sheet.range("A2:C5").set_values(
        [
            ["Vicky", "1", 100],
            ["Emily", "1", 95],
            ["Dibyo", "2", 110],
            ["Bobby", "2", 105],
        ]
    )

    # Create a table over the data range
    table = first_sheet.add_table(
        "A1:C5", has_headers=True, name="ScoresTable", style_name="TableStyleMedium2"
    )
    table.set_style(show_row_stripes=True)

    # Expand only the last two columns and the first two rows to compare
    first_sheet.set_column_widths("B:C", 24)
    for row_idx in range(1, 3):
        first_sheet.set_row_height(row_idx, 28)

    # Inspect proto->dict verification.
    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "create_tables"
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path}")

    # output_path = spreadsheet.export()
    # print(f"Spreadsheet exported to {output_path}")

    spreadsheet.save(
        file_type=FileOutputType.C_STAR_PROTO_JSON,
        filename=output_dir / "workbook__auto.json",
        overwrite=True,
    )


if __name__ == "__main__":
    main()
