from pathlib import Path

from artifact_tool import SpreadsheetArtifact


def main() -> None:
    spreadsheet = SpreadsheetArtifact("CiteDemo")
    first_sheet = spreadsheet.sheet("Sheet1")

    # Example data.
    first_sheet.range("A1:C3").set_values(
        [
            ["Note", "hello", "hello"],
            ["a", "b", "c"],
            ["d", "e", "f"],
        ]
    )
    # Add note on the range (anchors to top-left A1 by default).
    first_sheet.range("A1:C3").cite(
        tether_id="123456789",
        start_line_number=12,
        end_line_number=18,
    )

    first_sheet.cell("A4").set_value("This is a note on the cell A4.")
    first_sheet.cell("A4").cite(tether_id="1234567890", start_line_number=23, end_line_number=46)

    # Inspect proto->dict verification.
    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "cite_cells"
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path}")

    # output_path = spreadsheet.export()
    # print(f"Spreadsheet exported to {output_path}")

    # as_dict = spreadsheet.to_dict()
    # print(as_dict)


if __name__ == "__main__":
    main()
