# Rate limiting

Limit the public API to 100 requests per minute per IP and return 429 with a Retry-After header when the limit is hit.
