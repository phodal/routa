from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.formatting import HorizontalAlignment, VerticalAlignment


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("TextStyles")
    sheet = spreadsheet.sheet("Examples")

    # Seed some data
    sheet.set_column_widths("B:C", 30)  # so we can see the alignments
    sheet.set_row_heights(start_row_index=2, end_row_index=31, height=40)
    sheet.range("A1:B1").set_values([["Priority", "Text w/ formatting"]])
    sheet.range("A3:B31").set_values(
        [
            ["p1", "Bottom align (default)"],  # Row 3
            [None, None],
            ["p1", "Bottom align"],  # Row 5
            [None, None],
            ["p1", "Center align"],  # Row 7
            [None, None],
            ["p1", "Top align"],  # Row 9
            [None, None],
            ["p1", "Left align"],  # Row 11
            [None, None],
            ["p1", "Center align"],  # Row 13
            [None, None],
            ["p1", "Right align"],  # Row 15
            [None, None],
            ["p2", "Indented text"],  # Row 17
            [None, None],
            ["p2", "More Indented text"],  # Row 19
            [None, None],
            ["p3", "Angled Text Up"],  # Row 21
            [None, None],
            ["p3", "Angled Text Down"],  # Row 23
            [None, None],
            ["p3", "Vertical"],  # Row 25
            [None, None],
            ["p3", "Rotated up"],  # Row 27
            [None, None],
            ["p3", "Rotated down"],  # Row 29
            [None, None],
            ["p4", "Slightly angled text!?"],  # Row 31
        ]
    )

    sheet.cell("B5").format.alignment.vertical = VerticalAlignment.BOTTOM
    sheet.cell("B7").format.alignment.vertical = VerticalAlignment.CENTER
    sheet.cell("B9").format.alignment.vertical = VerticalAlignment.TOP
    sheet.cell("B11").format.alignment.horizontal = HorizontalAlignment.LEFT
    sheet.cell("B13").format.alignment.horizontal = HorizontalAlignment.CENTER
    sheet.cell("B15").format.alignment.horizontal = HorizontalAlignment.RIGHT

    # TODO [vicky/bobby]: We have not implemented indent, rotation or angling of text styles yet.

    # Inspect proto->dict verification.

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_text_alignment"
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
