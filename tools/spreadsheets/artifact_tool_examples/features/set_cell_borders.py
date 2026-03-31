from __future__ import annotations

from pathlib import Path

from oaiproto.coworker.pptx.utils_pb2 import Color
from oaiproto.coworker.xlsx.spreadsheet_pb2 import Border, BorderLine

from artifact_tool import FileOutputType, SpreadsheetArtifact


def main() -> None:
    spreadsheet = SpreadsheetArtifact("Borders")
    first_sheet = spreadsheet.sheet("BorderExamples")

    first_sheet.cell("B2").set_value("Bottom border")
    first_sheet.cell("B2").format.borders.bottom = BorderLine(style="thin")

    first_sheet.cell("B4").set_value("Top border")
    first_sheet.cell("B4").format.borders.top = BorderLine(style="thin")

    first_sheet.cell("B6").set_value("Left border")
    first_sheet.cell("B6").format.borders.left = BorderLine(style="thin")

    first_sheet.cell("B8").set_value("Right border")
    first_sheet.cell("B8").format.borders.right = BorderLine(style="thin")

    first_sheet.cell("B10").set_value("All borders")
    first_sheet.cell("B10").format.borders.set(
        top=BorderLine(style="thin"),
        right=BorderLine(style="thin"),
        bottom=BorderLine(style="thin"),
        left=BorderLine(style="thin"),
    )

    first_sheet.cell("B12").set_value("Thick borders")
    first_sheet.cell("B12").format.borders.set(
        top=BorderLine(style="thick"),
        right=BorderLine(style="thick"),
        bottom=BorderLine(style="thick"),
        left=BorderLine(style="thick"),
    )

    first_sheet.cell("B14").set_value("Bottom double border")
    first_sheet.cell("B14").format.borders.bottom = BorderLine(style="double")

    first_sheet.cell("B16").set_value("Thick bottom border")
    first_sheet.cell("B16").format.borders.bottom = BorderLine(style="thick")

    first_sheet.cell("B18").set_value("Top and thick bottom border")
    first_sheet.cell("B18").format.borders.set(
        top=BorderLine(style="thin"), bottom=BorderLine(style="thick")
    )

    first_sheet.cell("B20").set_value("Top and double bottom border")
    first_sheet.cell("B20").format.borders.set(
        top=BorderLine(style="thin"), bottom=BorderLine(style="double")
    )

    highlight_color = Color(type="COLOR_TYPE_RGB", value="FFFF6F00")
    accent_color = Color(type="COLOR_TYPE_RGB", value="FF1F75FE")

    first_sheet.cell("B22").set_value("Colorful borders")
    first_sheet.cell("B22").format.borders.set(
        top=BorderLine(style="thin", color=highlight_color),
        right=BorderLine(style="thin", color=highlight_color),
        bottom=BorderLine(style="thin", color=highlight_color),
        left=BorderLine(style="thin", color=highlight_color),
    )

    first_sheet.cell("B24").set_value("Dashed borders")
    first_sheet.cell("B24").format.borders.set(
        top=BorderLine(style="mediumDashed", color=highlight_color),
        right=BorderLine(style="mediumDashed", color=highlight_color),
        bottom=BorderLine(style="mediumDashed", color=highlight_color),
        left=BorderLine(style="mediumDashed", color=highlight_color),
    )

    first_sheet.cell("B26").set_value("All sorts of borders")
    first_sheet.cell("B26").format.borders.set(
        top=BorderLine(style="mediumDashed", color=accent_color),
        right=BorderLine(style="thin", color=accent_color),
        left=BorderLine(style="thin", color=accent_color),
        bottom=BorderLine(style="thick", color=accent_color),
    )

    first_sheet.cell("B28").set_value("Diagonal up")
    first_sheet.cell("B28").format.borders.set(
        border=Border(diagonal=BorderLine(style="thin", color=highlight_color), diagonal_up=True),
    )

    first_sheet.cell("B30").set_value("Diagonal down")
    first_sheet.cell("B30").format.borders.set(
        border=Border(diagonal=BorderLine(style="thin", color=accent_color), diagonal_down=True),
    )

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_cell_borders"
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
