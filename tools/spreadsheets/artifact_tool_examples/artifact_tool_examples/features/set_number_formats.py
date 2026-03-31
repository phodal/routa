from __future__ import annotations

from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact


def main() -> None:
    # jons_spreadsheet = SpreadsheetArtifact.read(
    #     file_path=Path(__file__).resolve().parent.parent.parent.parent
    #     / "js"
    #     / "oai_js_walnut"
    #     / "output_xlsx.bin"
    # )

    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("TextStyles")
    sheet = spreadsheet.sheet("Examples")

    # Seed some data
    sheet.set_column_widths("B:C", 20)  # so we can see the alignments
    sheet.set_row_heights(start_row_index=1, end_row_index=20, height=20)
    sheet.range("A1:D1").set_values([["priority", "example", "unformatted example", "description"]])
    sheet.range("A3:D24").set_values(
        [
            ["p1", "General 123", "General 123", "General; no formatting"],  # row 3
            ["p1", 12345, 12345, "Number format"],  # row 4
            ["p1", 1.23, 1.23, "Number format with more decimals"],  # row 5
            [
                "p2",
                -12345.6,
                -12345.6,
                "Customizing negative numbers (red/black x parentheses or not), decimal places, and whether or not thousand separator is used",
            ],  # row 6
            ["p1", 12345.6, 12345.6, "Currency"],  # row 7
            ["p1", -12345.6, -12345.6, "Currency - negative"],  # row 8
            ["p2", 12345.6, 12345.6, "Accounting"],  # row 9
            ["p2", -12345.6, -12345.6, "Accounting - negative"],  # row 10
            ["p1", 45917, 45917, '"2025/09/17" without quotes - Short date'],  # row 11
            ["p2", 45917, 45917, '"2025/09/17" without quotes - Long date'],  # row 12
            [
                "p4",
                45917,
                45917,
                '"2025/09/17" without quotes - All sorts of arbitrary date formats',
            ],  # row 13
            ["p2", 0.36180555555555555, 0.36180555555555555, "Time"],  # row 14
            [
                "p4",
                0.36180555555555555,
                0.36180555555555555,
                "All sorts of arbitrary date formats",
            ],  # row 15
            ["p1", 0.456789, 0.456789, "Percentage, 2 decimals"],  # row 16
            ["p1", 0.456789, 0.456789, "Percentage, 0 decimals"],  # row 17
            ["p2", 0.456789, 0.456789, "Percentage, arbitrary decimals"],  # row 18
            ["p3", 0.125, 0.125, "Fractions; as sixteenths"],  # row 19
            [
                "p1",
                0.023400000000000001,
                0.023400000000000001,
                "Scientific with specified number of digits (4 in this case)",
            ],  # row 20
            [
                "p1",
                "2025/09/17",
                "2025/09/17",
                '"2025/09/17" without quotes - Text; appears exactly as typed, left justified',
            ],  # row 21
            ["p3", 123, 123, "zip code"],  # row 22
            ["p2", 1234567890, 1234567890, "Phone number"],  # row 23
            ["p2", -1234567.8901200001, -1234567.8901200001, "Other currencies"],  # row 24
        ]
    )

    # Two decimals
    sheet.cell("B4").format.number_format.format_code = "0.00"
    # More decimals
    sheet.cell("B5").format.number_format.format_code = "0.0000"
    # Format red for negative
    sheet.cell("B6").format.number_format.format_code = r"#,##0.00;[Red](#,##0.00)"
    # Currency, positive or negative
    sheet.cell("B7").format.number_format.format_code = '"$"#,##0.00'
    sheet.cell("B8").format.number_format.format_code = '"$"#,##0.00'

    # Accounting format
    sheet.cell(
        "B9"
    ).format.number_format.format_code = r"_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"
    sheet.cell(
        "B10"
    ).format.number_format.format_code = r"_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"

    # Short date
    sheet.cell("B11").format.number_format.format_code = "m/d/yy"

    # Long date with locale
    sheet.cell("B12").format.number_format.format_code = r"[$-409]dddd, mmmm d, yyyy"

    # TODO [vicky]: Set formats for B13-B21

    # Zip
    sheet.cell("B22").format.number_format.format_code = r"00000"

    # Phone number
    sheet.cell("B23").format.number_format.format_code = r"(000) 000\-0000"

    # Euro
    sheet.cell(
        "B24"
    ).format.number_format.format_code = r"_(€* #,##0.00_);_(€* (#,##0.00);_(€* \"-\"??_);_(@_)"

    # TODO [vicky]: Others

    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_number_formats"
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
