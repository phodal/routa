"""Example: create a new spreadsheet, add a sheet, set cells, read ranges."""

from __future__ import annotations

from pprint import pprint

from oaiproto.coworker.pptx.utils_pb2 import Color, Fill
from oaiproto.coworker.xlsx.spreadsheet_pb2 import BorderLine, CfRule

from artifact_tool import SpreadsheetArtifact
from artifact_tool.spreadsheet.conditional_formatting import CfType, len_greater_than_zero_formula
from artifact_tool.spreadsheet.formatting import HorizontalAlignment


def main() -> None:
    # Create a new spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("Scores")
    first_sheet = spreadsheet.sheet("FirstGame")
    B2_E2_range = first_sheet.range("B2:E2")

    # Going to make a spreadsheet with 4 columns: Title, Name, Address, and Score
    # Styling the first row, and setting column widths
    # Then fill table with 4 rows of data and merge the bottom row and set it to a formula for the total score

    # Set the first row to be the title
    first_sheet.set_column_widths("B:E", 20)
    B2_E2_range.set_values([["Name", "Game 1 Score", "Game 2 Score", "Total Score"]])
    B2_E2_range.conditional_formats.add(
        rules=[
            CfRule(type=CfType.NOT_CONTAINS_BLANKS, formula=[len_greater_than_zero_formula("A2")])
        ],
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFB7E1CD"),
        ),
    )

    first_sheet.range("B3:E6").set_values(
        [
            ["Vicky", 50, 60, 110],
            ["John", 40, 50, 90],
            ["Jane", 30, 40, 70],
            ["Jim", 20, 30, 50],
        ]
    )

    B9_E9_range = first_sheet.range("B9:E9")

    B9_E9_range.merge()
    B9_E9_range.set_formula("=SUM(E3:E6)")  # total score formula

    # Style the last row to be bold with borders
    B9_E9_range.format.text_style.bold = True
    B9_E9_range.format.borders.set(
        left=BorderLine(style="thin"),
        right=BorderLine(style="thin"),
        top=BorderLine(style="thin"),
        bottom=BorderLine(style="thin"),
    )
    B9_E9_range.format.alignment.horizontal = HorizontalAlignment.CENTER

    render_path = spreadsheet.render()
    print(f"Rendered spreadsheet to {render_path}")

    export_path = spreadsheet.export()
    print(f"Exported spreadsheet to {export_path}")

    print("\n==Serialized workbook dictionary:")
    pprint(spreadsheet.to_dict())


if __name__ == "__main__":
    main()
