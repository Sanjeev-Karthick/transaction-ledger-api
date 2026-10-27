export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return _next(err);
  let error = err;
  if (err.type === 'entity.parse.failed') {
    error = new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  } else if (err.type === 'entity.too.large') {
    error = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the 32 KB limit');
  } else if (err.status === 415) {
    error = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding');
  }
  const known = error instanceof HttpError;
  if (!known || error.status >= 500) req.log.error({ err }, 'Request failed');
  res.status(known ? error.status : 500).json({
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'An unexpected error occurred',
      ...(known && error.details ? { details: error.details } : {}),
      requestId: req.id,
    },
  });
}
