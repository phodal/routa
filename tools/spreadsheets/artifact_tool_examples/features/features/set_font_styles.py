from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.formatting import FontFace, Underline


def main() -> None:
    spreadsheet = SpreadsheetArtifact("FontStyles")
    sheet = spreadsheet.sheet("Examples")

    sheet.cell("A1").set_value("Font property")

    # Set font to comic sans which is setting both typeface and family
    sheet.cell("A3").set_value("Font: comic sans")
    sheet.cell("A3").format.text_style.font_face = FontFace(typeface="Comic Sans MS", family=4)

    sheet.cell("A5").set_value("Bold text")
    sheet.cell("A5").format.text_style.bold = True

    sheet.cell("A7").set_value("Colored text")
    sheet.cell("A7").format.text_style.font_color = "#FF0000"

    sheet.cell("A9").set_value("Italics")
    sheet.cell("A9").format.text_style.italic = True

    sheet.cell("A11").set_value("Underlined text")
    sheet.cell("A11").format.text_style.underline = Underline.SINGLE

    sheet.cell("A13").set_value("Large font size")
    sheet.set_row_height(13, 48)
    sheet.cell("A13").format.text_style.font_size = 36

    sheet.cell("A15").set_value("Small font size")
    sheet.cell("A15").format.text_style.font_size = 8

    sheet.cell("A17").set_value("Double underline all the way across the cell")
    sheet.cell("A17").format.text_style.underline = Underline.DOUBLE

    sheet.set_row_height(19, 32)
    sheet.cell("A19").set_rich_text(
        [
            {"t": "some "},
            {"t": "italic ", "i": True},
            {"t": "some bold", "b": True},
            {"t": " and "},
            {"t": "some big", "fs": 24},
            {"t": " "},
            {"t": "but this is not common", "b": True, "i": True, "fs": 14, "u": "single"},
        ]
    )

    # Set a bunch of styling
    A21 = sheet.cell("A21")
    A21.value = "Setting font to size 10, double underline, center aligned, and blue with wrap text"
    A21.format.text_style.set(
        font_color="#0000FF",
        font_size=10,
        underline=Underline.DOUBLE,
        italic=True,
    )
    A21.format.wrap()

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_font_styles"
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path}")

    output_path = spreadsheet.export()
    print(f"Spreadsheet exported to {output_path}")

    spreadsheet.save(
        file_type=FileOutputType.C_STAR_PROTO_JSON,
        filename=output_dir / "workbook__auto.json",
        overwrite=True,
    )


if __name__ == "__main__":
    main()
