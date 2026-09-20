# Decision Log

- **cookie-persistence**: Session cookie was root cause of path not surviving browser restart; fixed by adding Max-Age=31536000 for ~1 year persistence.
