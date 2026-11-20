# api-service demo

接口 /api/profile 偶发 500。handler.ts 里 ctx.user 可能为 undefined 时直接取 user.id，抛空指针。
