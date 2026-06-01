
## MVC mapping
- `app.py` = controller (HTTP routing, request models, JSON/artifact serialization boundary).
- `stats/*.py` = models/services (one module per analysis family; pure compute → summary + chart).
See `../server/ARCHITECTURE.md` for the whole-repo mapping.
