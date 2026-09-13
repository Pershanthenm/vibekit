---
description: "Database schema, tables, columns and migrations: code-first and version controlled"
globs: "**/migrations/**,**/*.prisma,**/schema.sql,**/schema.rb"
---

# Code-first migrations

* New applications using relational databases MUST use code-first migrations unless the project
  explicitly specifies another approach.
* Database schema changes MUST be represented through version-controlled migrations.
* Migrations MUST be reviewed and tested before deployment.
* Manual database changes MUST NOT be used as the normal deployment mechanism.
