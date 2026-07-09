import type { KeyMode } from "@schemap/core";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        workspaceId: string;
        via: "session" | "api_key";
        userId?: string;
        sessionId?: string;
        keyMode?: KeyMode;
      };
    }
  }
}

export {};
