"""Generate a styled games scoreboard spreadsheet artifact.

This script demonstrates how to assemble a multi-sheet `SpreadsheetArtifact`
similar to ``sample_jsons/GamesSimpleStyling.json`` using the higher-level API.
Run it to emit the workbook JSON to stdout or pass ``--output`` to write it to disk.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from pprint import pprint

from oaiproto.coworker.pptx.utils_pb2 import Color, Fill, TextStyle
from oaiproto.coworker.xlsx.spreadsheet_pb2 import CfRule, DifferentialFormat

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.conditional_formatting import CfType, len_greater_than_zero_formula

HEADER_FILL_HEX = "FFB7E1CD"
HIGHLIGHT_FILL_HEX = "FFFFF2CC"

"""
This creates a simple spreadsheet with two sheets, one for Game X and one for Game Y.
With a simple header style row and players filled in.

It demonstrates how to create styles and apply them to cells.
It demonstrates how to create conditional formatting, merge cells, etc.

Example:
`python examples/spreadsheets/create_spreadsheet_with_styling.py --output ~/tmp/styled_xlsx.xlsx --format xlsx --render`
"""


def solid_fill(color_hex: str) -> Fill:
    """Return a solid fill proto for the given RGB hex color."""

    normalized = color_hex.lstrip("#").upper()
    return Fill(type="FILL_TYPE_SOLID", color=Color(type="COLOR_TYPE_RGB", value=normalized))


def create_styles(artifact: SpreadsheetArtifact) -> dict[str, int]:
    """Register reusable styles on the workbook and return their indices."""

    # Header style: bold font, pastel fill, centered alignment.
    text_style = TextStyle(name="Aptos Narrow", family=2, scheme="minor", font_size=11, bold=True)
    header_cell_style_index = artifact.create_cell_format(
        text_style=text_style,
        fill=solid_fill(HEADER_FILL_HEX),
        horizontal_alignment="center",
        vertical_alignment="center",
    )

    # Highlight style reused for winner callouts.
    highlight_cell_style_index = artifact.create_cell_format(
        fill=solid_fill(HIGHLIGHT_FILL_HEX),
        text_style=text_style,
        horizontal_alignment="center",
        vertical_alignment="center",
    )

    return {
        "header": header_cell_style_index,
        "highlight": highlight_cell_style_index,
    }


def populate_first_game_sheet(artifact: SpreadsheetArtifact, style_indices: dict[str, int]) -> None:
    """Create the "GameX" sheet with scores and a summary row."""

    sheet = artifact.sheet("GameX")
    sheet.set_sheet_styles(default_row_height=15.75)
    sheet.set_row_height(2, 35.25)

    sheet.set_column_widths("C", 13.1640625)
    sheet.set_column_widths("D", 13.5)
    sheet.set_column_widths("E", 11.1640625)
    sheet.set_column_widths("F", 40)

    headers_range = sheet.range("A2:G2")
    headers_range.set_values(
        [["", "Name", "Game 1 Score", "Game 2 Score", "Total Score", "Notes", ""]]
    )
    headers_range.set_style_index(style_indices["header"])

    name_score_range = sheet.range("B3:D5")
    name_score_range.set_values(
        [
            ["Vicky", 12, 30],
            ["Yash", 20, 10],
            ["Bobby", 1000, 1030],
        ]
    )

    # Set the total score formula column
    total_score_range = sheet.range("E3:E5")
    total_score_range.set_formulas([["=SUM(C3:D3)"], ["=SUM(C4:D4)"], ["=SUM(C5:D5)"]])

    notes_column = sheet.range("F3:F5")
    notes_column.set_values(
        [
            ["Dominated the minigames."],
            ["Emily main with strong defense."],
            ["Numbers look suspiciously high."],
        ]
    )

    # Actually, reset F5
    sheet.cell("F5").value = "Rematch penciled in for Friday."

    # Now, fill in a last row for the summary row - 7th row

    sheet.cell("B7").value = "Winner"
    sheet.cell("C7").formula = "=INDEX(B4:B6, MATCH(MAX(E4:E6), E4:E6, 0))"
    sheet.cell("E7").value = "Congrats!"
    sheet.range("B7:E7").set_style_index(style_indices["highlight"])

    # Let's merge C7 and D7
    sheet.range("C7:D7").merge()

    sheet.create_conditional_formatting(
        ranges=["A2:G2"],
        rules=[
            CfRule(
                type=CfType.NOT_CONTAINS_BLANKS,
                formula=[len_greater_than_zero_formula("A2")],
            )
        ],
        style=DifferentialFormat(fill=solid_fill(HEADER_FILL_HEX)),
    )


def build_workbook() -> SpreadsheetArtifact:
    """Create the scoreboard workbook with both sheets populated."""

    artifact = SpreadsheetArtifact("GamesSimpleStyling")
    style_indices = create_styles(artifact)

    populate_first_game_sheet(artifact, style_indices)

    return artifact


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the GamesSimpleStyling workbook JSON")
    parser.add_argument(
        "--output",
        type=Path,
        help=("Optional destination file. Leave unset to print the workbook to_dict() to stdout."),
    )
    parser.add_argument(
        "--format",
        choices=["json", "bin", "xlsx"],
        default="json",
        help="Output type to use when saving the workbook.",
    )
    parser.add_argument(
        "--render",
        action="store_true",
        default=False,
        help="Render the workbook to PNG images.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact = build_workbook()
    output_format = args.format

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        if output_format == "json":
            file_type = FileOutputType.C_STAR_PROTO_JSON
        elif output_format == "bin":
            file_type = FileOutputType.C_STAR_PROTO_BINARY
        elif output_format == "xlsx":
            file_type = FileOutputType.XLSX
        else:
            raise ValueError(f"Invalid output type: {output_format}")

        path = artifact.save(
            file_type=file_type,
            filename=args.output,
            overwrite=True,
        )
        print("Saving workbook to", path)
    else:
        workbook_dict = artifact.to_dict()
        print("Workbook created successfully: to_dict()")
        pprint(workbook_dict)

    if args.render:
        render_paths = artifact.render()
        print("Rendered workbook to", render_paths)


if __name__ == "__main__":
    main()
