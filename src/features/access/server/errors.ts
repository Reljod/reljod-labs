import { UnauthorizedError } from "@/platform/errors";
import { DENIED_MESSAGE } from "../constants";

/** No Access. An UnauthorizedError, so every REST route answers it 401. */
export class AccessDeniedError extends UnauthorizedError {
  constructor() {
    super(DENIED_MESSAGE);
  }
}

/**
 * Supabase Auth could not do its part (the door is not set up, Auth is down,
 * an update failed). Nobody is let in and nothing is changed; the access
 * routes answer it 503 with this message (`unavailable()` in `api.ts`). Not
 * an AppError: the platform's errors stop at 429, and this one is ours alone.
 */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnavailableError";
  }
}
