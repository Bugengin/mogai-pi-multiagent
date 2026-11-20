# export-service demo

导出链路：exportFile() -> loadOrders() 读 data/orders.json -> buildExportQuery()（过滤 status=PENDING）-> writeRows()。

已知现象：导出文件为空（只有表头）。
数据：data/orders.json 中所有订单状态为 PAID / SHIPPED / CANCELLED，没有任何 PENDING，因此过滤后为 0 行。
