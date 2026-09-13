---
description: "Logging, tracing, metrics and observability: structured logs, correlation ids, log levels"
---

# Logging & observability

* Applications SHOULD provide structured logging and appropriate observability.
* Important application, security, integration, and operational events SHOULD be logged.
* Logs SHOULD carry enough context to diagnose failures.
* Correlation/request identifiers SHOULD be used for distributed or multi-service applications.
* Logging MUST NOT expose secrets or unnecessary sensitive information.
