/** 検証ステップの結果 */
export interface StepResult {
  name: string;
  pass: boolean;
  detail?: string;
}

/** PASS/FAIL 表を標準出力に表示する */
export function printResultsTable(title: string, results: StepResult[]): void {
  const nameWidth = Math.max(
    4,
    ...results.map((r) => r.name.length),
    "ステップ".length,
  );
  const statusWidth = 6;

  console.log(`\n=== ${title} ===\n`);
  console.log(
    `${"ステップ".padEnd(nameWidth)}  ${"結果".padEnd(statusWidth)}  詳細`,
  );
  console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(40)}`);

  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(
      `${r.name.padEnd(nameWidth)}  ${status.padEnd(statusWidth)}  ${r.detail ?? ""}`,
    );
  }

  const allPass = results.every((r) => r.pass);
  console.log(`\n総合: ${allPass ? "PASS" : "FAIL"}\n`);
}
