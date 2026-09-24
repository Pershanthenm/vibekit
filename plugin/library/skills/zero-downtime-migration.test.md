---
skill: zero-downtime-migration
triggers-on: ["rename a column on users without downtime", "plan a zero downtime move of orders to the new schema", "backfill the new status column in batches", "drop a column that the old service still reads"]
must-not-trigger-on: ["the orders report is a slow query, speed it up", "propose a schema design for subscriptions and invoices", "rotate the database credentials"]
---
