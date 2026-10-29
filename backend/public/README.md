# `public/`

This project serves browser assets from `frontend/public/` (Vite). This directory
exists to keep the backend package self-contained and holds only
public, non-secret material (e.g. demo fixtures).

Never place service-account keys, admin credentials, or other server-only
secrets in this directory or in the frontend bundle.
