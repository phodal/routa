"""Example: create a new spreadsheet, add a sheet, set cells, read ranges."""

# ruff: noqa: I001
from __future__ import annotations
from pprint import pprint

from artifact_tool import SpreadsheetArtifact

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main() -> None:
    # Create a new spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("AwesomeCompany")

    # Look at what exists
    spreadsheet.get_sheet("Overview")  # None

    overviews_sheet = spreadsheet.create_sheet("Overview")
    employees_sheet = spreadsheet.create_sheet("Employees")

    overviews_sheet.cell("A1").value = "Description"
    overviews_sheet.cell("A2").value = "Awesome Company Report"

    # Write headers with the range helper
    employees_sheet.range("A1:D1").set_values([["Title", "Name", "Address", "Score"]])  # row 1
    employees_sheet.range("A2:D4").set_values(
        [
            ["Engineer", "Vicky", "90 50th Street", 98],  # row 2
            ["Manager", "Alex", "500 Market Street", 92],  # row 3
            ["Designer", "Jordan", "200 Pine Street", 88],  # row 4
        ]
    )

    print("\nCreating a basic spreadsheet template with the following structure:")
    pprint(spreadsheet.to_dict())

    print("Adding a total scores row with a sum formula")

    # Skip a line and add a sum formula cell
    employees_sheet.cell("A6").set_value("Total Score")
    employees_sheet.cell("D6").formula = "=SUM(D2:D4)"
    assert employees_sheet.formula("D6") == "=SUM(D2:D4)"
    assert employees_sheet.cell("D6").data == "=SUM(D2:D4)"

    employees_sheet.recalculate()
    assert employees_sheet.cell("D6").value == 278
    assert employees_sheet.cell("D6").data == "=SUM(D2:D4)"

    # Edit with the bracket shortcut
    print("Updating Vicky's title to Standing Desk Operator")
    employees_sheet.cell("A2").value = "Standing Desk Operator"

    print("Updating Alex's name to Alex V2 and address to [private] address")
    employees_sheet.range("B3:C3").values = [["Alex V2", "[private] address"]]

    # Add a new column for promotions
    print("Adding a new column for promotions")
    employees_sheet.range("E1:E4").set_values([["Promotion"], [True], [False], [True]])

    # Make sure vicky is getting a promption
    assert employees_sheet.value("E2") is True
    assert employees_sheet.cell("E2").value is True

    # Read what you made
    print("\n==Overview sheet (raw data):")
    pprint(overviews_sheet.range("A1:E4").get_data())

    print("\n==Scores sheet (raw data):")
    pprint(employees_sheet.range("A1:E6").get_data())

    print("\n==Scores sheet (values):")
    pprint(employees_sheet.range("A1:E6").values)

    print("\n==Scores sheet as a dictionary:")
    pprint(employees_sheet.to_dict())

    print("\n==Serialized workbook dictionary:")
    pprint(spreadsheet.to_dict())

    print("\n==Serialized workbook length:")
    pprint(len(spreadsheet.to_json()))

    # Render the final spreadsheet
    render_path = spreadsheet.render()
    print(f"Rendered spreadsheet to {render_path}")

    # Saves it to binary format in the current directory
    proto_path = spreadsheet.save()
    print(f"Saved spreadsheet proto to {proto_path}")

    export_path = spreadsheet.export()
    print(f"Exported spreadsheet to {export_path}")


if __name__ == "__main__":
    main()
