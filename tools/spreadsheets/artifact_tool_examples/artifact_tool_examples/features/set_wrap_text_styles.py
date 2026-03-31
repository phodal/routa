from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.formatting import TextWrapOption


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("WrapTextStyles")
    sheet = spreadsheet.sheet("Examples")

    # Seed some data
    sheet.set_column_widths("B", 40)
    title_range = sheet.range("A1:C1")
    title_range.set_values([["Priority", "Text w/ formatting", "Other cells"]])
    title_range.format.text_style.bold = True
    title_range.format.text_style.font_color = "#DDEBF7"  # setting font color to light blue
    title_range.format.fill.set_solid_color(rgb_color="#1F4E79")  # dark blue
    sheet.range("A3:C17").set_values(
        [
            [
                "p1",
                "Some very very long text that will definitely be too long with no neighbor",
                None,
            ],  # Row 3
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with neighbor",
                "Neighbor!",
            ],  # Row 5
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with no neighbor but wrapped",
                None,
            ],  # Row 7
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with neighbor but wrapped",
                "Neighbor!",
            ],  # Row 9
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with no neighbor but fit to cell",
                None,
            ],  # Row 11
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with neighbor but fit to cell",
                "Neighbor!",
            ],  # Row 13
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with no neighbor but fit to cell then back to auto",
                None,
            ],  # Row 15
            [None, None, None],
            [
                "p1",
                "Some very very long text that will definitely be too long with neighbor but wrap but back to auto",
                "Neighbor!",
            ],  # Row 17
        ]
    )

    # Set the color of column C to be bright pink so we can see better
    sheet.range("C3:C17").format.fill.set_solid_color(rgb_color="#FF007F")

    sheet.cell("B7").format.wrap_text = TextWrapOption.WRAP
    sheet.cell("B9").format.wrap_text = TextWrapOption.WRAP
    sheet.cell("B11").format.wrap_text = TextWrapOption.SHRINK_TEXT_TO_FIT
    sheet.cell("B13").format.wrap_text = TextWrapOption.SHRINK_TEXT_TO_FIT
    sheet.cell("B15").format.wrap_text = TextWrapOption.SHRINK_TEXT_TO_FIT
    sheet.cell("B17").format.wrap_text = TextWrapOption.WRAP
    sheet.cell("B15").format.wrap_text = TextWrapOption.AUTO
    sheet.cell("B17").format.wrap_text = TextWrapOption.AUTO

    # Inspect proto->dict verification.

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_wrap_text_styles"
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
