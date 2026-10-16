# Local verification record

- Date: 2026-10-16
- Host: Microsoft Windows 10.0.26200, x64
- Node.js: v22.14.0; npm: 10.9.2
- Commands: `npm test`, `npm run lint`, `npm run format:check`
- Test result: 14 passed, 0 failed. Coverage includes CRC raw-slice parity, int24, windows, heart-rate edge cases, selected six-minute differential windows with deterministic gaps, open-ended cloud ranges, BSON binary length handling, cloud-ingest retry/conflict behavior, collector restart-from-zero, and duplicate reply idempotence.
- Static checks: ESLint passed; Prettier check passed.

The collector tests bind temporary loopback TCP mock servers and ran successfully with local loopback access. They verify pipeline behavior against test fixtures only. This record is not ARM64, supplied-mock, MongoDB/Render, ground-truth, destructive fault, power-cut, one-hour resource, or demo-video evidence.
