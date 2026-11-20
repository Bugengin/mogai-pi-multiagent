import fs from "node:fs";
import path from "node:path";
import { buildExportQuery, matches } from "./queryBuilder";
import { writeRows } from "./writer";

export interface Order { id: string; status: string; amount: number; }

export function loadOrders(): Order[] {
  const file = path.join(process.cwd(), "data", "orders.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Order[];
}

export function exportFile(): { rows: number; content: string } {
  const orders = loadOrders();
  const query = buildExportQuery();
  const filters = query.toFilterObject();
  const matched = orders.filter((o) => matches(o, filters));
  const content = writeRows(matched.map((o) => ({ id: o.id, amount: o.amount })));
  console.log("export rows=" + matched.length);
  return { rows: matched.length, content };
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
// (demo fixture) padding line 51
// (demo fixture) padding line 52
// (demo fixture) padding line 53
// (demo fixture) padding line 54
// (demo fixture) padding line 55
// (demo fixture) padding line 56
// (demo fixture) padding line 57
// (demo fixture) padding line 58
// (demo fixture) padding line 59
// (demo fixture) padding line 60
// (demo fixture) padding line 61
// (demo fixture) padding line 62
// (demo fixture) padding line 63
// (demo fixture) padding line 64
// (demo fixture) padding line 65
// (demo fixture) padding line 66
// (demo fixture) padding line 67
// (demo fixture) padding line 68
// (demo fixture) padding line 69
// (demo fixture) padding line 70
// (demo fixture) padding line 71
// (demo fixture) padding line 72
// (demo fixture) padding line 73
// (demo fixture) padding line 74
// (demo fixture) padding line 75
// (demo fixture) padding line 76
// (demo fixture) padding line 77
// (demo fixture) padding line 78
// (demo fixture) padding line 79
// (demo fixture) padding line 80
// (demo fixture) padding line 81
// (demo fixture) padding line 82
// (demo fixture) padding line 83
// (demo fixture) padding line 84
// (demo fixture) padding line 85
