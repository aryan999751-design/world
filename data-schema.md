# Normalized event schema

```json
{
  "id": "unique-id",
  "kind": "aircraft|satellite|maritime|airspace|incident|interference",
  "title": "Human-readable title",
  "time": "ISO-8601 UTC",
  "lat": 0,
  "lon": 0,
  "source": "provider",
  "sourceUrl": "https://...",
  "confidence": "high|medium|low"
}
```

Satellite and aircraft streams may use trajectory-specific fields. Keep provenance with every object so the UI can distinguish live source data from a replay pack.
