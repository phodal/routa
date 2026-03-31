from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("Scores")
    first_sheet = spreadsheet.sheet("FirstGame")

    # Column widths.
    first_sheet.set_column_widths_bulk({"B": 20, "C": 10, "D": 2, "E": 2})

    assert first_sheet.get_column_width("B") == 20
    assert first_sheet.get_column_width("C") == 10

    # Row heights.
    first_sheet.set_sheet_styles(default_row_height=15.75)
    first_sheet.set_row_height(2, 35.25)
    first_sheet.set_row_height(4, 20.0)
    assert first_sheet.default_row_height == 15.75

    # Add text in rows with custom heights so the height differences are visible
    first_sheet.cell("B2").set_value("Row height 35.25")
    first_sheet.cell("B4").set_value("Row height 20.0")

    first_sheet.cell("B8").set_value("Column width 20")
    first_sheet.cell("C8").set_value("Column width 10")
    first_sheet.cell("D8").set_value("Column width 2")
    first_sheet.cell("E8").set_value("Column width 2")

    # Inspect proto->dict verification.
    output_dir = (
        Path(__file__).resolve().parent / "golden_rendered_images" / "set_cell_width_height"
    )
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
