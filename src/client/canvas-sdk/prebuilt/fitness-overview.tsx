"use client";

import type { JSX } from "react";

import {
  Stack,
  H1,
  H2,
  Text,
  Divider,
  Grid,
  Row,
} from "../primitives";
import { Table, Stat, Pill, type PillTone } from "../data-display";
import { BarChart, type BarChartEntry } from "../charts";
import { Card, CardHeader, CardBody } from "../containers";
import { useHostTheme } from "../theme-context";

// ---------------------------------------------------------------------------
// Data types consumed by this canvas
// ---------------------------------------------------------------------------

export interface FitnessDimensionData {
  dimension: string;
  name: string;
  level: string;
  levelName: string;
  score: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelProgress?: number | null;
}

export interface FitnessRecommendationData {
  criterionId: string;
  action: string;
  whyItMatters: string;
  critical: boolean;
}

export interface FitnessComparisonData {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: Array<{
    dimension: string;
    previousLevel: string;
    currentLevel: string;
    change: "same" | "up" | "down";
  }>;
}

export interface FitnessOverviewData {
  generatedAt: string;
  profile: string;
  overallLevel: string;
  overallLevelName: string;
  currentLevelReadiness: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  dimensions: Record<string, FitnessDimensionData>;
  recommendations: FitnessRecommendationData[];
  blockingCriteria: Array<{ id?: string; title?: string; reason?: string }>;
  comparison?: FitnessComparisonData | null;
}

// ---------------------------------------------------------------------------
// Canvas component
// ---------------------------------------------------------------------------

export type FitnessOverviewCanvasProps = {
  data: FitnessOverviewData;
};

export function FitnessOverviewCanvas({
  data,
}: FitnessOverviewCanvasProps): JSX.Element {
  const { palette } = useHostTheme();
  const dims = Object.values(data.dimensions);
  const readinessPct = Math.round(data.currentLevelReadiness * 100);
  const criticalRecs = data.recommendations.filter((r) => r.critical);
  const nonCriticalRecs = data.recommendations.filter((r) => !r.critical);

  // Bar chart data: dimensions by score
  const barData: BarChartEntry[] = dims
    .sort((a, b) => b.score - a.score)
    .map((d) => ({
      label: d.name || d.dimension,
      value: d.score,
    }));

  return (
    <Stack gap={20}>
      {/* Hero */}
      <H1>Fitness Overview — {data.profile}</H1>
      <Text tone="secondary">
        Generated at {data.generatedAt}
      </Text>

      {/* Summary stats */}
      <Grid columns={4} gap={12}>
        <Stat value={data.overallLevelName} label="Overall Level" />
        <Stat
          value={`${readinessPct}%`}
          label="Level Readiness"
          tone={readinessPct >= 90 ? "success" : readinessPct >= 70 ? "warning" : "danger"}
        />
        <Stat value={dims.length} label="Dimensions" />
        <Stat
          value={data.blockingCriteria.length}
          label="Blocking Criteria"
          tone={data.blockingCriteria.length > 0 ? "danger" : "success"}
        />
      </Grid>

      {data.nextLevelName && (
        <Row gap={8}>
          <Pill tone="info">Next Level</Pill>
          <Text tone="secondary" as="span">{data.nextLevelName}</Text>
        </Row>
      )}

      <Divider />

      {/* Dimension scores */}
      <H2>Dimension Scores</H2>
      <BarChart data={barData} height={Math.max(dims.length * 36, 200)} />

      {/* Dimension table */}
      <Table
        headers={["Dimension", "Level", "Score", "Next Level"]}
        rows={dims.map((d) => [
          d.name || d.dimension,
          <Pill
            key={d.dimension}
            tone={levelTone(d.score)}
            active
          >
            {d.levelName}
          </Pill>,
          `${d.score.toFixed(1)}`,
          d.nextLevelName ?? "—",
        ])}
        columnAlign={["left", "left", "right", "left"]}
      />

      <Divider />

      {/* Blocking criteria */}
      {data.blockingCriteria.length > 0 && (
        <>
          <H2>Blocking Criteria</H2>
          <Card>
            <CardHeader trailing={<Pill tone="deleted" active>{data.blockingCriteria.length}</Pill>}>
              Hard Gates
            </CardHeader>
            <CardBody>
              <Table
                headers={["Criterion", "Reason"]}
                rows={data.blockingCriteria.map((c) => [
                  c.title ?? c.id ?? "—",
                  c.reason ?? "—",
                ])}
                rowTone={data.blockingCriteria.map(() => "danger" as const)}
              />
            </CardBody>
          </Card>
          <Divider />
        </>
      )}

      {/* Recommendations */}
      <H2>Recommendations</H2>

      {criticalRecs.length > 0 && (
        <Card>
          <CardHeader trailing={<Pill tone="deleted" active>{criticalRecs.length}</Pill>}>
            Critical
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              {criticalRecs.map((r) => (
                <RecommendationItem key={r.criterionId} rec={r} palette={palette} />
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      {nonCriticalRecs.length > 0 && (
        <Card>
          <CardHeader trailing={<Pill tone="info" active>{nonCriticalRecs.length}</Pill>}>
            Improvements
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              {nonCriticalRecs.map((r) => (
                <RecommendationItem key={r.criterionId} rec={r} palette={palette} />
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}

      {/* Comparison */}
      {data.comparison && (
        <>
          <Divider />
          <ComparisonSection comparison={data.comparison} />
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RecommendationItem({
  rec,
  palette,
}: {
  rec: FitnessRecommendationData;
  palette: { danger: string };
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Row gap={6}>
        {rec.critical && (
          <span style={{ color: palette.danger, fontWeight: 600, fontSize: "12px" }}>
            ●
          </span>
        )}
        <Text weight="semibold" as="span">{rec.action}</Text>
      </Row>
      <Text tone="secondary" size="small">{rec.whyItMatters}</Text>
    </Stack>
  );
}

function ComparisonSection({
  comparison,
}: {
  comparison: FitnessComparisonData;
}): JSX.Element {
  const changeIcon: Record<string, string> = { up: "↑", down: "↓", same: "→" };
  const changeTone = (c: string): PillTone =>
    c === "up" ? "success" : c === "down" ? "deleted" : "neutral";

  return (
    <>
      <H2>Comparison</H2>
      <Row gap={8}>
        <Text tone="secondary" as="span">
          vs {comparison.previousOverallLevel} ({comparison.previousGeneratedAt})
        </Text>
        <Pill tone={changeTone(comparison.overallChange)} active>
          {changeIcon[comparison.overallChange]} {comparison.overallChange}
        </Pill>
      </Row>

      {comparison.dimensionChanges.length > 0 && (
        <Table
          headers={["Dimension", "Previous", "Current", "Change"]}
          rows={comparison.dimensionChanges
            .filter((d) => d.change !== "same")
            .map((d) => [
              d.dimension,
              d.previousLevel,
              d.currentLevel,
              <Pill key={d.dimension} tone={changeTone(d.change)} active>
                {changeIcon[d.change]}
              </Pill>,
            ])}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelTone(score: number) {
  if (score >= 80) return "success" as const;
  if (score >= 50) return "warning" as const;
  return "deleted" as const;
}
