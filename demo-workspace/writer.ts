export interface Row { id: string; amount: number; }

export function writeHeaderOnly(): string {
  return "id,amount\n";
}

export function writeRows(rows: Row[]): string {
  if (rows.length === 0) return writeHeaderOnly();
  const body = rows.map((r) => r.id + "," + r.amount).join("\n");
  return "id,amount\n" + body + "\n";
}

// (demo fixture) padding line 1
// (demo fixture) padding line 2
// (demo fixture) padding line 3
// (demo fixture) padding line 4
// (demo fixture) padding line 5
// (demo fixture) padding line 6
// (demo fixture) padding line 7
// (demo fixture) padding line 8
// (demo fixture) padding line 9
// (demo fixture) padding line 10
// (demo fixture) padding line 11
// (demo fixture) padding line 12
// (demo fixture) padding line 13
// (demo fixture) padding line 14
// (demo fixture) padding line 15
// (demo fixture) padding line 16
// (demo fixture) padding line 17
// (demo fixture) padding line 18
// (demo fixture) padding line 19
// (demo fixture) padding line 20
// (demo fixture) padding line 21
// (demo fixture) padding line 22
// (demo fixture) padding line 23
// (demo fixture) padding line 24
// (demo fixture) padding line 25
// (demo fixture) padding line 26
// (demo fixture) padding line 27
// (demo fixture) padding line 28
// (demo fixture) padding line 29
// (demo fixture) padding line 30
// (demo fixture) padding line 31
// (demo fixture) padding line 32
// (demo fixture) padding line 33
// (demo fixture) padding line 34
// (demo fixture) padding line 35
// (demo fixture) padding line 36
// (demo fixture) padding line 37
// (demo fixture) padding line 38
// (demo fixture) padding line 39
// (demo fixture) padding line 40
// (demo fixture) padding line 41
// (demo fixture) padding line 42
// (demo fixture) padding line 43
// (demo fixture) padding line 44
// (demo fixture) padding line 45
// (demo fixture) padding line 46
// (demo fixture) padding line 47
// (demo fixture) padding line 48
// (demo fixture) padding line 49
// (demo fixture) padding line 50
