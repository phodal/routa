from __future__ import annotations

from pathlib import Path

from oaiproto.coworker.pptx.utils_pb2 import PatternFill

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.formatting import VerticalAlignment


def main() -> None:
    spreadsheet = SpreadsheetArtifact("CellFillExamples")
    first_sheet = spreadsheet.sheet("Examples")

    first_sheet.range("A1:B1").set_values(
        [["Text with formatting", "Text description"]]
    ).format.text_style.bold = True

    first_sheet.set_row_heights(start_row_index=2, end_row_index=7, height=20)
    first_sheet.set_column_widths("A:B", 30)
    first_sheet.range("A2:B7").set_values(
        [
            ["Solid fill", "A solid fill with a color"],  # Row 2
            ["Pattern fill no base", "A pattern fill with no base color"],  # Row 3
            ["Pattern fill", "A pattern fill with a base color"],  # Row 4
            ["Re-using A2's style", "Re-using A2's style"],  # Row 5
            ["Re-using A3's style + align top", "Re-using A3's style + align top"],  # Row 6
            ["Re-using A4's style + italics", "Re-using A4's style + italics"],  # Row 7
        ]
    )

    first_sheet.cell("A2").format.fill.set_solid_color(rgb_color="#F2CCFF")  # lavender
    first_sheet.cell("A3").format.fill.set_pattern(
        pattern_type=PatternFill.PatternType.PATTERN_TYPE_LIGHT_VERTICAL,
        pattern_color="#A9D0F5",  # medium blue
    )
    # Note: Color displayed will be more purple than the actual color due to the base color.
    first_sheet.cell("A4").format.fill.set_pattern(
        pattern_type=PatternFill.PatternType.PATTERN_TYPE_DARK_HORIZONTAL,
        pattern_color="#1E90FF",  # dodger blue
        background_color="#D57236",  # orange background
    )

    first_sheet.cell("A5").style_index = first_sheet.cell("A2").style_index
    first_sheet.cell("A6").style_index = first_sheet.cell("A3").style_index
    first_sheet.cell("A7").style_index = first_sheet.cell("A4").style_index

    first_sheet.cell("A6").format.alignment.vertical = VerticalAlignment.TOP
    first_sheet.cell("A7").format.text_style.italic = True

    assert first_sheet.cell("A6").style_index == first_sheet.cell("A4").style_index + 1
    assert first_sheet.cell("A7").style_index == first_sheet.cell("A4").style_index + 2

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_cell_fills"
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
