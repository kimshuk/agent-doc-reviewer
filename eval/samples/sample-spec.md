# Design: URL shortener service

A small service that turns long URLs into short codes and redirects.

## Goal

Users paste a long URL and get back a short link like `https://sho.rt/abc123`. Visiting the short
link redirects to the original URL.

## API

- `POST /shorten` with `{ "url": "..." }` returns `{ "short": "https://sho.rt/abc123" }`.
- `GET /:code` redirects to the original URL.

## Storage

Store a map of `code -> url`. Generate the code from a counter, base62-encoded.

## Notes

It should be fast.
