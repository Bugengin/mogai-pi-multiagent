# report-service demo

报表按天汇总与明细对不上。aggregate.ts 用本地时区 getDate() 取日期，UTC+8 下跨日订单会错位到次日。
