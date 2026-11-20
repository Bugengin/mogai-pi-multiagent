export interface Order { id: string; status: string; amount: number; }

export class QueryBuilder {
  private filters: Array<[string, unknown]> = [];
  where(field: string, value: unknown): this {
    this.filters.push([field, value]);
    return this;
  }
  toFilterObject(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.filters) out[k] = v;
    return out;
  }
}

export function buildExportQuery(): QueryBuilder {
  // 导出只包含待处理(PENDING)的订单
  return new QueryBuilder().where("status", "PENDING");
}

export function matches(order: Order, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([k, v]) => (order as unknown as Record<string, unknown>)[k] === v);
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
// (demo fixture) padding line 86
// (demo fixture) padding line 87
// (demo fixture) padding line 88
// (demo fixture) padding line 89
// (demo fixture) padding line 90
// (demo fixture) padding line 91
// (demo fixture) padding line 92
// (demo fixture) padding line 93
// (demo fixture) padding line 94
// (demo fixture) padding line 95
// (demo fixture) padding line 96
// (demo fixture) padding line 97
// (demo fixture) padding line 98
// (demo fixture) padding line 99
// (demo fixture) padding line 100
// (demo fixture) padding line 101
// (demo fixture) padding line 102
// (demo fixture) padding line 103
// (demo fixture) padding line 104
// (demo fixture) padding line 105
// (demo fixture) padding line 106
// (demo fixture) padding line 107
// (demo fixture) padding line 108
// (demo fixture) padding line 109
// (demo fixture) padding line 110
// (demo fixture) padding line 111
// (demo fixture) padding line 112
// (demo fixture) padding line 113
// (demo fixture) padding line 114
// (demo fixture) padding line 115
// (demo fixture) padding line 116
// (demo fixture) padding line 117
// (demo fixture) padding line 118
// (demo fixture) padding line 119
// (demo fixture) padding line 120
