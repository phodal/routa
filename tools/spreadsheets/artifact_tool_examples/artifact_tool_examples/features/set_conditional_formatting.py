from __future__ import annotations

from pathlib import Path

from oaiproto.coworker.pptx.utils_pb2 import Color, Fill
from oaiproto.coworker.xlsx.spreadsheet_pb2 import (
    CfRule,
    Cfvo,
    ColorScale,
    DataBar,
    DifferentialFormat,
    IconSet,
)

from artifact_tool import FileOutputType, SpreadsheetArtifact
from artifact_tool.spreadsheet.conditional_formatting import CfType


def main() -> None:
    # New spreadsheet artifact
    spreadsheet = SpreadsheetArtifact("Scores")
    first_sheet = spreadsheet.sheet("FirstGame")

    # Sample data.
    first_sheet.range("A1:E1").set_values([["Score", "Bonus", "Total", "Category", "Threshold"]])
    first_sheet.range("A2:B5").set_values([[10, 5], [20, 10], [15, 8], [5, 2]])
    first_sheet.range("C2:C5").set_formulas([["=A2+B2"], ["=A3+B3"], ["=A4+B4"], ["=A5+B5"]])
    first_sheet.range("D2:E5").set_values(
        [["VIP", "12"], ["REG", "12"], ["VIP", "12"], ["GUEST", "12"]]
    )

    highlight_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFCCE5FF"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["A2:C5"],
        rules=[
            CfRule(
                type=CfType.CELL_IS,
                operator="greaterThan",
                formula=["10"],
            )
        ],
        style=highlight_style,
    )

    cf_records = first_sheet.get_conditional_formatting()
    assert len(cf_records) == 1
    first_cf = cf_records[0]
    first_rule = first_cf.rules[0]
    assert [(rng.start_address, rng.end_address) for rng in first_cf.ranges] == [("A2", "C5")]
    assert first_rule.type == CfType.CELL_IS
    assert first_rule.operator == "greaterThan"
    assert list(first_rule.formula) == ["10"]

    range_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFF2CCFF"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["A2:A5", "B2:B5"],
        rules=[
            CfRule(
                type=CfType.CELL_IS,
                operator="between",
                formula=["5", "20"],
            ),
            CfRule(
                type=CfType.CELL_IS,
                operator="greaterThanOrEqual",
                formula=["15"],
            ),
            CfRule(
                type=CfType.CELL_IS,
                operator="lessThan",
                formula=["5"],
            ),
            CfRule(
                type=CfType.CELL_IS,
                operator="equal",
                formula=["10"],
            ),
        ],
        style=range_style,
    )

    multi_cf = first_sheet.get_conditional_formatting()[1]
    assert [(rng.start_address, rng.end_address) for rng in multi_cf.ranges] == [
        ("A2", "A5"),
        ("B2", "B5"),
    ]
    assert len(multi_cf.rules) == 4

    relative_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFCCE5D8"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["B2:B5"],
        rules=[CfRule(type=CfType.EXPRESSION, formula=["B2>$E$2"])],
        style=relative_style,
    )

    formula_cf = first_sheet.get_conditional_formatting()[2]
    assert formula_cf.rules[0].type == CfType.EXPRESSION
    assert list(formula_cf.rules[0].formula) == ["B2>$E$2"]

    text_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFFFC7CE"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["D2:D5"],
        rules=[
            CfRule(type=CfType.EXPRESSION, formula=['NOT(ISERROR(SEARCH("VIP",D2)))']),
            CfRule(type=CfType.EXPRESSION, formula=['ISERROR(SEARCH("VIP",D2))']),
        ],
        style=text_style,
    )

    text_cf = first_sheet.get_conditional_formatting()[3]
    assert len(text_cf.rules) == 2

    uniqueness_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFE2F0CB"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["A2:A5"],
        rules=[
            CfRule(type=CfType.UNIQUE_VALUES),
            CfRule(type=CfType.DUPLICATE_VALUES),
        ],
        style=uniqueness_style,
    )

    uniqueness_cf = first_sheet.get_conditional_formatting()[4]
    assert {rule.type for rule in uniqueness_cf.rules} == {
        CfType.UNIQUE_VALUES,
        CfType.DUPLICATE_VALUES,
    }

    ranking_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFD9E1F2"),
        )
    )

    first_sheet.create_conditional_formatting(
        ranges=["C2:C5"],
        rules=[
            CfRule(type=CfType.TOP_10, operator="top", formula=["2"]),
            CfRule(type=CfType.ABOVE_AVERAGE),
        ],
        style=ranking_style,
    )

    ranking_cf = first_sheet.get_conditional_formatting()[5]
    assert ranking_cf.rules[0].type == CfType.TOP_10
    assert ranking_cf.rules[1].type == CfType.ABOVE_AVERAGE

    visual_style = DifferentialFormat()

    first_sheet.create_conditional_formatting(
        ranges=["C2:C5"],
        rules=[
            CfRule(
                type=CfType.COLOR_SCALE,
                color_scale=ColorScale(
                    cfvos=[Cfvo(type="min"), Cfvo(type="num", val="20"), Cfvo(type="max")],
                    colors=[
                        Color(type="COLOR_TYPE_RGB", value="FFFF0000"),
                        Color(type="COLOR_TYPE_RGB", value="FFFFFF00"),
                        Color(type="COLOR_TYPE_RGB", value="FF00FF00"),
                    ],
                ),
            ),
            CfRule(
                type=CfType.DATA_BAR,
                data_bar=DataBar(
                    cfvos=[Cfvo(type="min"), Cfvo(type="max")],
                    color=Color(type="COLOR_TYPE_RGB", value="FF4472C4"),
                ),
            ),
            CfRule(
                type=CfType.ICON_SET,
                icon_set=IconSet(icon_set="3TrafficLights1", show_value=True),
            ),
        ],
        style=visual_style,
    )

    visual_cf = first_sheet.get_conditional_formatting()[6]
    assert {rule.type for rule in visual_cf.rules} == {
        CfType.COLOR_SCALE,
        CfType.DATA_BAR,
        CfType.ICON_SET,
    }

    precedence_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FFB4C6E7"),
        )
    )
    first_sheet.create_conditional_formatting(
        ranges=["B2:B5"],
        rules=[CfRule(type=CfType.CELL_IS, operator="equal", formula=["10"])],
        style=precedence_style,
    )
    later_style = DifferentialFormat(
        fill=Fill(
            type="FILL_TYPE_SOLID",
            color=Color(type="COLOR_TYPE_RGB", value="FF9BC2E6"),
        )
    )
    first_sheet.create_conditional_formatting(
        ranges=["B2:B5"],
        rules=[CfRule(type=CfType.EXPRESSION, formula=["B2>5"])],
        style=later_style,
    )

    reusable_index = spreadsheet.create_dxf(
        DifferentialFormat(
            fill=Fill(
                type="FILL_TYPE_SOLID",
                color=Color(type="COLOR_TYPE_RGB", value="FF00B0F0"),
            )
        )
    )
    first_sheet.create_conditional_formatting(
        ranges=["A2:A5"],
        rules=[
            CfRule(
                type=CfType.CELL_IS,
                operator="greaterThan",
                dxf_id=reusable_index,
                formula=["8"],
            )
        ],
    )

    retrieved_cf = first_sheet.get_conditional_formatting()
    retrieved_cf[0].rules[0].formula[0] = "A2>999"

    for cf in first_sheet.get_conditional_formatting():
        formatted_ranges = [(rng.start_address, rng.end_address) for rng in cf.ranges]
        rule_summaries = [
            {
                "type": rule.type,
                "operator": rule.operator,
                "formula": list(rule.formula),
                "dxf_id": rule.dxf_id,
            }
            for rule in cf.rules
        ]
        print("Conditional formatting ranges:", formatted_ranges)
        print("Rules:", rule_summaries)

    # Inspect proto->dict verification.
    spreadsheet.calculate()
    output_dir = (
        Path(__file__).resolve().parent / "golden_rendered_images" / "set_conditional_formatting"
    )
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path}")

    # output_path = spreadsheet.export()
    # print(f"Spreadsheet exported to {output_path}")

    spreadsheet.save(
        file_type=FileOutputType.C_STAR_PROTO_JSON,
        filename=output_dir / "workbook__auto.json",
        overwrite=True,
    )

    print("Conditional formatting roundtrip checks passed.")


if __name__ == "__main__":
    main()
